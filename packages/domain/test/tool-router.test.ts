import { describe, expect, it } from "vitest";
import { callableTools, routeAgentTools, toolSurfaceMetrics } from "../src/index.js";

describe("dynamic agent tool routing", () => {
  it("routes issue creation without unrelated sprint or memory writes", () => {
    const route=routeAgentTools("Create a high-priority bug for login token expiry");
    const names=route.tools.map(t=>t.name);
    expect(names).toContain("createIssue");
    expect(names).not.toContain("createSprint");
    expect(names).not.toContain("createDecision");
    expect(names).not.toContain("deleteIssue");
  });

  it("routes sprint planning with the required bounded reads and planning tools", () => {
    const names=routeAgentTools("Plan the next sprint with max 24 points and carry unfinished work").tools.map(t=>t.name);
    expect(names).toEqual(expect.arrayContaining(["getCurrentSprint","getBacklog","getRisks","planSprint","carryOverUnfinishedIssues"]));
  });

  it("routes stored-decision questions to memory", () => {
    const names=routeAgentTools("Why did we choose SQLite? Recall the decision.").tools.map(t=>t.name);
    expect(names).toContain("listDecisions");
    expect(names).not.toContain("planSprint");
  });

  it("falls back to a read-only surface when confidence is low", () => {
    const route=routeAgentTools("Can you help me with the project?");
    expect(route.primary).toBe("safe_fallback");
    expect(route.tools.every(t=>t.kind==="read")).toBe(true);
  });

  it("never exposes BLOCKED tools and materially shrinks normal schemas", () => {
    const route=routeAgentTools("Set ECOM-4 to high priority");
    expect(route.tools.every(t=>t.tier!=="blocked")).toBe(true);
    expect(toolSurfaceMetrics(route.tools).schemaCharacters).toBeLessThan(toolSurfaceMetrics(callableTools()).schemaCharacters);
    expect(route.tools.length).toBeLessThanOrEqual(12);
  });

  it("uses code context only for editor-referential requests", () => {
    const names=routeAgentTools("Create a bug for this selected code",{hasCodeContext:true}).tools.map(t=>t.name);
    expect(names).toEqual(expect.arrayContaining(["getCodeContext","createIssue"]));
  });

  it("removes only read tools backed by datasets that were actually loaded", () => {
    const satisfied=routeAgentTools("Define the smallest MVP",{
      capabilities:["product_planning","architecture"],projectMode:"BOOTSTRAP",
      contextSufficiency:{loaded:{project:true,decisions:true,milestones:true}},
    }).tools.map(tool=>tool.name);
    expect(satisfied).not.toEqual(expect.arrayContaining(["getProject","listDecisions","listMilestones"]));
    expect(satisfied).toEqual(expect.arrayContaining(["createIssue","createDecision","createMilestone"]));

    const notLoaded=routeAgentTools("Define the smallest MVP",{
      capabilities:["product_planning"],projectMode:"BOOTSTRAP",
      contextSufficiency:{loaded:{project:true,decisions:false,milestones:false}},
    }).tools.map(tool=>tool.name);
    expect(notLoaded).not.toContain("getProject");
    expect(notLoaded).toEqual(expect.arrayContaining(["listDecisions","listMilestones"]));
  });
});
