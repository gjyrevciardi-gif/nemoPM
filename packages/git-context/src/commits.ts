import { FIELD_SEP, RECORD_SEP, runGit } from "./run.js";

export interface CommitRecord {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  /** ISO 8601, author date. */
  timestamp: string;
  changedFiles: string[];
  insertions: number;
  deletions: number;
}

export interface BranchActivity {
  name: string;
  /** ISO 8601 of the branch tip's commit. */
  lastCommitAt: string;
  lastCommitSubject: string;
  isCurrent: boolean;
  merged: boolean;
}

const LOG_FORMAT = ["%H", "%h", "%s", "%an", "%aI"].join(FIELD_SEP) + RECORD_SEP;

const MAX_COMMITS = 500;

/**
 * Parses interleaved `--pretty` headers and `--numstat` lines.
 *
 * Read line by line rather than by splitting on the record separator. Splitting
 * looks natural and is wrong: git emits "header, stats, header, stats", so each
 * separated chunk holds the previous commit's stats *and* the next commit's
 * header, which silently attributes one commit's diff to another. A header is
 * the only line carrying field separators, so scanning is both simpler and
 * correct.
 */
function parseLogWithStats(out: string): CommitRecord[] {
  const commits: CommitRecord[] = [];
  let current: CommitRecord | null = null;

  for (const rawLine of out.split("\n")) {
    const line = rawLine.replaceAll(RECORD_SEP, "").trim();
    if (!line) continue;

    if (line.includes(FIELD_SEP)) {
      const [hash = "", shortHash = "", subject = "", author = "", timestamp = ""] = line.split(FIELD_SEP);
      if (!hash) continue;
      current = { hash, shortHash, subject, author, timestamp, changedFiles: [], insertions: 0, deletions: 0 };
      commits.push(current);
      continue;
    }

    if (!current) continue;
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [added = "", removed = "", file = ""] = parts;
    if (!file) continue;
    current.changedFiles.push(file);
    // Binary files report "-": they changed, but contribute no line counts.
    if (added !== "-") current.insertions += Number(added) || 0;
    if (removed !== "-") current.deletions += Number(removed) || 0;
  }

  return commits;
}

/**
 * A repository with no commits yet is not an error, it is a new repository.
 * `git log` disagrees and exits non-zero, so the empty case is translated into
 * an empty history -- git signals are additive to what the board already knows,
 * and must never be able to fail a project that simply has not been committed to.
 * Any other git failure still propagates: silence about a real problem would be
 * worse than the crash.
 */
async function logOrEmpty(args: string[], repoPath: string): Promise<string> {
  try {
    return await runGit(args, repoPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const noCommitsYet =
      /does not have any commits yet|unknown revision|bad revision|ambiguous argument 'HEAD'/i.test(message);
    if (noCommitsYet) return "";
    throw err;
  }
}
/**
 * Commits authored since a point in time, newest first.
 *
 * One `git log` carries the diff stats too. Asking git per commit was the
 * obvious shape and the wrong one: on a repository with real history it turns
 * a single process into hundreds.
 */
export async function getCommitsSince(repoPath: string, since: Date | null, limit = 100): Promise<CommitRecord[]> {
  const out = await logOrEmpty(
    [
      "log",
      // Every local branch, not just HEAD. `git log` alone reads the checked-out
      // branch, so work committed on a feature branch that is never checked out
      // again is invisible -- and invisible in the worst way: the risk engine
      // then reports "in progress with no commits" for an issue somebody has
      // been writing code for all week. A missing signal is survivable; a
      // confidently wrong one is not.
      "--branches",
      "-n",
      String(Math.min(limit, MAX_COMMITS)),
      `--pretty=format:${LOG_FORMAT}`,
      "--numstat",
      ...(since ? [`--since=${since.toISOString()}`] : []),
    ],
    repoPath,
  );
  return parseLogWithStats(out);
}

/** Commits that touched a given path, newest first. */
export async function getCommitsTouchingPath(repoPath: string, path: string, limit = 50): Promise<CommitRecord[]> {
  const out = await logOrEmpty(
    ["log", "-n", String(Math.min(limit, MAX_COMMITS)), `--pretty=format:${LOG_FORMAT}`, "--numstat", "--", path],
    repoPath,
  );
  return parseLogWithStats(out);
}

/**
 * Every local branch with the time of its last commit, and whether it has been
 * merged into the current HEAD. Sorted most recently active first.
 */
export async function getBranchActivity(repoPath: string): Promise<BranchActivity[]> {
  const out = await runGit(
    [
      "for-each-ref",
      "--sort=-committerdate",
      `--format=%(refname:short)${FIELD_SEP}%(committerdate:iso-strict)${FIELD_SEP}%(HEAD)${FIELD_SEP}%(contents:subject)`,
      "refs/heads",
    ],
    repoPath,
  );

  let mergedNames = new Set<string>();
  try {
    const mergedOut = await runGit(["branch", "--merged", "--format=%(refname:short)"], repoPath);
    mergedNames = new Set(mergedOut.split("\n").map((line) => line.trim()).filter(Boolean));
  } catch {
    // A repository with no commits has no merged branches to report.
  }

  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", lastCommitAt = "", head = "", lastCommitSubject = ""] = line.split(FIELD_SEP);
      return {
        name,
        lastCommitAt,
        lastCommitSubject,
        isCurrent: head.trim() === "*",
        merged: mergedNames.has(name),
      };
    })
    .filter((branch) => branch.name.length > 0);
}
