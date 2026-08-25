import { describe, expect, it } from "vitest";
import type { Issue } from "@ai-pm/shared";
import { computeAbandonedBranchRisks, computeGitRisks, computeNoCommitRisks } from "../src/git-risk-engine.js";

const NOW = new Date("2026-03-20T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function issue(overrides: Partial<Issue> & { id: string; key: string }): Issue {
  return {
    projectId: "p1",
    type: "task",
    title: overrides.key,
    description: null,
    status: "in_progress",
    priority: "medium",
    storyPoints: null,
    sprintId: null,
    parentId: null,
    orderIndex: 0,
    startedAt: daysAgo(10),
    completedAt: null,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(10),
    ...overrides,
  } as Issue;
}

/**
 * The board can say work is happening while nothing is being written. These
 * rules exist so the repository gets to disagree.
 */
describe("in progress with no commits", () => {
  it("flags an issue nobody has committed against", () => {
    const risks = computeNoCommitRisks({
      issues: [issue({ id: "i1", key: "WAL-1" })],
      lastCommitAtByIssue: {},
      branches: [],
      now: NOW,
    });

    expect(risks).toHaveLength(1);
    expect(risks[0]!.type).toBe("no_commits");
    expect(risks[0]!.message).toContain("WAL-1");
    expect(risks[0]!.evidence.join(" ")).toContain("No commit message references WAL-1");
  });

  it("escalates the longer the silence runs", () => {
    const fresh = computeNoCommitRisks({
      issues: [issue({ id: "i1", key: "WAL-1", startedAt: daysAgo(4) })],
      lastCommitAtByIssue: {},
      branches: [],
      now: NOW,
    });
    const old = computeNoCommitRisks({
      issues: [issue({ id: "i1", key: "WAL-1", startedAt: daysAgo(30) })],
      lastCommitAtByIssue: {},
      branches: [],
      now: NOW,
    });

    expect(fresh[0]!.severity).toBe("medium");
    expect(old[0]!.severity).toBe("high");
  });

  it("says nothing about work that has just started", () => {
    const risks = computeNoCommitRisks({
      issues: [issue({ id: "i1", key: "WAL-1", startedAt: daysAgo(1) })],
      lastCommitAtByIssue: {},
      branches: [],
      now: NOW,
    });

    expect(risks).toEqual([]);
  });

  it("stays quiet when commits are still landing", () => {
    const risks = computeNoCommitRisks({
      issues: [issue({ id: "i1", key: "WAL-1" })],
      lastCommitAtByIssue: { i1: daysAgo(1) },
      branches: [],
      now: NOW,
    });

    expect(risks).toEqual([]);
  });

  it("flags an issue whose commits dried up, and says when", () => {
    const risks = computeNoCommitRisks({
      issues: [issue({ id: "i1", key: "WAL-1" })],
      lastCommitAtByIssue: { i1: daysAgo(9) },
      branches: [],
      now: NOW,
    });

    expect(risks[0]!.message).toContain("nothing has been committed against it for 9 day(s)");
  });

  it("ignores issues that are not in progress", () => {
    for (const status of ["todo", "backlog", "done", "in_review"] as const) {
      const risks = computeNoCommitRisks({
        issues: [issue({ id: "i1", key: "WAL-1", status })],
        lastCommitAtByIssue: {},
        branches: [],
        now: NOW,
      });
      expect(risks, status).toEqual([]);
    }
  });
});

describe("abandoned branches", () => {
  const branch = (overrides: Partial<Parameters<typeof computeAbandonedBranchRisks>[0]["branches"][number]> = {}) => ({
    name: "feature/wallet",
    lastCommitAt: daysAgo(30),
    merged: false,
    linkedIssueKey: "WAL-1",
    ...overrides,
  });

  it("flags an old unmerged branch carrying open work", () => {
    const risks = computeAbandonedBranchRisks({
      issues: [issue({ id: "i1", key: "WAL-1", status: "todo" })],
      lastCommitAtByIssue: {},
      branches: [branch()],
      now: NOW,
    });

    expect(risks).toHaveLength(1);
    expect(risks[0]!.type).toBe("abandoned_branch");
    expect(risks[0]!.issueId).toBe("i1");
    expect(risks[0]!.evidence).toContain("Branch is not merged into the current HEAD");
  });

  // A merged branch is finished work. Age is irrelevant.
  it("never flags a merged branch, however old", () => {
    const risks = computeAbandonedBranchRisks({
      issues: [issue({ id: "i1", key: "WAL-1", status: "todo" })],
      lastCommitAtByIssue: {},
      branches: [branch({ merged: true, lastCommitAt: daysAgo(400) })],
      now: NOW,
    });

    expect(risks).toEqual([]);
  });

  it("leaves recent branches alone", () => {
    const risks = computeAbandonedBranchRisks({
      issues: [issue({ id: "i1", key: "WAL-1", status: "todo" })],
      lastCommitAtByIssue: {},
      branches: [branch({ lastCommitAt: daysAgo(2) })],
      now: NOW,
    });

    expect(risks).toEqual([]);
  });

  // Somebody's stale scratch branch is not a project risk.
  it("ignores a stale branch with no open issue behind it", () => {
    const noLink = computeAbandonedBranchRisks({
      issues: [issue({ id: "i1", key: "WAL-1", status: "todo" })],
      lastCommitAtByIssue: {},
      branches: [branch({ linkedIssueKey: null })],
      now: NOW,
    });
    const closedIssue = computeAbandonedBranchRisks({
      issues: [issue({ id: "i1", key: "WAL-1", status: "done" })],
      lastCommitAtByIssue: {},
      branches: [branch()],
      now: NOW,
    });

    expect(noLink).toEqual([]);
    expect(closedIssue).toEqual([]);
  });
});

describe("combining both git rules", () => {
  it("reports each independently", () => {
    const risks = computeGitRisks({
      issues: [issue({ id: "i1", key: "WAL-1" }), issue({ id: "i2", key: "WAL-2", status: "todo" })],
      lastCommitAtByIssue: {},
      branches: [{ name: "feature/two", lastCommitAt: daysAgo(40), merged: false, linkedIssueKey: "WAL-2" }],
      now: NOW,
    });

    expect(risks.map((r) => r.type).sort()).toEqual(["abandoned_branch", "no_commits"]);
  });
});
