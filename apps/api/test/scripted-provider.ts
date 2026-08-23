import type { AgentChatInput, AgentTurnResult, AIProvider, ChatInput, ChatResult, StructuredInput, ToolCall } from "@ai-pm/ai";

/**
 * A call, or a function of the results so far -- which is how a real model
 * behaves: it reads what the last tool returned before deciding the next call.
 */
export type ScriptedCall = ToolCall | ((prior: { call: ToolCall; result: unknown }[]) => ToolCall);

export interface ScriptedTurn {
  /** Tool calls the "model" makes this turn, in order. */
  calls: ScriptedCall[];
  /** Final assistant text. First line becomes the plan goal. */
  reply: string;
}

/**
 * A model stand-in that emits exactly the tool calls a test asks for.
 *
 * NEMO's safety properties -- permission tiers, rollback, project isolation --
 * are properties of the server, not of a language model's mood. Testing them
 * through a real model would make the suite a coin flip; this provider makes
 * the server's decisions the only variable.
 */
export class ScriptedProvider implements AIProvider {
  private turns: ScriptedTurn[] = [];

  /** What the last turn was actually asked, for asserting on prompt contents. */
  lastMessages: AgentChatInput["messages"] = [];
  lastToolNames: string[] = [];
  lastPromptChars = 0;

  queue(turn: ScriptedTurn): this {
    this.turns.push(turn);
    return this;
  }

  reset(): void {
    this.turns = [];
    this.lastMessages = [];
    this.lastToolNames = [];
    this.lastPromptChars = 0;
  }

  async runAgent(input: AgentChatInput): Promise<AgentTurnResult> {
    this.lastMessages = input.messages;
    this.lastToolNames = input.tools.map((tool) => tool.name);
    this.lastPromptChars = input.messages.reduce((sum, message) => sum + message.content.length, 0);

    const turn: ScriptedTurn = this.turns.shift() ?? { calls: [], reply: "Nothing to do." };
    const toolCalls: AgentTurnResult["toolCalls"] = [];
    for (const scripted of turn.calls) {
      const call = typeof scripted === "function" ? scripted(toolCalls) : scripted;
      const result = await input.executeTool(call);
      toolCalls.push({ call, result });
    }
    return { text: turn.reply, toolCalls, model: "scripted-model:test", modelCalls:Math.min(input.maxSteps??1,toolCalls.length>0?2:1) };
  }

  async chat(_input: ChatInput): Promise<ChatResult> {
    return { text: "scripted", model: "scripted-model:test" };
  }

  async structured<T>(_input: StructuredInput<T>): Promise<T> {
    throw new Error("structured() is not scripted in these tests");
  }
}

export function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { name, arguments: args };
}
