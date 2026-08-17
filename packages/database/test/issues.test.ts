import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../src/db.js";
import * as projectsRepo from "../src/repositories/projects.js";
import * as issuesRepo from "../src/repositories/issues.js";
import * as dependenciesRepo from "../src/repositories/dependencies.js";
import * as activitiesRepo from "../src/repositories/activities.js";

describe("issue workflow", () => {
  let db: Database.Database;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    const project = projectsRepo.createProject(db, { name: "Acme SaaS", key: "ACME" });
    projectId = project.id;
  });

  it("creates issues with sequential human-friendly keys", () => {
    const a = issuesRepo.createIssue(db, {
      projectId,
      type: "story",
      title: "First",
      status: "backlog",
      priority: "medium",
    });
    const b = issuesRepo.createIssue(db, {
      projectId,
      type: "story",
      title: "Second",
      status: "backlog",
      priority: "medium",
    });
    expect(a.key).toBe("ACME-1");
    expect(b.key).toBe("ACME-2");
  });

  it("starting an issue sets status, startedAt, and logs activity", () => {
    const issue = issuesRepo.createIssue(db, {
      projectId,
      type: "task",
      title: "Login API",
      status: "todo",
      priority: "high",
    });
    expect(issue.startedAt).toBeNull();

    const started = issuesRepo.startIssue(db, issue.id);
    expect(started.status).toBe("in_progress");
    expect(started.startedAt).not.toBeNull();

    const activity = activitiesRepo.listActivityByIssue(db, issue.id);
    expect(activity.some((a) => a.type === "issue.started")).toBe(true);
  });

  it("completing an issue sets status done, completedAt, and logs activity", () => {
    const issue = issuesRepo.createIssue(db, {
      projectId,
      type: "task",
      title: "Login API",
      status: "todo",
      priority: "high",
    });
    issuesRepo.startIssue(db, issue.id);
    const completed = issuesRepo.completeIssue(db, issue.id);

    expect(completed.status).toBe("done");
    expect(completed.completedAt).not.toBeNull();

    const activity = activitiesRepo.listActivityByIssue(db, issue.id);
    expect(activity.some((a) => a.type === "issue.completed")).toBe(true);
  });

  it("never marks an issue done as a side effect of anything but an explicit complete action", () => {
    const issue = issuesRepo.createIssue(db, {
      projectId,
      type: "task",
      title: "Login API",
      status: "todo",
      priority: "high",
    });
    issuesRepo.startIssue(db, issue.id);
    // Simulate git activity / generic updates that must never flip status to done.
    issuesRepo.updateIssue(db, issue.id, { description: "Updated from git scan context" });
    const reloaded = issuesRepo.getIssue(db, issue.id);
    expect(reloaded?.status).toBe("in_progress");
  });

  it("records a dependency between two issues", () => {
    const login = issuesRepo.createIssue(db, {
      projectId,
      type: "story",
      title: "Login API",
      status: "in_progress",
      priority: "high",
    });
    const recovery = issuesRepo.createIssue(db, {
      projectId,
      type: "story",
      title: "Password Recovery",
      status: "todo",
      priority: "medium",
    });

    dependenciesRepo.addDependency(db, recovery.id, login.id);
    const deps = dependenciesRepo.listDependencies(db, recovery.id);
    expect(deps).toHaveLength(1);
    expect(deps[0]?.dependsOnIssueId).toBe(login.id);
  });
});
