import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb, projectsRepo } from "@ai-pm/database";
import { AGENT_TOOLS, PORTFOLIO_AGENT_TOOLS, getPortfolioTool } from "../src/index.js";
import { createIssue } from "../src/issues.js";
import { toolContext } from "./helpers.js";

/**
 * The portfolio surface is defined by what it *cannot* do. These tests pin
 * that shape: reads across projects, writes nowhere.
 */
describe("portfolio tool surface", () => {
  let db: Database.Database;
  let ecom: string;
  let crm: string;

  beforeEach(() => {
    db = createTestDb();
    ecom = projectsRepo.createProject(db, { name: "Ecommerce", key: "ECOM" }).id;
    crm = projectsRepo.createProject(db, { name: "CRM Platform", key: "CRM" }).id;
    createIssue(db, { projectId: ecom, type: "task", title: "ECOM work", status: "todo", priority: "high" });
    createIssue(db, { projectId: crm, type: "task", title: "CRM work", status: "todo", priority: "low" });
  });

  it("contains no write tools at all", () => {
    expect(PORTFOLIO_AGENT_TOOLS.length).toBeGreaterThan(0);
    for (const tool of PORTFOLIO_AGENT_TOOLS) {
      expect(tool.kind).toBe("read");
    }
  });

  it("does not expose any project-scoped write tool by name", () => {
    const writeNames = AGENT_TOOLS.filter((t) => t.kind === "write").map((t) => t.name);
    for (const name of writeNames) {
      expect(getPortfolioTool(name)).toBeUndefined();
    }
    // Spot-check the ones that would hurt most.
    for (const name of ["createIssue", "planSprint", "deleteIssue", "deleteProject", "bulkUpdateIssues"]) {
      expect(getPortfolioTool(name)).toBeUndefined();
    }
  });

  it("resolves a project by key or name, and refuses anything else", async () => {
    const detail = getPortfolioTool("getProjectDetail")!;
    const ctx = toolContext(db, null, {
      services: {
        projectState: async () =>
          ({
            metrics: { totalIssues: 1, completedIssues: 0, remainingIssues: 1, totalPoints: 0, completedPoints: 0, remainingPoints: 0, scope: "project" },
            risks: [],
          }) as never,
        gitStatus: async () => ({}) as never,
        portfolioState: async () => ({ generatedAt: "", projects: [] }),
      },
    });

    if (detail.kind !== "read") throw new Error("getProjectDetail must be a read tool");
    const byKey = (await detail.read(ctx, detail.schema.parse({ projectKey: "CRM" }))) as {
      project: { key: string };
    };
    expect(byKey.project.key).toBe("CRM");

    await expect(async () =>
      detail.read(ctx, detail.schema.parse({ projectKey: "MOBILE" })),
    ).rejects.toThrow(/No project with key or name/);
  });

  it("reads stay scoped to the project that was asked for", async () => {
    const decisions = getPortfolioTool("listProjectDecisions")!;
    if (decisions.kind !== "read") throw new Error("listProjectDecisions must be a read tool");

    const ctx = toolContext(db, null);
    const result = (await decisions.read(ctx, decisions.schema.parse({ projectKey: "ECOM" }))) as {
      project: string;
      decisions: unknown[];
    };
    expect(result.project).toBe("ECOM");
    expect(result.decisions).toEqual([]);
  });
});
