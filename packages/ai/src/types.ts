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
  /** Upper bound on tool-calling round trips before giving up. Defaults to 6. */
  maxSteps?: number;
  temperature?: number;
}

export interface AgentTurnResult {
  /** Final assistant text once the model stops calling tools. */
  text: string;
  /** Every tool call made during this turn, in order, alongside what executeTool returned for it. */
  toolCalls: { call: ToolCall; result: unknown }[];
}

/**
 * Provider abstraction so the rest of the app never talks to a specific
 * vendor's API shape directly. Implement this interface to add providers
 * beyond Ollama later without touching call sites.
 */
export interface AIProvider {
  chat(input: ChatInput): Promise<ChatResult>;
  structured<T>(input: StructuredInput<T>): Promise<T>;
  /** Multi-step tool-calling loop. Throws AIUnavailableError if the model never settles on a final reply. */
  runAgent(input: AgentChatInput): Promise<AgentTurnResult>;
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
