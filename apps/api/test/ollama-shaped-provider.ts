import type {
  AgentChatInput,
  AgentTurnResult,
  AIProvider,
  ChatInput,
  ChatResult,
  StructuredInput,
  ToolCall,
} from "@ai-pm/ai";
import { AIUnavailableError } from "@ai-pm/ai";

/**
 * A stand-in that answers in the shapes a real Ollama actually returns, and
 * declares itself a local model so the deterministic routes are reachable.
 *
 * The existing ScriptedProvider hands the server a clean `ToolCall` object,
 * which skips every layer where small models go wrong: printing a call as text,
 * nesting the envelope inside its own arguments, spelling the name under a
 * `function` key. Those were three real defects, and none of them could be
 * reproduced through a double that starts from a well-formed call.
 *
 * So responses here are written the way a model writes them, and go through the
 * provider's own recovery path -- meaning a test can assert on what NEMO does
 * with a badly-shaped answer, not merely on what it does with a good one.
 */
export type OllamaShapedResponse =
  /** A well-behaved native tool call, as a capable model emits it. */
  | { kind: "toolCalls"; calls: { name: string; arguments: Record<string, unknown> }[] }
  /** A call the model printed into its message text instead of emitting. */
  | { kind: "printedCall"; text: string }
  /** Plain prose, no call at all. */
  | { kind: "text"; text: string };

export class OllamaShapedProvider implements AIProvider {
  /** The whole point: deterministic routes are gated on this. */
  readonly isLocalModel = true;

  private responses: OllamaShapedResponse[] = [];

  lastMessages: AgentChatInput["messages"] = [];
  lastToolNames: string[] = [];
  /** How many times the model was actually consulted. Zero means a route answered. */
  turns = 0;

  queue(response: OllamaShapedResponse): this {
    this.responses.push(response);
    return this;
  }

  reset(): void {
    this.responses = [];
    this.lastMessages = [];
    this.lastToolNames = [];
    this.turns = 0;
  }

  async runAgent(input: AgentChatInput): Promise<AgentTurnResult> {
    this.turns++;
    this.lastMessages = input.messages;
    this.lastToolNames = input.tools.map((tool) => tool.name);

    const response = this.responses.shift() ?? { kind: "text" as const, text: "Nothing to do." };
    const offered = new Set(input.tools.map((tool) => tool.name));
    const toolCalls: AgentTurnResult["toolCalls"] = [];

    const run = async (calls: ToolCall[]) => {
      for (const call of calls) {
        const result = await input.executeTool(call);
        toolCalls.push({ call, result });
      }
    };

    if (response.kind === "toolCalls") {
      await run(response.calls.map((c) => ({ name: c.name, arguments: c.arguments })));
      return { text: "Done.", toolCalls, model: "ollama-shaped:test", modelCalls: 2 };
    }

    if (response.kind === "printedCall") {
      // Recovered exactly as the real provider recovers it, guards included.
      const { parseInlineToolCalls } = await import("@ai-pm/ai");
      const recovered = parseInlineToolCalls(response.text, offered);
      if (recovered.length === 0) {
        return { text: response.text, toolCalls, model: "ollama-shaped:test", modelCalls: 1 };
      }
      await run(recovered);
      return { text: "Done.", toolCalls, model: "ollama-shaped:test", modelCalls: 2 };
    }

    if (!response.text) throw new AIUnavailableError("Ollama returned an empty response.");
    return { text: response.text, toolCalls, model: "ollama-shaped:test", modelCalls: 1 };
  }

  async chat(_input: ChatInput): Promise<ChatResult> {
    this.turns++;
    return { text: "scripted", model: "ollama-shaped:test" };
  }

  async structured<T>(_input: StructuredInput<T>): Promise<T> {
    throw new Error("structured() is not scripted here");
  }
}
