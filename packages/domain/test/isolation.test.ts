import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb, decisionsRepo, issuesRepo, milestonesRepo, projectsRepo, sprintsRepo } from "@ai-pm/database";
import { createIssue, setParent } from "../src/issues.js";
import { runWrite, toolContext, writeTool } from "./helpers.js";

/**
 * Cross-project safety. Two projects with deliberately different data, and
 * every attempt to reach from one into the other -- by key, by name, by raw id
 * -- must fail rather than silently succeed on the wrong project.
 */
describe("project isolation", () => {
  let db: Database.Database;
  let ecom: string;
  let crm: string;

  beforeEach(() => {
    db = createTestDb();
    ecom = projectsRepo.createProject(db, { name: "Ecommerce", key: "ECOM" }).id;
    crm = projectsRepo.createProject(db, { name: "CRM Platform", key: "CRM" }).id;
  });

  it("an issue key from another project reads as not found", () => {
    const crmIssue = createIssue(db, { projectId: crm, type: "task", title: "CRM work", status: "todo", priority: "high" });
    const ctx = toolContext(db, ecom);

    expect(() => runWrite(ctx, "changeIssueStatus", { issueKey: crmIssue.key, status: "done" })).toThrow(
      /No issue with key/,
    );
    expect(issuesRepo.getIssue(db, crmIssue.id)?.status).toBe("todo");
  });

  it("a sprint from another project cannot be targeted by name", () => {
    const crmSprint = sprintsRepo.createSprint(db, { projectId: crm, name: "CRM Sprint" });
    const ecomIssue = createIssue(db, { projectId: ecom, type: "task", title: "ECOM work", status: "todo", priority: "high" });
    const ctx = toolContext(db, ecom);

    expect(() => runWrite(ctx, "addIssueToSprint", { issueKey: ecomIssue.key, sprintName: "CRM Sprint" })).toThrow(
      /No open sprint named/,
    );
    expect(issuesRepo.listIssuesBySprint(db, crmSprint.id)).toHaveLength(0);
  });

  it("cross-project dependencies cannot be created", () => {
    const ecomIssue = createIssue(db, { projectId: ecom, type: "task", title: "ECOM", status: "todo", priority: "high" });
    const crmIssue = createIssue(db, { projectId: crm, type: "task", title: "CRM", status: "todo", priority: "high" });
    const ctx = toolContext(db, ecom);

    expect(() => runWrite(ctx, "addDependency", { issueKey: ecomIssue.key, dependsOnKey: crmIssue.key })).toThrow(
      /No issue with key/,
    );
  });

  it("a cross-project parent is rejected even when both ids are valid", () => {
    const ecomIssue = createIssue(db, { projectId: ecom, type: "task", title: "ECOM", status: "todo", priority: "high" });
    const crmIssue = createIssue(db, { projectId: crm, type: "epic", title: "CRM epic", status: "todo", priority: "high" });

    // Bypassing key resolution entirely, the way a bug or a malicious id would.
    expect(() => setParent(db, ecomIssue.id, crmIssue.id)).toThrow(/same project/i);
  });

  it("reads are scoped to the turn's project", () => {
    createIssue(db, { projectId: ecom, type: "task", title: "ECOM only", status: "todo", priority: "high" });
    createIssue(db, { projectId: crm, type: "task", title: "CRM only", status: "todo", priority: "high" });

    const backlog = writeTool("createIssue"); // sanity: registry resolves
    expect(backlog.name).toBe("createIssue");

    const ecomIssues = issuesRepo.listIssuesByProject(db, ecom);
    const crmIssues = issuesRepo.listIssuesByProject(db, crm);
    expect(ecomIssues.map((i) => i.title)).toEqual(["ECOM only"]);
    expect(crmIssues.map((i) => i.title)).toEqual(["CRM only"]);
    expect(ecomIssues[0]!.key.startsWith("ECOM-")).toBe(true);
    expect(crmIssues[0]!.key.startsWith("CRM-")).toBe(true);
  });

  it("memory is project-scoped", () => {
    const ctx = toolContext(db, ecom);
    runWrite(ctx, "createDecision", { title: "Use Redis for token revocation", rationale: "Stated by the user" });
    runWrite(ctx, "createMilestone", { title: "Beta launch" });

    expect(decisionsRepo.listDecisionsByProject(db, ecom)).toHaveLength(1);
    expect(decisionsRepo.listDecisionsByProject(db, crm)).toHaveLength(0);
    expect(milestonesRepo.listMilestonesByProject(db, ecom)).toHaveLength(1);
    expect(milestonesRepo.listMilestonesByProject(db, crm)).toHaveLength(0);
  });

  it("a tool with no project in context refuses rather than picking one", () => {
    const ctx = toolContext(db, null);
    expect(() => runWrite(ctx, "createIssue", { title: "Orphan" })).toThrow(/needs a project/i);
  });
});
