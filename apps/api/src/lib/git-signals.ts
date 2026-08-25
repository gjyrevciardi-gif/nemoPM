import type Database from "better-sqlite3";
import { issuesRepo } from "@ai-pm/database";
import { getBranchActivity, getCommitsSince, linkCommitsToIssues } from "@ai-pm/git-context";
import type { CommitIssueLink } from "@ai-pm/git-context";
import type { GitRiskInput } from "@ai-pm/project-state";

/** How far back to read history when deriving risk signals. */
const LOOKBACK_DAYS = 120;
const MAX_COMMITS = 300;

export interface GitSignals {
  lastCommitAtByIssue: Record<string, string | null>;
  branches: GitRiskInput["branches"];
  links: CommitIssueLink[];
}

const EMPTY: GitSignals = { lastCommitAtByIssue: {}, branches: [], links: [] };

/**
 * Reads a repository and reduces it to the two facts the risk engine needs:
 * when each issue was last committed against, and which branches still carry
 * unfinished work.
 *
 * Never throws. A project whose repository has moved, or was never connected,
 * must still produce a project state -- git is an extra source of truth here,
 * not a prerequisite for the board working at all.
 */
export async function collectGitSignals(
  db: Database.Database,
  projectId: string,
  repoPath: string | null,
): Promise<GitSignals> {
  if (!repoPath) return EMPTY;

  try {
    const issues = issuesRepo.listIssuesByProject(db, projectId);
    const idByKey = new Map(issues.map((issue) => [issue.key.toUpperCase(), issue.id]));
    const knownKeys = new Set(idByKey.keys());

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const commits = await getCommitsSince(repoPath, since, MAX_COMMITS);
    const links = linkCommitsToIssues(commits, knownKeys);

    // Commits arrive newest first, so the first link for an issue is its latest.
    const lastCommitAtByIssue: Record<string, string | null> = {};
    for (const link of links) {
      const issueId = idByKey.get(link.issueKey);
      if (!issueId || lastCommitAtByIssue[issueId]) continue;
      lastCommitAtByIssue[issueId] = link.timestamp;
    }

    const branches = (await getBranchActivity(repoPath)).map((branch) => ({
      name: branch.name,
      lastCommitAt: branch.lastCommitAt,
      merged: branch.merged,
      // A branch belongs to an issue when its name carries that issue's key --
      // "feature/WAL-3-login" is the convention this recognises.
      linkedIssueKey: [...knownKeys].find((key) => branch.name.toUpperCase().includes(key)) ?? null,
    }));

    return { lastCommitAtByIssue, branches, links };
  } catch {
    return EMPTY;
  }
}
