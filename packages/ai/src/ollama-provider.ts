import { z } from "zod";
import type { AIProvider, ChatInput, ChatResult, StructuredInput } from "./types.js";
import { AIUnavailableError } from "./types.js";

export interface OllamaProviderOptions {
  baseUrl?: string;
  /** If omitted, the provider auto-detects the first locally available model on first use. */
  model?: string;
  timeoutMs?: number;
}

interface OllamaChatResponseBody {
  message?: { role: string; content: string };
  model?: string;
}

interface OllamaTagsResponseBody {
  models?: { name: string }[];
}

export class OllamaProvider implements AIProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private configuredModel: string | undefined;
  private resolvedModel: string | null = null;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(
      /\/+$/,
      "",
    );
    this.configuredModel = options.model ?? process.env.OLLAMA_MODEL ?? undefined;
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  private async resolveModel(): Promise<string> {
    if (this.configuredModel) return this.configuredModel;
    if (this.resolvedModel) return this.resolvedModel;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 5000));
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      if (!res.ok) {
        throw new AIUnavailableError(`Ollama /api/tags returned HTTP ${res.status}`);
      }
      const body = (await res.json()) as OllamaTagsResponseBody;
      const first = body.models?.[0]?.name;
      if (!first) {
        throw new AIUnavailableError(
          "No local Ollama models are installed. Pull one with `ollama pull llama3.1` or set OLLAMA_MODEL.",
        );
      }
      this.resolvedModel = first;
      return first;
    } catch (err) {
      if (err instanceof AIUnavailableError) throw err;
      throw new AIUnavailableError("Could not reach Ollama to list local models.", { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }

  private async callChat(
    model: string,
    messages: ChatInput["messages"],
    options: { temperature?: number; format?: "json" },
  ): Promise<OllamaChatResponseBody> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          ...(options.format ? { format: options.format } : {}),
          options: {
            temperature: options.temperature ?? 0.2,
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new AIUnavailableError(`Ollama /api/chat returned HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return (await res.json()) as OllamaChatResponseBody;
    } catch (err) {
      if (err instanceof AIUnavailableError) throw err;
      const isAbort = err instanceof Error && err.name === "AbortError";
      throw new AIUnavailableError(
        isAbort ? `Ollama request timed out after ${this.timeoutMs}ms` : "Could not reach Ollama.",
        { cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(input: ChatInput): Promise<ChatResult> {
    const model = await this.resolveModel();
    const body = await this.callChat(model, input.messages, { temperature: input.temperature });
    const text = body.message?.content?.trim();
    if (!text) {
      throw new AIUnavailableError("Ollama returned an empty response.");
    }
    return { text, model: body.model ?? model };
  }

  async structured<T>(input: StructuredInput<T>): Promise<T> {
    const model = await this.resolveModel();
    const jsonInstruction: ChatInput["messages"][number] = {
      role: "system",
      content:
        `Respond with ONLY valid JSON matching this shape${input.schemaName ? ` (${input.schemaName})` : ""}. ` +
        "No markdown, no code fences, no commentary before or after the JSON.",
    };

    const body = await this.callChat(model, [jsonInstruction, ...input.messages], {
      temperature: input.temperature,
      format: "json",
    });

    const raw = body.message?.content?.trim();
    if (!raw) {
      throw new AIUnavailableError("Ollama returned an empty response for a structured request.");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripCodeFences(raw));
    } catch (err) {
      throw new AIUnavailableError("Ollama did not return valid JSON.", { cause: err });
    }

    const result = input.schema.safeParse(parsedJson);
    if (!result.success) {
      throw new AIUnavailableError(
        `Ollama's JSON did not match the expected schema: ${result.error.message}`,
      );
    }
    return result.data;
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

// Re-exported so callers can validate their own structured schemas without
// importing zod directly if they don't otherwise need it.
export { z };
