import type { z } from "zod";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
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

/**
 * Provider abstraction so the rest of the app never talks to a specific
 * vendor's API shape directly. Implement this interface to add providers
 * beyond Ollama later without touching call sites.
 */
export interface AIProvider {
  chat(input: ChatInput): Promise<ChatResult>;
  structured<T>(input: StructuredInput<T>): Promise<T>;
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
