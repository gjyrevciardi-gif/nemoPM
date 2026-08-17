import { describe, expect, it } from "vitest";
import type { Issue, Sprint } from "@ai-pm/shared";
import { computeBurndown } from "../src/burndown-engine.js";

const NOW = new Date("2026-08-14T12:00:00.000Z");

const sprint: Sprint = {
  id: "s1",
  projectId: "p1",
  name: "Sprint 1",
  goal: null,
  status: "active",
  startedAt: "2026-08-12T09:00:00.000Z",
  completedAt: null,
  createdAt: "2026-08-12T00:00:00.000Z",
};

function makeIssue(overrides: Partial<Issue> & Pick<Issue, "id" | "key" | "status">): Issue {
  return {
    projectId: "p1",
    parentId: null,
    type: "task",
    title: overrides.key,
    description: null,
    priority: "medium",
    storyPoints: 0,
    sprintId: "s1",
    position: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("computeBurndown", () => {
  it("returns an empty series when the sprint has not started", () => {
    const notStarted: Sprint = { ...sprint, startedAt: null };
    const issue = makeIssue({ id: "i1", key: "ACME-2", status: "todo", storyPoints: 5 });
    const result = computeBurndown(notStarted, [issue], NOW);
    expect(result.totalPoints).toBe(5);
    expect(result.points).toHaveLength(0);
  });

  it("builds one point per day from sprint start through now, remaining points dropping after completion", () => {
    const done = makeIssue({
      id: "i1",
      key: "ACME-2",
      status: "done",
      storyPoints: 5,
      completedAt: "2026-08-13T10:00:00.000Z",
    });
    const remaining = makeIssue({ id: "i2", key: "ACME-3", status: "todo", storyPoints: 3 });

    const result = computeBurndown(sprint, [done, remaining], NOW);

    expect(result.totalPoints).toBe(8);
    expect(result.points).toHaveLength(3); // Aug 12, 13, 14
    expect(result.points[0]).toMatchObject({ date: "2026-08-12", remainingPoints: 8, completedPoints: 0 });
    expect(result.points[1]).toMatchObject({ date: "2026-08-13", remainingPoints: 3, completedPoints: 5 });
    expect(result.points[2]).toMatchObject({ date: "2026-08-14", remainingPoints: 3, completedPoints: 5 });
  });

  it("stops the series at the sprint's completion date rather than now", () => {
    const completedSprint: Sprint = { ...sprint, completedAt: "2026-08-13T00:00:00.000Z" };
    const done = makeIssue({
      id: "i1",
      key: "ACME-2",
      status: "done",
      storyPoints: 5,
      completedAt: "2026-08-12T23:00:00.000Z",
    });

    const result = computeBurndown(completedSprint, [done], NOW);

    expect(result.points).toHaveLength(2); // Aug 12, 13 -- not through Aug 14 (now)
  });
});
