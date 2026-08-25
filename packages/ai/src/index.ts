export type {
  AIProvider,
  ChatInput,
  ChatMessage,
  ChatResult,
  ChatRole,
  StructuredInput,
  ToolParameterSchema,
  ToolSpec,
  ToolCall,
  AgentChatInput,
  AgentTurnResult,
} from "./types.js";
export { AIUnavailableError } from "./types.js";
export { OllamaProvider } from "./ollama-provider.js";
export type { OllamaProviderOptions } from "./ollama-provider.js";
// Exported so anything implementing a provider -- including test doubles that
// reproduce how small models actually answer -- can reuse the same recovery
// path rather than a lookalike of it.
export { parseInlineToolCalls, unwrapCallEnvelope } from "./ollama-provider.js";
