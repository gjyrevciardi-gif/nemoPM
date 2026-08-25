import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";

const execFileAsync = promisify(execFile);

/** Record and field separators that cannot occur in commit text. */
export const RECORD_SEP = "\x1e";
export const FIELD_SEP = "\x1f";

const GIT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 10 * 1024 * 1024;

export class GitContextError extends Error {
  constructor(message: string, readonly cause2?: unknown) {
    super(message);
    this.name = "GitContextError";
  }
}

/**
 * Runs `git` with argv-array arguments, never a shell string.
 *
 * Repository paths, branch names and issue keys all reach this from user data,
 * and a shell string would turn any of them into an injection point. The array
 * form has no shell to inject into. Everything here is read-only: this package
 * exists to observe a repository, never to change one.
 */
export async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new GitContextError(`git ${args[0] ?? ""} failed: ${message}`, err);
  }
}

export async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    if (!fs.existsSync(repoPath)) return false;
    return (await runGit(["rev-parse", "--is-inside-work-tree"], repoPath)).trim() === "true";
  } catch {
    return false;
  }
}
