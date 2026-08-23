import type Database from "better-sqlite3";
import {
  activitiesRepo,
  codeLinksRepo,
  issuesRepo,
  repositoriesRepo,
  projectsRepo,
} from "@ai-pm/database";
import type { GitStatus } from "@ai-pm/shared";
import { ApiError } from "./errors.js";
import { getCurrentBranch, getGitStatus, listCommitsSince } from "./git.js";
import { ingestAndReconcile } from "./intelligence.js";

export interface ScanResult {
  status: GitStatus;
  newCommitsDetected: number;
  branchChanged: boolean;
}

/**
 * Ensures a repository row exists for the project, auto-registering the
 * project's `repositoryPath` the first time a scan (or status check) runs
 * if one hasn't been explicitly connected yet.
 */
export function ensureRepositoryConnected(db: Database.Database, projectId: string) {
  const existing = repositoriesRepo.getRepositoryByProject(db, projectId);
  if (existing) return existing;

  const project = projectsRepo.getProject(db, projectId);
  if (!project) throw new ApiError(404, "NOT_FOUND", `Project not found: ${projectId}`);
  if (!project.repositoryPath) {
    throw new ApiError(
      400,
      "NO_REPOSITORY",
      "No repository connected to this project. Connect one first (POST /projects/:id with repositoryPath, or the VS Code 'Connect Project' command).",
    );
  }
  return repositoriesRepo.connectRepository(db, projectId, project.repositoryPath);
}

/**
 * Scans the connected repository for commits since the last scan, links
 * them as evidence to the currently active issue (if one exists), and
 * records activity events -- but never changes issue status. Git activity
 * is evidence, not project truth: only an explicit "complete" action can
 * move an issue to Done.
 */
export async function scanGitActivity(db: Database.Database, projectId: string): Promise<ScanResult> {
  const intelligence = await ingestAndReconcile(db, projectId);
  const status = await getGitStatus(intelligence.snapshot.repositoryPath);
  return { status, newCommitsDetected: intelligence.digest.events, branchChanged: false };
  /* Legacy scanner retained below for migration reference; unreachable. The
     intelligence pipeline only links explicit issue keys and is idempotent. */
  /*
  const repo = ensureRepositoryConnected(db, projectId);
  const repoRow = repositoriesRepo.getRepositoryRow(db, repo.id);
  if (!repoRow) throw new ApiError(404, "NOT_FOUND", "Repository record missing.");

  const status = await getGitStatus(repo.path);
  if (!status.connected) {
    // Still record that a scan was attempted so it's visible in activity/troubleshooting.
    activitiesRepo.recordActivity(db, {
      projectId,
      type: "git.scan",
      payload: { ok: false, error: status.error },
    });
    return { status, newCommitsDetected: 0, branchChanged: false };
  }

  const currentBranch = await getCurrentBranch(repo.path);
  const branchChanged = currentBranch !== repoRow.last_branch;

  const newCommits = await listCommitsSince(repo.path, repoRow.last_scanned_commit_hash, 30);

  // Associate newly detected commits with whichever issue is currently
  // in_progress, if any -- this is the "ACME-2 active + 3 new commits ->
  // activity linked to ACME-2" behavior from the product spec.
  const projectIssues = issuesRepo.listIssuesByProject(db, projectId);
  const activeIssue = projectIssues
    .filter((i) => i.status === "in_progress")
    .sort((a, b) => new Date(b.startedAt ?? b.updatedAt).getTime() - new Date(a.startedAt ?? a.updatedAt).getTime())[0];

  for (const commit of newCommits) {
    codeLinksRepo.createCodeLink(db, {
      projectId,
      issueId: activeIssue?.id ?? null,
      repositoryId: repo.id,
      commitHash: commit.hash,
      branch: currentBranch,
      subject: commit.subject,
      author: commit.author,
      changedFiles: commit.changedFiles,
      committedAt: commit.timestamp,
    });

    activitiesRepo.recordActivity(db, {
      projectId,
      issueId: activeIssue?.id ?? null,
      type: "git.commit_detected",
      payload: {
        hash: commit.shortHash,
        subject: commit.subject,
        author: commit.author,
        filesChanged: commit.changedFiles.length,
      },
    });

    if (commit.changedFiles.length > 0) {
      activitiesRepo.recordActivity(db, {
        projectId,
        issueId: activeIssue?.id ?? null,
        type: "git.files_changed",
        payload: { hash: commit.shortHash, files: commit.changedFiles.slice(0, 50) },
      });
    }
  }

  if (branchChanged) {
    activitiesRepo.recordActivity(db, {
      projectId,
      issueId: activeIssue?.id ?? null,
      type: "git.branch_detected",
      payload: { branch: currentBranch, previousBranch: repoRow.last_branch },
    });
  }

  activitiesRepo.recordActivity(db, {
    projectId,
    issueId: activeIssue?.id ?? null,
    type: "git.scan",
    payload: {
      ok: true,
      newCommits: newCommits.length,
      branch: currentBranch,
      linkedIssue: activeIssue?.key ?? null,
    },
  });

  const latestHash = newCommits.length > 0 ? newCommits[newCommits.length - 1]!.hash : repoRow.last_scanned_commit_hash;
  repositoriesRepo.updateRepositoryScanState(db, repo.id, {
    commitHash: latestHash,
    branch: currentBranch,
  });

  const freshStatus = await getGitStatus(repo.path);
  return { status: freshStatus, newCommitsDetected: newCommits.length, branchChanged };
  */
}
