import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb, projectsRepo, sprintsRepo } from "@ai-pm/database";
import { confirmPlanTask } from "../src/plan.js";

const TASKS = [
  { title: "Do the thing", type: "task" as const, description: "", storyPoints: 3, priority: "medium" as const },
];

describe("confirmPlanTask", () => {
  let db: Database.Database;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = projectsRepo.createProject(db, { name: "Acme SaaS", key: "ACME" }).id;
  });

  it("leaves issues in the backlog when sprintId is explicitly null", () => {
    const result = confirmPlanTask(db, projectId, { sprintId: null, tasks: TASKS, autoSprint: true });
    expect(result.sprintId).toBeNull();
    expect(result.issues.every((i) => i.sprintId === null)).toBe(true);
  });

  it("leaves issues in the backlog when neither sprintId nor autoSprint is set", () => {
    const result = confirmPlanTask(db, projectId, { tasks: TASKS });
    expect(result.sprintId).toBeNull();
  });

  it("adds issues to the active sprint when autoSprint is set and one exists", () => {
    const sprint = sprintsRepo.createSprint(db, { projectId, name: "Sprint 1" });
    sprintsRepo.startSprint(db, sprint.id);

    const result = confirmPlanTask(db, projectId, { tasks: TASKS, feature: "Login", autoSprint: true });
    expect(result.sprintId).toBe(sprint.id);
    expect(result.issues.every((i) => i.sprintId === sprint.id)).toBe(true);
  });

  it("creates and starts a new sprint named after the feature when autoSprint is set and none is active", () => {
    const result = confirmPlanTask(db, projectId, { tasks: TASKS, feature: "Login", autoSprint: true });
    expect(result.sprintId).not.toBeNull();

    const sprint = sprintsRepo.getSprint(db, result.sprintId!);
    expect(sprint?.name).toBe("Login");
    expect(sprint?.status).toBe("active");
  });

  it("adds issues to an explicit sprintId even when autoSprint is also set", () => {
    const sprint = sprintsRepo.createSprint(db, { projectId, name: "Sprint 1" });
    const result = confirmPlanTask(db, projectId, { sprintId: sprint.id, tasks: TASKS, autoSprint: true });
    expect(result.sprintId).toBe(sprint.id);
  });
});
