import { describe, expect, it } from "vitest";
import type { Issue, IssueDependency, Sprint } from "@ai-pm/shared";
import { computeRisks } from "../src/risk-engine.js";

const BASE_NOW = new Date("2026-08-14T12:00:00.000Z");

function makeIssue(overrides: Partial<Issue> & Pick<Issue, "id" | "key" | "status">): Issue {
  return {
    projectId: "proj-1",
    parentId: null,
    type: "task",
    title: overrides.key,
    description: null,
    priority: "medium",
    storyPoints: null,
    sprintId: null,
    position: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("computeRisks: stale_task", () => {
  it("flags a medium risk between 2 and 5 days of no activity", () => {
    const lastActivity = new Date(BASE_NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const issue = makeIssue({
      id: "i1",
      key: "ACME-2",
      status: "in_progress",
      startedAt: lastActivity,
      updatedAt: lastActivity,
    });
    const risks = computeRisks({
      issues: [issue],
      dependencies: [],
      activeSprint: null,
      lastActivityAtByIssue: { i1: lastActivity },
      now: BASE_NOW,
    });
    expect(risks).toHaveLength(1);
    expect(risks[0]?.type).toBe("stale_task");
    expect(risks[0]?.severity).toBe("medium");
  });

  it("escalates to high risk past 5 days of no activity", () => {
    const lastActivity = new Date(BASE_NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const issue = makeIssue({
      id: "i1",
      key: "ACME-2",
      status: "in_progress",
      startedAt: lastActivity,
      updatedAt: lastActivity,
    });
    const risks = computeRisks({
      issues: [issue],
      dependencies: [],
      activeSprint: null,
      lastActivityAtByIssue: { i1: lastActivity },
      now: BASE_NOW,
    });
    expect(risks).toHaveLength(1);
    expect(risks[0]?.severity).toBe("high");
  });

  it("does not flag a recently active in_progress issue", () => {
    const issue = makeIssue({
      id: "i1",
      key: "ACME-2",
      status: "in_progress",
      updatedAt: BASE_NOW.toISOString(),
    });
    const risks = computeRisks({
      issues: [issue],
      dependencies: [],
      activeSprint: null,
      lastActivityAtByIssue: { i1: BASE_NOW.toISOString() },
      now: BASE_NOW,
    });
    expect(risks).toHaveLength(0);
  });

  it("does not flag issues that are not in_progress", () => {
    const issue = makeIssue({
      id: "i1",
      key: "ACME-3",
      status: "todo",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const risks = computeRisks({
      issues: [issue],
      dependencies: [],
      activeSprint: null,
      lastActivityAtByIssue: {},
      now: BASE_NOW,
    });
    expect(risks).toHaveLength(0);
  });
});

describe("computeRisks: dependency", () => {
  const sprint: Sprint = {
    id: "s1",
    projectId: "proj-1",
    name: "Sprint 1",
    goal: null,
    status: "active",
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: null,
    createdAt: "2026-08-12T00:00:00.000Z",
  };

  it("flags a dependency risk when the blocking issue is unfinished and both are in the active sprint", () => {
    const login = makeIssue({ id: "login", key: "ACME-2", status: "in_progress", sprintId: "s1" });
    const recovery = makeIssue({ id: "recovery", key: "ACME-4", status: "todo", sprintId: "s1" });
    const dep: IssueDependency = {
      id: "d1",
      issueId: "recovery",
      dependsOnIssueId: "login",
      createdAt: "2026-08-12T00:00:00.000Z",
    };

    const risks = computeRisks({
      issues: [login, recovery],
      dependencies: [dep],
      activeSprint: sprint,
      lastActivityAtByIssue: { login: BASE_NOW.toISOString(), recovery: BASE_NOW.toISOString() },
      now: BASE_NOW,
    });

    const depRisk = risks.find((r) => r.type === "dependency");
    expect(depRisk).toBeDefined();
    expect(depRisk?.issueId).toBe("recovery");
    expect(depRisk?.evidence).toContain("ACME-2 status: in_progress");
    expect(depRisk?.evidence).toContain("ACME-4 status: todo");
  });

  it("does not flag a dependency risk once the blocking issue is done", () => {
    const login = makeIssue({ id: "login", key: "ACME-2", status: "done", sprintId: "s1" });
    const recovery = makeIssue({ id: "recovery", key: "ACME-4", status: "todo", sprintId: "s1" });
    const dep: IssueDependency = {
      id: "d1",
      issueId: "recovery",
      dependsOnIssueId: "login",
      createdAt: "2026-08-12T00:00:00.000Z",
    };

    const risks = computeRisks({
      issues: [login, recovery],
      dependencies: [dep],
      activeSprint: sprint,
      lastActivityAtByIssue: {},
      now: BASE_NOW,
    });

    expect(risks.find((r) => r.type === "dependency")).toBeUndefined();
  });

  it("does not flag a dependency risk when the dependent issue is not in the active sprint", () => {
    const login = makeIssue({ id: "login", key: "ACME-2", status: "in_progress", sprintId: "s1" });
    const recovery = makeIssue({ id: "recovery", key: "ACME-4", status: "todo", sprintId: null });
    const dep: IssueDependency = {
      id: "d1",
      issueId: "recovery",
      dependsOnIssueId: "login",
      createdAt: "2026-08-12T00:00:00.000Z",
    };

    const risks = computeRisks({
      issues: [login, recovery],
      dependencies: [dep],
      activeSprint: sprint,
      lastActivityAtByIssue: {},
      now: BASE_NOW,
    });

    expect(risks.find((r) => r.type === "dependency")).toBeUndefined();
  });
});

describe("computeRisks: sprint_delivery", () => {
  it("flags overload when no points have been completed after the sprint has run for a while", () => {
    const sprint: Sprint = {
      id: "s1",
      projectId: "proj-1",
      name: "Sprint 1",
      goal: null,
      status: "active",
      startedAt: new Date(BASE_NOW.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      completedAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const issue = makeIssue({
      id: "i1",
      key: "ACME-3",
      status: "todo",
      sprintId: "s1",
      storyPoints: 8,
    });

    const risks = computeRisks({
      issues: [issue],
      dependencies: [],
      activeSprint: sprint,
      lastActivityAtByIssue: {},
      now: BASE_NOW,
    });

    const sprintRisk = risks.find((r) => r.type === "sprint_delivery");
    expect(sprintRisk).toBeDefined();
    expect(sprintRisk?.severity).toBe("high");
  });

  it("does not flag a healthy sprint with points completed on pace", () => {
    const sprint: Sprint = {
      id: "s1",
      projectId: "proj-1",
      name: "Sprint 1",
      goal: null,
      status: "active",
      startedAt: new Date(BASE_NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      completedAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const done = makeIssue({
      id: "i1",
      key: "ACME-2",
      status: "done",
      sprintId: "s1",
      storyPoints: 5,
      completedAt: BASE_NOW.toISOString(),
    });
    const remaining = makeIssue({
      id: "i2",
      key: "ACME-3",
      status: "todo",
      sprintId: "s1",
      storyPoints: 3,
    });

    const risks = computeRisks({
      issues: [done, remaining],
      dependencies: [],
      activeSprint: sprint,
      lastActivityAtByIssue: {},
      now: BASE_NOW,
    });

    expect(risks.find((r) => r.type === "sprint_delivery")).toBeUndefined();
  });
});
