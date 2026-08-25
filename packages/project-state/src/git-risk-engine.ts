import { DEFAULT_RISK_THRESHOLDS } from "@ai-pm/shared";
import type { ComputedRisk, Issue, RiskThresholds } from "@ai-pm/shared";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface GitRiskInput {
  issues: Issue[];
  /** issueId -> ISO timestamp of the most recent commit referencing that issue, if any. */
  lastCommitAtByIssue: Record<string, string | null>;
  branches: {
    name: string;
    lastCommitAt: string;
    merged: boolean;
    /** The open issue this branch appears to belong to, if any. */
    linkedIssueKey: string | null;
  }[];
  now: Date;
  thresholds?: RiskThresholds;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * NO COMMITS RULE
 *
 * An issue can sit in "in progress" indefinitely while its column is dragged
 * around and nothing is actually written. The board says the work is happening;
 * the repository is the only place that can disagree.
 *
 * Fires when an issue has been in progress longer than the threshold and no
 * commit references it. An issue that was *never* linked to any commit and only
 * just started is not yet evidence of anything, so the clock is the issue's own
 * start time.
 */
export function computeNoCommitRisks(input: GitRiskInput): ComputedRisk[] {
  const thresholds = input.thresholds ?? DEFAULT_RISK_THRESHOLDS;
  const risks: ComputedRisk[] = [];

  for (const issue of input.issues) {
    if (issue.status !== "in_progress") continue;

    const startedAt = issue.startedAt ?? issue.updatedAt;
    const daysInProgress = daysBetween(new Date(startedAt), input.now);
    if (daysInProgress <= thresholds.noCommitDays) continue;

    const lastCommitAt = input.lastCommitAtByIssue[issue.id] ?? null;
    if (lastCommitAt) {
      const daysSinceCommit = daysBetween(new Date(lastCommitAt), input.now);
      if (daysSinceCommit <= thresholds.noCommitDays) continue;

      risks.push({
        type: "no_commits",
        severity: daysSinceCommit > thresholds.noCommitDays * 2 ? "high" : "medium",
        issueId: issue.id,
        message: `${issue.key} is in progress but nothing has been committed against it for ${Math.floor(daysSinceCommit)} day(s).`,
        evidence: [
          `${issue.key} status: in_progress since ${startedAt}`,
          `Last commit referencing ${issue.key}: ${lastCommitAt}`,
        ],
        dedupeKey: `no_commits:${issue.id}`,
      });
      continue;
    }

    risks.push({
      type: "no_commits",
      severity: daysInProgress > thresholds.noCommitDays * 2 ? "high" : "medium",
      issueId: issue.id,
      message: `${issue.key} has been in progress for ${Math.floor(daysInProgress)} day(s) with no commit referencing it.`,
      evidence: [
        `${issue.key} status: in_progress since ${startedAt}`,
        `No commit message references ${issue.key}`,
      ],
      dedupeKey: `no_commits:${issue.id}`,
    });
  }

  return risks;
}

/**
 * ABANDONED BRANCH RULE
 *
 * Work that exists only on a branch nobody has touched in weeks, and that was
 * never merged, is work the board still believes is coming.
 *
 * Merged branches are ignored however old they are -- a merged branch is
 * finished work, not abandoned work.
 */
export function computeAbandonedBranchRisks(input: GitRiskInput): ComputedRisk[] {
  const thresholds = input.thresholds ?? DEFAULT_RISK_THRESHOLDS;
  const openIssueByKey = new Map(
    input.issues.filter((issue) => issue.status !== "done").map((issue) => [issue.key.toUpperCase(), issue]),
  );
  const risks: ComputedRisk[] = [];

  for (const branch of input.branches) {
    if (branch.merged) continue;

    const daysSince = daysBetween(new Date(branch.lastCommitAt), input.now);
    if (daysSince <= thresholds.abandonedBranchDays) continue;

    const issue = branch.linkedIssueKey ? openIssueByKey.get(branch.linkedIssueKey.toUpperCase()) : undefined;
    // A stale branch with no open issue behind it is somebody's scratch work.
    // Only branches that still carry promised work are worth raising.
    if (!issue) continue;

    risks.push({
      type: "abandoned_branch",
      severity: daysSince > thresholds.abandonedBranchDays * 2 ? "high" : "medium",
      issueId: issue.id,
      message: `Branch "${branch.name}" carries ${issue.key} but has had no commits for ${Math.floor(daysSince)} day(s) and is not merged.`,
      evidence: [
        `Branch: ${branch.name}`,
        `Last commit: ${branch.lastCommitAt} (${Math.floor(daysSince)} day(s) ago)`,
        `${issue.key} status: ${issue.status}`,
        "Branch is not merged into the current HEAD",
      ],
      dedupeKey: `abandoned_branch:${branch.name}`,
    });
  }

  return risks;
}

/** Both git-derived rules. Additive: the SQLite-only rules are computed separately. */
export function computeGitRisks(input: GitRiskInput): ComputedRisk[] {
  return [...computeNoCommitRisks(input), ...computeAbandonedBranchRisks(input)];
}
