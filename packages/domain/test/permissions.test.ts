import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, callableTools, decideToolCall, getAgentTool, resolveApplicableAction } from "../src/index.js";

/**
 * The permission engine is the only thing standing between a model's output
 * and the database, so it is tested as a contract rather than through the
 * agent: names in, decisions out.
 */
describe("permission engine", () => {
  it("routes read tools, AUTO writes, and ASK writes to different outcomes", () => {
    expect(decideToolCall("getBacklog", {}).outcome).toBe("read");
    expect(decideToolCall("createIssue", { title: "A bug" }).outcome).toBe("execute");
    expect(decideToolCall("deleteIssue", { issueKey: "ACME-1" }).outcome).toBe("propose");
  });

  it("refuses blocked tools by name, even though they are registered", () => {
    const decision = decideToolCall("deleteProject", {});
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") expect(decision.reason).toMatch(/blocked/i);

    const bulk = decideToolCall("bulkDeleteIssues", { issueKeys: ["ACME-1"] });
    expect(bulk.outcome).toBe("refused");
  });

  it("never offers blocked tools to the model", () => {
    const offered = callableTools().map((tool) => tool.name);
    expect(offered).not.toContain("deleteProject");
    expect(offered).not.toContain("bulkDeleteIssues");
    expect(AGENT_TOOLS.some((tool) => tool.tier === "blocked")).toBe(true);
  });

  it("refuses unknown tools instead of ignoring them", () => {
    const decision = decideToolCall("dropDatabase", { yes: true });
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") expect(decision.reason).toMatch(/unknown tool/i);
  });

  it("refuses calls whose arguments do not validate", () => {
    const decision = decideToolCall("createIssue", { title: "" });
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") expect(decision.reason).toMatch(/invalid arguments/i);
  });

  it("cannot be talked into a higher tier by arguments claiming one", () => {
    const decision = decideToolCall("deleteIssue", { issueKey: "ACME-1", tier: "auto", approved: true });
    expect(decision.outcome).toBe("propose");
  });

  it("only ASK-tier writes are applicable from a stored run", () => {
    const auto = resolveApplicableAction({ tool: "createIssue", args: { title: "x" }, description: "", projectId: null });
    expect(auto.ok).toBe(false);
    if (!auto.ok) expect(auto.reason).toMatch(/does not require approval/i);

    const read = resolveApplicableAction({ tool: "getBacklog", args: {}, description: "", projectId: null });
    expect(read.ok).toBe(false);

    const blocked = resolveApplicableAction({ tool: "deleteProject", args: {}, description: "", projectId: null });
    expect(blocked.ok).toBe(false);

    const ask = resolveApplicableAction({
      tool: "deleteIssue",
      args: { issueKey: "ACME-1" },
      description: "",
      projectId: null,
    });
    expect(ask.ok).toBe(true);
  });

  it("re-validates stored arguments at apply time", () => {
    const tampered = resolveApplicableAction({
      tool: "deleteIssue",
      args: { issueKey: 42 },
      description: "",
      projectId: null,
    });
    expect(tampered.ok).toBe(false);
  });

  it("assigns every registered tool a tier and a kind", () => {
    for (const tool of AGENT_TOOLS) {
      expect(["auto", "ask", "blocked"]).toContain(tool.tier);
      expect(["read", "write"]).toContain(tool.kind);
      if (tool.kind === "read") expect(tool.tier).toBe("auto");
    }
    // Destructive operations must never be AUTO.
    for (const name of ["deleteIssue", "planSprint", "completeSprint", "carryOverUnfinishedIssues", "bulkUpdateIssues"]) {
      expect(getAgentTool(name)?.tier).toBe("ask");
    }
  });
});

describe("nulls a model sends for optional fields", () => {
  it("accepts null as 'not applicable' rather than refusing the call", () => {
    const decision = decideToolCall("createDecision", {
      title: "Use SQLite for local-first persistence",
      decision: "SQLite, because it is transactional and needs no service",
      issueKey: null,
      rationale: null,
    });

    expect(decision.outcome).toBe("execute");
  });

  it("keeps a null that the schema gives a meaning to", () => {
    const decision = decideToolCall("setParent", { issueKey: "ECOM-4", parentKey: null });

    expect(decision.outcome).not.toBe("refused");
    expect((decision as { args: { parentKey: unknown } }).args.parentKey).toBeNull();
  });

  it("still refuses a null where the field is genuinely required", () => {
    const decision = decideToolCall("createIssue", { title: null });

    expect(decision.outcome).toBe("refused");
  });
});
