import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider, parseInlineToolCalls, unwrapCallEnvelope } from "../src/ollama-provider.js";
import type { ToolCall } from "../src/types.js";

const OFFERED = new Set(["setPriority", "createSprint", "carryOverUnfinishedIssues", "getIssue"]);

describe("recovering tool calls a model printed instead of emitting", () => {
  it("recovers a call written as plain text", () => {
    const calls = parseInlineToolCalls(
      '{"type":"function","name":"setPriority","parameters":{"issueKey":"ECOM-5","priority":"critical"}}',
      OFFERED,
    );
    expect(calls).toEqual([{ name: "setPriority", arguments: { issueKey: "ECOM-5", priority: "critical" } }]);
  });

  // Verbatim from a real llama3.2:1b run: it quotes the tool name but not the key.
  it("repairs unquoted string values", () => {
    const calls = parseInlineToolCalls(
      '{"type":"function","name":"setPriority","parameters":{"issueKey":ECOM-5,"priority":critical}}',
      OFFERED,
    );
    expect(calls[0]?.arguments).toEqual({ issueKey: "ECOM-5", priority: "critical" });
  });

  it("recovers several calls from one message, and ignores the malformed one", () => {
    const calls = parseInlineToolCalls(
      '{"type":"function","name":"createSprint","parameters":{"name":"Sprint Beta","start":{"true"}}}\n' +
        '{"type":"function","name":"carryOverUnfinishedIssues","parameters":{"fromSprintName":"Sprint Alpha","toSprintName":"Sprint Beta"}}',
      OFFERED,
    );
    expect(calls.map((c) => c.name)).toEqual(["carryOverUnfinishedIssues"]);
  });

  it("reads the <tool_call> and code-fence wrappers other templates use", () => {
    expect(
      parseInlineToolCalls('<tool_call>{"name":"getIssue","arguments":{"issueKey":"ECOM-4"}}</tool_call>', OFFERED),
    ).toHaveLength(1);
    expect(
      parseInlineToolCalls('```json\n{"function":{"name":"getIssue","arguments":{"issueKey":"ECOM-4"}}}\n```', OFFERED),
    ).toHaveLength(1);
  });

  it("never invents a call from prose that merely names a tool", () => {
    expect(
      parseInlineToolCalls("I could call deleteProject with {\"projectId\": \"abc\"} but I will not.", OFFERED),
    ).toEqual([]);
    expect(parseInlineToolCalls("Here is the plan: {ECOM-1, ECOM-2} in Sprint Beta.", OFFERED)).toEqual([]);
  });

  it("does not treat an offered name as a call without a call-shaped object", () => {
    expect(parseInlineToolCalls("You should use setPriority for that.", OFFERED)).toEqual([]);
  });

  it("caps how many printed calls one message can trigger", () => {
    const one = '{"name":"getIssue","arguments":{"issueKey":"ECOM-1"}}';
    const many = [1, 2, 3, 4, 5].map((n) => one.replace("ECOM-1", `ECOM-${n}`)).join("\n");
    expect(parseInlineToolCalls(many, OFFERED)).toHaveLength(3);
  });
});

describe("runAgent with a model that prints its calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubChat = (replies: string[]) => {
    let turn = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ model: "test", message: { role: "assistant", content: replies[turn++] ?? "done" } }),
      })),
    );
  };

  const tools = [{ name: "setPriority", description: "d", parameters: { type: "object", properties: {} } }];

  it("executes the printed call, then answers", async () => {
    stubChat(['{"name":"setPriority","parameters":{"issueKey":"ECOM-5","priority":"high"}}', "Raised ECOM-5 to high."]);
    const seen: ToolCall[] = [];
    const result = await new OllamaProvider({ model: "test" }).runAgent({
      messages: [{ role: "user", content: "raise it" }],
      tools,
      executeTool: async (call) => {
        seen.push(call);
        return { ok: true, summary: "Set ECOM-5 to high" };
      },
    });

    expect(seen).toEqual([{ name: "setPriority", arguments: { issueKey: "ECOM-5", priority: "high" } }]);
    expect(result.text).toBe("Raised ECOM-5 to high.");
    expect(result.toolCalls).toHaveLength(1);
  });

  it("runs a repeated printed call once, and returns the text rather than looping", async () => {
    const printed = '{"name":"setPriority","parameters":{"issueKey":"ECOM-5","priority":"high"}}';
    stubChat([printed, printed]);
    let executions = 0;
    const result = await new OllamaProvider({ model: "test" }).runAgent({
      messages: [{ role: "user", content: "raise it" }],
      tools,
      executeTool: async () => {
        executions++;
        return { ok: true, summary: "Set ECOM-5 to high" };
      },
    });

    expect(executions).toBe(1);
    expect(result.text).toBe(printed);
  });
});

describe("unwrapping an envelope a model nested inside its own arguments", () => {
  const offered = new Set(["createIssue", "setPriority"]);

  it("recovers the real arguments", () => {
    expect(
      unwrapCallEnvelope(
        { type: "function", name: "createIssue", parameters: { title: "Expired login tokens", type: "bug" } },
        offered,
      ),
    ).toEqual({ title: "Expired login tokens", type: "bug" });
  });

  it("handles the arguments spelling too", () => {
    expect(unwrapCallEnvelope({ name: "setPriority", arguments: { issueKey: "ECOM-5" } }, offered)).toEqual({
      issueKey: "ECOM-5",
    });
  });

  it("leaves real arguments that happen to carry a name alone", () => {
    const args = { name: "Sprint Beta", parameters: { a: 1 } };
    expect(unwrapCallEnvelope(args, offered)).toBe(args);
    expect(unwrapCallEnvelope({ name: "createIssue", title: "no inner object" }, offered)).toEqual({
      name: "createIssue",
      title: "no inner object",
    });
  });
});

describe("envelopes that name the tool under a 'function' key", () => {
  const offered = new Set(["createDecision"]);

  // Verbatim shape from a real llama3.2:1b run.
  it("unwraps them too", () => {
    expect(
      unwrapCallEnvelope(
        { type: "function", function: "createDecision", parameters: { title: "Use SQLite", issueKey: null } },
        offered,
      ),
    ).toEqual({ title: "Use SQLite", issueKey: null });
  });

  it("recovers the same shape printed as text", () => {
    const calls = parseInlineToolCalls(
      '{"type":"function","function":"createDecision","parameters":{"title":"Use SQLite"}}',
      offered,
    );
    expect(calls).toEqual([{ name: "createDecision", arguments: { title: "Use SQLite" } }]);
  });
});
