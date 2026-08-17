import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb, issuesRepo, projectsRepo, sprintsRepo } from "@ai-pm/database";
import { carryOverUnfinishedIssues } from "../src/sprints.js";

describe("carryOverUnfinishedIssues", () => {
  let db: Database.Database;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    projectId = projectsRepo.createProject(db, { name: "Acme SaaS", key: "ACME" }).id;
  });

  it("moves only not-done issues from the source sprint into the destination sprint", () => {
    const from = sprintsRepo.createSprint(db, { projectId, name: "Sprint 1" });
    const to = sprintsRepo.createSprint(db, { projectId, name: "Sprint 2" });

    const unfinished = issuesRepo.createIssue(db, {
      projectId,
      type: "task",
      title: "Unfinished",
      status: "in_progress",
      priority: "medium",
      sprintId: from.id,
    });
    const done = issuesRepo.createIssue(db, {
      projectId,
      type: "task",
      title: "Done",
      status: "done",
      priority: "medium",
      sprintId: from.id,
    });

    const carried = carryOverUnfinishedIssues(db, from.id, to.id);

    expect(carried.map((i) => i.id)).toEqual([unfinished.id]);
    expect(issuesRepo.getIssue(db, unfinished.id)?.sprintId).toBe(to.id);
    expect(issuesRepo.getIssue(db, done.id)?.sprintId).toBe(from.id);
  });
});
