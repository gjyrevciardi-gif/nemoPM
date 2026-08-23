import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb, issuesRepo, projectsRepo, sprintsRepo } from "@ai-pm/database";
import { getAgentTool } from "../src/index.js";
import { createIssue, getIssue } from "../src/issues.js";
import { describeWrite, runWrite, toolContext, writeTool } from "./helpers.js";

describe("agent tools", () => {
  let db: Database.Database;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = projectsRepo.createProject(db, { name: "Acme SaaS", key: "ACME" }).id;
  });

  it("createIssue is AUTO-tier and creates an issue via execute()", () => {
    const ctx = toolContext(db, projectId);
    expect(writeTool("createIssue").tier).toBe("auto");
    expect(runWrite(ctx, "createIssue", { title: "Fix login bug", type: "bug", priority: "high" })).toContain(
      "ACME-1",
    );
  });

  it("changeIssueStatus resolves by key and moves the issue", () => {
    const ctx = toolContext(db, projectId);
    const issue = createIssue(db, { projectId, type: "task", title: "Do it", status: "todo", priority: "medium" });
    expect(runWrite(ctx, "changeIssueStatus", { issueKey: issue.key, status: "in_progress" })).toContain(
      "in_progress",
    );
  });

  it("changeIssueStatus refuses an invented key instead of guessing a near match", () => {
    const ctx = toolContext(db, projectId);
    createIssue(db, { projectId, type: "task", title: "Real work", status: "todo", priority: "medium" });
    expect(() => runWrite(ctx, "changeIssueStatus", { issueKey: "ACME-999", status: "done" })).toThrow(
      /No issue with key/,
    );
    expect(() => runWrite(ctx, "updateIssue", { issueKey: "ABC-999", title: "x" })).toThrow(/No issue with key/);
  });

  it("planSprint is ASK-tier, describe() never mutates, and execute() creates+starts a sprint", () => {
    const ctx = toolContext(db, projectId);
    const a = createIssue(db, { projectId, type: "task", title: "A", status: "todo", priority: "medium", storyPoints: 3 });
    const b = createIssue(db, { projectId, type: "task", title: "B", status: "todo", priority: "medium", storyPoints: 5 });

    expect(writeTool("planSprint").tier).toBe("ask");

    const description = describeWrite(ctx, "planSprint", { name: "Sprint 1", issueKeys: [a.key, b.key] });
    expect(description).toContain("Total: 8 pts");
    expect(sprintsRepo.listSprintsByProject(db, projectId)).toHaveLength(0); // describe() must not mutate

    const summary = runWrite(ctx, "planSprint", { name: "Sprint 1", issueKeys: [a.key, b.key] });
    expect(summary).toContain("2 issue(s)");
    const sprints = sprintsRepo.listSprintsByProject(db, projectId);
    expect(sprints).toHaveLength(1);
    expect(sprints[0]!.status).toBe("active");
  });

  it("planSprint carries unfinished work and leaves finished work in the old sprint", () => {
    const ctx = toolContext(db, projectId);
    const oldSprint = sprintsRepo.createSprint(db, { projectId, name: "Sprint 1" });
    sprintsRepo.startSprint(db, oldSprint.id);
    const unfinished = createIssue(db, {
      projectId, type: "task", title: "Carried", status: "in_progress", priority: "medium", sprintId: oldSprint.id,
    });
    const finished = createIssue(db, {
      projectId, type: "task", title: "Done already", status: "done", priority: "medium", sprintId: oldSprint.id,
    });

    const summary = runWrite(ctx, "planSprint", {
      name: "Sprint 2",
      issueKeys: [],
      carryOverFromActiveSprint: true,
      completeActiveSprint: true,
    });
    expect(summary).toContain("carried 1 unfinished issue(s)");

    const newSprint = sprintsRepo.listSprintsByProject(db, projectId).find((s) => s.name === "Sprint 2")!;
    expect(getIssue(db, unfinished.id)?.sprintId).toBe(newSprint.id);
    expect(getIssue(db, finished.id)?.sprintId).toBe(oldSprint.id);
  });

  it("planSprint enforces maxPoints and can deterministically select backlog within capacity",()=>{
    const ctx=toolContext(db,projectId);
    const high=createIssue(db,{projectId,type:"task",title:"High",status:"backlog",priority:"high",storyPoints:8});
    const medium=createIssue(db,{projectId,type:"task",title:"Medium",status:"backlog",priority:"medium",storyPoints:5});
    expect(()=>describeWrite(ctx,"planSprint",{name:"Too large",issueKeys:[high.key,medium.key],maxPoints:12})).toThrow(/above maxPoints 12/);
    const description=describeWrite(ctx,"planSprint",{name:"Bounded",issueKeys:[],maxPoints:12,avoidBlocked:true,start:false});
    expect(description).toContain("High");
    expect(description).not.toContain("Medium");
    expect(description).toContain("Total: 8 pts");
  });

  it("planSprint refuses to start a second sprint unless the plan closes the active one", () => {
    const ctx = toolContext(db, projectId);
    const first = sprintsRepo.createSprint(db, { projectId, name: "Sprint 1" });
    sprintsRepo.startSprint(db, first.id);

    expect(() => runWrite(ctx, "planSprint", { name: "Sprint 2", issueKeys: [] })).toThrow(/still active/i);
    expect(sprintsRepo.listSprintsByProject(db, projectId).filter((s) => s.status === "active")).toHaveLength(1);

    runWrite(ctx, "planSprint", { name: "Sprint 2", issueKeys: [], completeActiveSprint: true });
    const active = sprintsRepo.listSprintsByProject(db, projectId).filter((s) => s.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe("Sprint 2");
  });

  it("createSubtasks inherits the parent's sprint so split work stays committed", () => {
    const ctx = toolContext(db, projectId);
    const sprint = sprintsRepo.createSprint(db, { projectId, name: "Sprint 1" });
    const parent = createIssue(db, {
      projectId, type: "story", title: "Checkout", status: "todo", priority: "high", sprintId: sprint.id,
    });

    const summary = runWrite(ctx, "createSubtasks", {
      parentKey: parent.key,
      subtasks: [{ title: "Cart totals", storyPoints: 3 }, { title: "Payment step", storyPoints: 5 }],
    });
    expect(summary).toContain("2 subtask(s)");

    const children = issuesRepo.listIssuesByProject(db, projectId).filter((i) => i.parentId === parent.id);
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.sprintId === sprint.id)).toBe(true);
    expect(children.every((child) => child.type === "subtask")).toBe(true);
  });

  it("setParent rejects cycles rather than corrupting the hierarchy", () => {
    const ctx = toolContext(db, projectId);
    const parent = createIssue(db, { projectId, type: "epic", title: "Epic", status: "todo", priority: "medium" });
    const child = createIssue(db, { projectId, type: "task", title: "Child", status: "todo", priority: "medium" });

    runWrite(ctx, "setParent", { issueKey: child.key, parentKey: parent.key });
    expect(() => runWrite(ctx, "setParent", { issueKey: parent.key, parentKey: child.key })).toThrow(/circular/i);
    expect(() => runWrite(ctx, "setParent", { issueKey: parent.key, parentKey: parent.key })).toThrow(/own parent/i);
  });

  it("removeIssueFromSprint returns issues to the backlog and reports the points removed", () => {
    const ctx = toolContext(db, projectId);
    const sprint = sprintsRepo.createSprint(db, { projectId, name: "Sprint 1" });
    sprintsRepo.startSprint(db, sprint.id);
    const low = createIssue(db, {
      projectId, type: "task", title: "Nice to have", status: "todo", priority: "low", storyPoints: 3, sprintId: sprint.id,
    });

    const description = describeWrite(ctx, "removeIssueFromSprint", { issueKeys: [low.key] });
    expect(description).toContain(low.key);
    expect(getIssue(db, low.id)?.sprintId).toBe(sprint.id); // describe() must not mutate

    runWrite(ctx, "removeIssueFromSprint", { issueKeys: [low.key] });
    expect(getIssue(db, low.id)?.sprintId).toBeNull();
  });

  it("addDependency refuses self-dependency", () => {
    const ctx = toolContext(db, projectId);
    const issue = createIssue(db, { projectId, type: "task", title: "Solo", status: "todo", priority: "medium" });
    expect(() => runWrite(ctx, "addDependency", { issueKey: issue.key, dependsOnKey: issue.key })).toThrow(
      /cannot depend on itself/i,
    );
  });

  it("blocked tools are registered but never offered to the model", () => {
    expect(getAgentTool("deleteProject")?.tier).toBe("blocked");
    expect(getAgentTool("bulkDeleteIssues")?.tier).toBe("blocked");
  });
});
