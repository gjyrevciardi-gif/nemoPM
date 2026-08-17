import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb, projectsRepo, sprintsRepo } from "@ai-pm/database";
import { getAgentTool } from "../src/tools.js";
import { createIssue, getIssue } from "../src/issues.js";

describe("agent tools", () => {
  let db: Database.Database;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = projectsRepo.createProject(db, { name: "Acme SaaS", key: "ACME" }).id;
  });

  it("createIssue is AUTO-tier and creates an issue via execute()", () => {
    const tool = getAgentTool("createIssue")!;
    const args = tool.schema.parse({ title: "Fix login bug", type: "bug", priority: "high" });
    const result = tool.execute(db, projectId, args);
    expect(result.summary).toContain("ACME-1");
    expect(tool.tier).toBe("auto");
  });

  it("changeIssueStatus resolves by key and moves the issue", () => {
    const issue = createIssue(db, { projectId, type: "task", title: "Do it", status: "todo", priority: "medium" });
    const tool = getAgentTool("changeIssueStatus")!;
    const args = tool.schema.parse({ issueKey: issue.key, status: "in_progress" });
    const result = tool.execute(db, projectId, args);
    expect(result.summary).toContain("in_progress");
  });

  it("changeIssueStatus throws a clear error for an unknown key", () => {
    const tool = getAgentTool("changeIssueStatus")!;
    const args = tool.schema.parse({ issueKey: "ACME-999", status: "done" });
    expect(() => tool.execute(db, projectId, args)).toThrow(/No issue with key/);
  });

  it("planSprint is ASK-tier, describe() never mutates, and execute() creates+starts a sprint with the given issues", () => {
    const a = createIssue(db, { projectId, type: "task", title: "A", status: "todo", priority: "medium", storyPoints: 3 });
    const b = createIssue(db, { projectId, type: "task", title: "B", status: "todo", priority: "medium", storyPoints: 5 });

    const tool = getAgentTool("planSprint")!;
    expect(tool.tier).toBe("ask");
    const args = tool.schema.parse({ name: "Sprint 1", issueKeys: [a.key, b.key] });

    const description = tool.describe(db, projectId, args);
    expect(description).toContain("Total: 8 pts");
    expect(sprintsRepo.listSprintsByProject(db, projectId)).toHaveLength(0); // describe() must not mutate

    const result = tool.execute(db, projectId, args);
    expect(result.summary).toContain("2 issue(s)");
    const sprints = sprintsRepo.listSprintsByProject(db, projectId);
    expect(sprints).toHaveLength(1);
    expect(sprints[0]!.status).toBe("active");
  });

  it("planSprint with carryOverFromActiveSprint moves unfinished issues from the previously active sprint", () => {
    const oldSprint = sprintsRepo.createSprint(db, { projectId, name: "Sprint 1" });
    sprintsRepo.startSprint(db, oldSprint.id);
    const unfinished = createIssue(db, {
      projectId,
      type: "task",
      title: "Carried",
      status: "in_progress",
      priority: "medium",
      sprintId: oldSprint.id,
    });
    createIssue(db, {
      projectId,
      type: "task",
      title: "Done already",
      status: "done",
      priority: "medium",
      sprintId: oldSprint.id,
    });

    const tool = getAgentTool("planSprint")!;
    const args = tool.schema.parse({ name: "Sprint 2", issueKeys: [], carryOverFromActiveSprint: true });
    const result = tool.execute(db, projectId, args);

    expect(result.summary).toContain("carried over 1 unfinished issue(s)");
    const newSprint = sprintsRepo.listSprintsByProject(db, projectId).find((s) => s.name === "Sprint 2")!;
    expect(unfinished.sprintId).toBe(oldSprint.id); // stale local copy, unaffected
    const reloaded = getIssue(db, unfinished.id);
    expect(reloaded?.sprintId).toBe(newSprint.id);
  });
});
