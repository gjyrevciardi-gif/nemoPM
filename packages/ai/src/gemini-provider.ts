import type {
  AgentChatInput,
  AgentTurnResult,
  AIProvider,
  ChatInput,
  ChatResult,
  StructuredInput,
  ToolCall,
  ToolSpec,
} from "./types.js";
import { AIUnavailableError } from "./types.js";

export interface GeminiProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface ChatCompletionBody {
  choices?: { message?: OpenAIMessage }[];
  model?: string;
}

const DEFAULT_MAX_STEPS = 6;

/**
 * Talks to Gemini's OpenAI-compatible endpoint
 * (https://ai.google.dev/gemini-api/docs/openai), which speaks the standard
 * chat-completions wire format -- including tool_calls with string-encoded
 * arguments and tool_call_id-addressed results, unlike Ollama's native API.
 */
export class GeminiProvider implements AIProvider {
  readonly isLocalModel = false;

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? undefined;
    this.baseUrl = (
      options.baseUrl ??
      process.env.GEMINI_BASE_URL ??
      "https://generativelanguage.googleapis.com/v1beta/openai"
    ).replace(/\/+$/, "");
    this.model = options.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
    this.timeoutMs = options.timeoutMs ?? (Number(process.env.GEMINI_TIMEOUT_MS) || 45_000);
  }

  async health(): Promise<{
    reachable: boolean;
    model: string | null;
    contextSize: number;
    warm: boolean;
    state: "ready" | "loading" | "running" | "offline";
    error: string | null;
  }> {
    if (!this.apiKey) {
      return { reachable: false, model: null, contextSize: 0, warm: false, state: "offline", error: "GEMINI_API_KEY is not set." };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { reachable: true, model: this.model, contextSize: 0, warm: true, state: "ready", error: null };
    } catch (err) {
      return {
        reachable: false,
        model: null,
        contextSize: 0,
        warm: false,
        state: "offline",
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async callChatCompletions(
    messages: OpenAIMessage[],
    options: { temperature?: number; tools?: unknown[]; jsonMode?: boolean } = {},
  ): Promise<ChatCompletionBody> {
    if (!this.apiKey) throw new AIUnavailableError("GEMINI_API_KEY is not set.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options.temperature ?? 0.2,
          ...(options.tools ? { tools: options.tools } : {}),
          ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new AIUnavailableError(`Gemini returned HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as ChatCompletionBody;
    } catch (err) {
      if (err instanceof AIUnavailableError) throw err;
      const isAbort = err instanceof Error && err.name === "AbortError";
      throw new AIUnavailableError(
        isAbort ? `Gemini request timed out after ${this.timeoutMs}ms` : "Could not reach Gemini.",
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const body = await this.callChatCompletions(toOpenAIMessages(input.messages), { temperature: input.temperature });
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AIUnavailableError("Gemini returned an empty response.");
    return { text, model: body.model ?? this.model };
  }

  async structured<T>(input: StructuredInput<T>): Promise<T> {
    const jsonInstruction: OpenAIMessage = {
      role: "system",
      content:
        `Respond with ONLY valid JSON matching this shape${input.schemaName ? ` (${input.schemaName})` : ""}. ` +
        "No markdown, no code fences, no commentary before or after the JSON.",
    };

    const body = await this.callChatCompletions([jsonInstruction, ...toOpenAIMessages(input.messages)], {
      temperature: input.temperature,
      jsonMode: true,
    });

    const raw = body.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new AIUnavailableError("Gemini returned an empty response for a structured request.");

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripCodeFences(raw));
    } catch (err) {
      throw new AIUnavailableError("Gemini did not return valid JSON.", { cause: err });
    }

    const result = input.schema.safeParse(parsedJson);
    if (!result.success) {
      throw new AIUnavailableError(`Gemini's JSON did not match the expected schema: ${result.error.message}`);
    }
    return result.data;
  }

  async runAgent(input: AgentChatInput): Promise<AgentTurnResult> {
    const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
    const tools = input.tools.map(toOpenAITool);
    const messages: OpenAIMessage[] = toOpenAIMessages(input.messages);
    const toolCalls: AgentTurnResult["toolCalls"] = [];

    for (let step = 0; step < maxSteps; step++) {
      const body = await this.callChatCompletions(messages, { temperature: input.temperature, tools });
      const message = body.choices?.[0]?.message;
      if (!message) throw new AIUnavailableError("Gemini returned no message.");

      const rawCalls = message.tool_calls ?? [];
      const text = message.content?.trim() ?? "";

      if (rawCalls.length === 0) {
        if (!text) throw new AIUnavailableError("Gemini returned an empty response.");
        return { text, toolCalls, model: body.model ?? this.model, modelCalls: step + 1 };
      }

      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: rawCalls });

      for (const raw of rawCalls) {
        const call: ToolCall = { name: raw.function.name, arguments: parseArguments(raw.function.arguments) };
        const result = await input.executeTool(call);
        toolCalls.push({ call, result });
        messages.push({ role: "tool", tool_call_id: raw.id, content: JSON.stringify(result) });
        if (rawCalls.length === 1 && input.finishAfterTool) {
          const final = input.finishAfterTool(call, result);
          if (final) return { text: final, toolCalls, model: body.model ?? this.model, modelCalls: step + 1 };
        }
      }
    }

    throw new AIUnavailableError(`AI PM did not finish planning within ${maxSteps} tool-calling step(s).`);
  }
}

function toOpenAIMessages(messages: ChatInput["messages"]): OpenAIMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function toOpenAITool(tool: ToolSpec) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}
