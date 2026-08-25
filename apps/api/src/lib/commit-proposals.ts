import type Database from "better-sqlite3";
import { activitiesRepo, agentRunsRepo, codeLinksRepo, issuesRepo, repositoriesRepo } from "@ai-pm/database";
import type { AgentAction } from "@ai-pm/shared";
import type { AgentRun } from "@ai-pm/database";
import { collectGitSignals } from "./git-signals.js";
import { ensureRepositoryConnected } from "./git-scan.js";

export interface CommitProposalResult {
  /** Links written to the audit trail this pass (new commits only). */
  linked: number;
  /** The run awaiting approval, if any transition was worth proposing. */
  run: AgentRun | null;
  proposed: { issueKey: string; from: string; to: string; commitHash: string }[];
}

/** A commit against an issue means the work exists; review is the honest next column. */
const TARGET_STATUS = "in_review";

/** Only these statuses are worth advancing. Anything else, the commit is not news. */
const ADVANCEABLE = new Set(["in_progress", "todo"]);

/**
 * Turns commits that reference issue keys into an audit trail and, where it
 * means something, a proposed transition.
 *
 * Two separate obligations, deliberately not conditional on each other:
 *
 *   - The link is recorded whether or not anyone approves a transition. What
 *     the repository says happened is a fact, and the record of it should not
 *     depend on whether a user later agrees with NEMO's inference about it.
 *   - The transition is only ever proposed. Nobody asked for it -- a commit
 *     landed and NEMO drew a conclusion -- so it waits for approval through the
 *     ask tier, exactly like any other unrequested write.
 */
export async function proposeTransitionsFromCommits(
  db: Database.Database,
  projectId: string,
): Promise<CommitProposalResult> {
  // A project can have a repository path without a repositories row yet; this
  // is the same connect-on-first-use path the rest of the git code takes.
  let repo;
  try {
    repo = repositoriesRepo.getRepositoryByProject(db, projectId) ?? ensureRepositoryConnected(db, projectId);
  } catch {
    return { linked: 0, run: null, proposed: [] };
  }

  const signals = await collectGitSignals(db, projectId, repo.path);
  if (signals.links.length === 0) return { linked: 0, run: null, proposed: [] };

  const issuesByKey = new Map(issuesRepo.listIssuesByProject(db, projectId).map((i) => [i.key.toUpperCase(), i]));

  let linked = 0;
  const actions: AgentAction[] = [];
  const proposed: CommitProposalResult["proposed"] = [];
  const seenIssues = new Set<string>();

  for (const link of signals.links) {
    const issue = issuesByKey.get(link.issueKey);
    if (!issue) continue;

    // Asked before writing: createCodeLink is INSERT OR IGNORE and reads the
    // row back either way, so afterwards there is no telling a new commit from
    // one already seen -- and a proposal must not reappear on every scan.
    // Newness is per issue, because one commit can name two of them.
    const created = !codeLinksRepo.hasCodeLink(db, repo.id, link.commitHash, issue.id);
    // An amend or rebase gives the same change a new hash. Without this, a
    // rewritten commit is proposed all over again.
    const alreadySeenAsSubject = codeLinksRepo.hasCodeLinkWithSubject(
      db,
      repo.id,
      issue.id,
      link.subject,
      link.timestamp,
    );
    codeLinksRepo.createCodeLink(db, {
      projectId,
      issueId: issue.id,
      repositoryId: repo.id,
      commitHash: link.commitHash,
      branch: null,
      subject: link.subject,
      author: link.author,
      changedFiles: link.changedFiles,
      committedAt: link.timestamp,
    });
    if (created) linked++;

    // One proposal per issue: five commits against WAL-3 is still one move.
    if (!created || alreadySeenAsSubject || seenIssues.has(issue.id) || !ADVANCEABLE.has(issue.status)) continue;
    seenIssues.add(issue.id);

    actions.push({
      tool: "advanceIssueFromCommit",
      args: {
        issueKey: issue.key,
        status: TARGET_STATUS,
        commitHash: link.commitHash,
        commitSubject: link.subject,
      },
      description: `Move ${issue.key} to ${TARGET_STATUS} — commit ${link.shortHash} "${link.subject}" references it`,
      projectId,
    });
    proposed.push({ issueKey: issue.key, from: issue.status, to: TARGET_STATUS, commitHash: link.shortHash });
  }

  if (linked > 0) {
    activitiesRepo.recordActivity(db, {
      projectId,
      type: "git.scan",
      payload: { linkedCommits: linked, proposedTransitions: proposed.length },
    });
  }

  if (actions.length === 0) return { linked, run: null, proposed: [] };

  const run = agentRunsRepo.createRun(db, {
    projectId,
    scope: "project",
    requestText: "Commits referencing issue keys were detected in the repository.",
    actions,
    plan: null,
    model: null,
    provider: "git",
  });

  return { linked, run, proposed };
}
