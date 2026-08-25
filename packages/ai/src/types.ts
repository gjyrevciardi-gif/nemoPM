import type { z } from "zod";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Tool name this message is a result for. Only meaningful when role is "tool". */
  name?: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  temperature?: number;
}

export interface ChatResult {
  text: string;
  model: string | null;
}

export interface StructuredInput<T> {
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Optional name to help the model understand what shape to produce. */
  schemaName?: string;
  temperature?: number;
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[]; items?: { type: string } }>;
  required: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentChatInput {
  messages: ChatMessage[];
  tools: ToolSpec[];
  /** Invoked once per tool call the model makes. Must not throw -- return an error inside the result instead. */
  executeTool: (call: ToolCall) => Promise<unknown>;
  /** Optional deterministic finalizer for a proven single-action turn. Avoids a second model call. */
  finishAfterTool?: (call: ToolCall, result: unknown) => string | null;
  /** Upper bound on tool-calling round trips before giving up. Defaults to 6. */
  maxSteps?: number;
  temperature?: number;
}

export interface AgentTurnResult {
  /** Final assistant text once the model stops calling tools. */
  text: string;
  /** Every tool call made during this turn, in order, alongside what executeTool returned for it. */
  toolCalls: { call: ToolCall; result: unknown }[];
  /** Which model produced this turn, recorded on the agent run for auditability. */
  model: string | null;
  /** Actual model invocations, including the final no-tool response. */
  modelCalls?: number;
}

/**
 * Provider abstraction so the rest of the app never talks to a specific
 * vendor's API shape directly. Implement this interface to add providers
 * beyond Ollama later without touching call sites.
 */
export interface AIProvider {
  /**
   * True when this provider is a local model with local-model economics: slow
   * turns, small context, unreliable tool selection. NEMO answers what it can
   * deterministically in that case rather than spending a minute on a lookup.
   *
   * Declared rather than inferred. This used to be a constructor.name check for
   * "OllamaProvider", which meant no test double could ever reach those paths --
   * the deterministic routes were the least tested part of the system precisely
   * because they are the ones that matter most on the hardware this runs on.
   */
  readonly isLocalModel?: boolean;
  chat(input: ChatInput): Promise<ChatResult>;
  structured<T>(input: StructuredInput<T>): Promise<T>;
  /** Multi-step tool-calling loop. Throws AIUnavailableError if the model never settles on a final reply. */
  runAgent(input: AgentChatInput): Promise<AgentTurnResult>;
  health?(): Promise<{ reachable:boolean; model:string|null; contextSize:number; warm:boolean; state:"ready"|"loading"|"running"|"offline"; error:string|null }>;
}

/**
 * Thrown by providers whenever the model cannot be reached or fails to
 * produce a usable response (offline, timeout, invalid JSON, etc). Callers
 * MUST catch this and fall back to a deterministic response -- the app is
 * never allowed to crash or hang because the AI backend is unavailable.
 */
export class AIUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AIUnavailableError";
  }
}
