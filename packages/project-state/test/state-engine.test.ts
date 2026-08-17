import { describe, expect, it } from "vitest";
import type { GitStatus, Issue, IssueDependency, Project, Risk, Sprint } from "@ai-pm/shared";
import { computeProjectState } from "../src/state-engine.js";

const NOW = new Date("2026-08-14T12:00:00.000Z");

const project: Project = {
  id: "p1",
  name: "Acme SaaS",
  key: "ACME",
  description: null,
  repositoryPath: "/repo",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const sprint: Sprint = {
  id: "s1",
  projectId: "p1",
  name: "Sprint 1",
  goal: null,
  status: "active",
  startedAt: "2026-08-12T00:00:00.000Z",
  completedAt: null,
  createdAt: "2026-08-12T00:00:00.000Z",
};

const emptyGit: GitStatus = {
  connected: false,
  repositoryPath: null,
  error: null,
  branch: null,
  isClean: null,
  stagedFiles: [],
  unstagedFiles: [],
  recentCommits: [],
  latestCommitAt: null,
};

function makeIssue(overrides: Partial<Issue> & Pick<Issue, "id" | "key" | "status">): Issue {
  return {
    projectId: "p1",
    parentId: null,
    type: "story",
    title: overrides.key,
    description: null,
    priority: "medium",
    storyPoints: 0,
    sprintId: null,
    position: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("computeProjectState", () => {
  it("computes sprint-scoped metrics and picks the active issue", () => {
    const login = makeIssue({
      id: "login",
      key: "ACME-2",
      status: "in_progress",
      sprintId: "s1",
      storyPoints: 5,
      startedAt: "2026-08-13T00:00:00.000Z",
    });
    const dashboard = makeIssue({
      id: "dash",
      key: "ACME-3",
      status: "done",
      sprintId: "s1",
      storyPoints: 5,
      completedAt: "2026-08-13T00:00:00.000Z",
    });
    const outOfSprint = makeIssue({
      id: "billing",
      key: "ACME-5",
      status: "backlog",
      sprintId: null,
      storyPoints: 8,
    });

    const state = computeProjectState({
      project,
      issues: [login, dashboard, outOfSprint],
      activeSprint: sprint,
      dependencies: [],
      git: emptyGit,
      lastActivityAtByIssue: {},
      risks: [],
      now: NOW,
    });

    expect(state.activeIssue?.id).toBe("login");
    expect(state.metrics.scope).toBe("sprint");
    expect(state.metrics.totalIssues).toBe(2); // sprint-scoped, excludes billing
    expect(state.metrics.completedIssues).toBe(1);
    expect(state.metrics.totalPoints).toBe(10);
    expect(state.metrics.completedPoints).toBe(5);
    expect(state.metrics.remainingPoints).toBe(5);
  });

  it("falls back to project-wide metrics when there is no active sprint", () => {
    const a = makeIssue({ id: "a", key: "ACME-1", status: "done", storyPoints: 2 });
    const b = makeIssue({ id: "b", key: "ACME-2", status: "todo", storyPoints: 3 });

    const state = computeProjectState({
      project,
      issues: [a, b],
      activeSprint: null,
      dependencies: [],
      git: emptyGit,
      lastActivityAtByIssue: {},
      risks: [],
      now: NOW,
    });

    expect(state.metrics.scope).toBe("project");
    expect(state.metrics.totalIssues).toBe(2);
    expect(state.sprint).toBeNull();
  });

  it("builds dependency statuses with satisfied flags", () => {
    const login = makeIssue({ id: "login", key: "ACME-2", status: "in_progress" });
    const recovery = makeIssue({ id: "recovery", key: "ACME-4", status: "todo" });
    const dep: IssueDependency = {
      id: "d1",
      issueId: "recovery",
      dependsOnIssueId: "login",
      createdAt: "2026-08-12T00:00:00.000Z",
    };

    const state = computeProjectState({
      project,
      issues: [login, recovery],
      activeSprint: null,
      dependencies: [dep],
      git: emptyGit,
      lastActivityAtByIssue: {},
      risks: [],
      now: NOW,
    });

    expect(state.dependencies).toHaveLength(1);
    expect(state.dependencies[0]?.satisfied).toBe(false);
    expect(state.dependencies[0]?.dependsOnKey).toBe("ACME-2");
  });

  it("surfaces stale in_progress issues", () => {
    const stale = makeIssue({
      id: "stale1",
      key: "ACME-6",
      status: "in_progress",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const state = computeProjectState({
      project,
      issues: [stale],
      activeSprint: null,
      dependencies: [],
      git: emptyGit,
      lastActivityAtByIssue: { stale1: "2026-08-01T00:00:00.000Z" },
      risks: [],
      now: NOW,
    });

    expect(state.staleIssues).toHaveLength(1);
    expect(state.staleIssues[0]?.issueKey).toBe("ACME-6");
    expect(state.staleIssues[0]?.daysSinceActivity).toBeGreaterThan(2);
  });

  it("passes through reconciled open risks unchanged", () => {
    const risk: Risk = {
      id: "r1",
      projectId: "p1",
      issueId: "recovery",
      type: "dependency",
      severity: "high",
      status: "open",
      message: "ACME-4 depends on unfinished ACME-2.",
      evidence: ["ACME-2 status: in_progress", "ACME-4 status: todo"],
      createdAt: "2026-08-13T00:00:00.000Z",
      resolvedAt: null,
    };

    const state = computeProjectState({
      project,
      issues: [],
      activeSprint: null,
      dependencies: [],
      git: emptyGit,
      lastActivityAtByIssue: {},
      risks: [risk],
      now: NOW,
    });

    expect(state.risks).toEqual([risk]);
  });
});
