import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import type { GitCommit, GitStatus } from "@ai-pm/shared";

const execFileAsync = promisify(execFile);

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";
const GIT_TIMEOUT_MS = 10_000;

export class GitError extends Error {
  constructor(message: string, public cause2?: unknown) {
    super(message);
    this.name = "GitError";
  }
}

/**
 * Runs `git` with argv-array arguments (never a shell string) so untrusted
 * input such as a repository path can never be interpreted as shell syntax.
 */
async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GitError(`git ${args.join(" ")} failed: ${message}`, err);
  }
}

export async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(repoPath)) return false;
    const out = await runGit(["rev-parse", "--is-inside-work-tree"], repoPath);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

export async function getRepoRoot(repoPath: string): Promise<string> {
  const out = await runGit(["rev-parse", "--show-toplevel"], repoPath);
  return out.trim();
}

export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const out = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
    const branch = out.trim();
    return branch === "HEAD" ? null : branch; // detached HEAD
  } catch {
    return null;
  }
}

interface StatusFiles {
  isClean: boolean;
  stagedFiles: string[];
  unstagedFiles: string[];
}

export async function getStatusFiles(repoPath: string): Promise<StatusFiles> {
  const out = await runGit(["status", "--porcelain=v1"], repoPath);
  const lines = out.split("\n").filter((l) => l.length > 0);
  const staged: string[] = [];
  const unstaged: string[] = [];

  for (const line of lines) {
    const indexStatus = line[0];
    const worktreeStatus = line[1];
    const file = line.slice(3);
    if (indexStatus && indexStatus !== " " && indexStatus !== "?") staged.push(file);
    if (worktreeStatus && (worktreeStatus !== " " || indexStatus === "?")) {
      // "??" (untracked) has worktreeStatus '?' too; treat as unstaged/new.
      if (worktreeStatus !== " ") unstaged.push(file);
    }
  }

  return { isClean: lines.length === 0, stagedFiles: staged, unstagedFiles: unstaged };
}

function parseLogOutput(raw: string): (GitCommit & { changedFilesRaw?: string })[] {
  return raw
    .split(RECORD_SEP)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, subject, author, timestamp] = record.split(FIELD_SEP);
      return {
        hash: hash ?? "",
        shortHash: shortHash ?? "",
        subject: subject ?? "",
        author: author ?? "",
        timestamp: timestamp ?? "",
      };
    });
}

export async function getRecentCommits(repoPath: string, limit = 10): Promise<GitCommit[]> {
  try {
    const format = `%H${FIELD_SEP}%h${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%aI${RECORD_SEP}`;
    const out = await runGit(["log", `-n`, String(limit), `--pretty=format:${format}`], repoPath);
    return parseLogOutput(out);
  } catch {
    return [];
  }
}

/**
 * Lists commits newer than `sinceHash` (exclusive), oldest-first, each with
 * its changed file list. If `sinceHash` is null, returns the most recent
 * `limit` commits from HEAD (used for the very first scan of a repository).
 */
export async function listCommitsSince(
  repoPath: string,
  sinceHash: string | null,
  limit = 30,
): Promise<(GitCommit & { changedFiles: string[] })[]> {
  const format = `%H${FIELD_SEP}%h${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%aI${RECORD_SEP}`;
  const range = sinceHash ? [`${sinceHash}..HEAD`] : [];
  const args = ["log", ...range, `-n`, String(limit), `--pretty=format:${format}`, "--reverse"];

  let out: string;
  try {
    out = await runGit(args, repoPath);
  } catch {
    // sinceHash may no longer exist (e.g. rebased/force-pushed history) --
    // fall back to the most recent commits from HEAD instead of failing the scan.
    out = await runGit(["log", `-n`, String(limit), `--pretty=format:${format}`, "--reverse"], repoPath);
  }

  const commits = parseLogOutput(out);
  const withFiles: (GitCommit & { changedFiles: string[] })[] = [];
  for (const commit of commits) {
    if (!commit.hash) continue;
    try {
      const filesOut = await runGit(["show", "--name-only", "--pretty=format:", commit.hash], repoPath);
      const changedFiles = filesOut.split("\n").map((f) => f.trim()).filter(Boolean);
      withFiles.push({ ...commit, changedFiles });
    } catch {
      withFiles.push({ ...commit, changedFiles: [] });
    }
  }
  return withFiles;
}

/**
 * Full deterministic status snapshot for a repository. Never throws --
 * repository problems (not a repo, path missing, git not installed) are
 * reported in the `error` field so callers can render a helpful message
 * instead of crashing.
 */
export async function getGitStatus(repoPath: string | null): Promise<GitStatus> {
  if (!repoPath) {
    return {
      connected: false,
      repositoryPath: null,
      error: "No repository connected to this project yet.",
      branch: null,
      isClean: null,
      stagedFiles: [],
      unstagedFiles: [],
      recentCommits: [],
      latestCommitAt: null,
    };
  }

  const isRepo = await isGitRepository(repoPath);
  if (!isRepo) {
    return {
      connected: false,
      repositoryPath: repoPath,
      error: `"${repoPath}" is not a Git repository (or git is not installed).`,
      branch: null,
      isClean: null,
      stagedFiles: [],
      unstagedFiles: [],
      recentCommits: [],
      latestCommitAt: null,
    };
  }

  try {
    const [branch, statusFiles, commits] = await Promise.all([
      getCurrentBranch(repoPath),
      getStatusFiles(repoPath),
      getRecentCommits(repoPath, 10),
    ]);

    return {
      connected: true,
      repositoryPath: repoPath,
      error: null,
      branch,
      isClean: statusFiles.isClean,
      stagedFiles: statusFiles.stagedFiles,
      unstagedFiles: statusFiles.unstagedFiles,
      recentCommits: commits,
      latestCommitAt: commits[0]?.timestamp ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      repositoryPath: repoPath,
      error: `Failed to read Git status: ${message}`,
      branch: null,
      isClean: null,
      stagedFiles: [],
      unstagedFiles: [],
      recentCommits: [],
      latestCommitAt: null,
    };
  }
}
