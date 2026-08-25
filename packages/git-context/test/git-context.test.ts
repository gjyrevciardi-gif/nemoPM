import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getBranchActivity, getCommitsSince, getCommitsTouchingPath } from "../src/commits.js";
import { extractIssueKeys, linkCommitsToIssues } from "../src/links.js";
import { isGitRepository } from "../src/run.js";

/**
 * Tested against a real repository rather than mocked output. Git's porcelain
 * is the thing being parsed, so a mock would only prove the parser agrees with
 * my assumptions about a format I did not design.
 */
let repo: string;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "" } });

const commit = (subject: string, file: string, contents: string) => {
  fs.writeFileSync(path.join(repo, file), contents);
  git("add", file);
  git("commit", "-m", subject);
};

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-git-"));
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test Author");

  commit("WAL-1 add login screen", "login.ts", "export const login = 1;\n");
  commit("Refactor helpers, no key here", "helpers.ts", "export const help = 1;\n");
  commit("Fix WAL-2 and WAL-3 together", "wallet.ts", "export const wallet = 1;\nexport const extra = 2;\n");

  git("checkout", "-b", "feature/abandoned");
  commit("WAL-9 start something", "abandoned.ts", "export const nope = 1;\n");
  git("checkout", "main");
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe("reading a repository", () => {
  it("recognises a repository, and a plain directory", async () => {
    expect(await isGitRepository(repo)).toBe(true);
    expect(await isGitRepository(path.join(os.tmpdir(), "definitely-not-a-repo-xyz"))).toBe(false);
  });

  // Reads every local branch, not only HEAD: work committed on a branch that is
  // never checked out again would otherwise be invisible, and the risk engine
  // would confidently report "no commits" for an issue somebody has been
  // writing code for. "WAL-9 start something" lives on feature/abandoned.
  it("returns commits from every local branch, newest first, with their changed files", async () => {
    const commits = await getCommitsSince(repo, null);

    expect(commits.map((c) => c.subject)).toEqual([
      "WAL-9 start something",
      "Fix WAL-2 and WAL-3 together",
      "Refactor helpers, no key here",
      "WAL-1 add login screen",
    ]);

    const wallet = commits.find((c) => c.subject === "Fix WAL-2 and WAL-3 together")!;
    expect(wallet.changedFiles).toEqual(["wallet.ts"]);
    expect(wallet.author).toBe("Test Author");
    expect(wallet.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("counts lines added per commit", async () => {
    const commits = await getCommitsSince(repo, null);
    const wallet = commits.find((c) => c.subject === "Fix WAL-2 and WAL-3 together")!;

    expect(wallet.insertions).toBe(2);
    expect(wallet.deletions).toBe(0);
  });

  it("honours a since date", async () => {
    const future = new Date(Date.now() + 60_000);

    expect(await getCommitsSince(repo, future)).toEqual([]);
  });

  it("finds the commits that touched one path", async () => {
    const commits = await getCommitsTouchingPath(repo, "login.ts");

    expect(commits.map((c) => c.subject)).toEqual(["WAL-1 add login screen"]);
  });

  it("reports branches with their last activity", async () => {
    const branches = await getBranchActivity(repo);
    const names = branches.map((b) => b.name);

    expect(names).toContain("main");
    expect(names).toContain("feature/abandoned");
    expect(branches.find((b) => b.name === "main")!.isCurrent).toBe(true);
    expect(branches.find((b) => b.name === "feature/abandoned")!.merged).toBe(false);
    expect(branches.find((b) => b.name === "feature/abandoned")!.lastCommitAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("finding issue keys in commit messages", () => {
  it("finds one key, and several", () => {
    expect(extractIssueKeys("WAL-1 add login screen")).toEqual(["WAL-1"]);
    expect(extractIssueKeys("Fix WAL-2 and WAL-3 together").sort()).toEqual(["WAL-2", "WAL-3"]);
  });

  it("is not fooled by the things that look like keys in real commits", () => {
    expect(extractIssueKeys("Switch to SHA-256 and UTF-8, per RFC-6455")).toEqual([]);
    expect(extractIssueKeys("Bump to 1.2-3 and fix ipv4")).toEqual([]);
  });

  it("links only to issues that exist", async () => {
    const commits = await getCommitsSince(repo, null);
    const links = linkCommitsToIssues(commits, new Set(["WAL-1", "WAL-2"]));

    expect(links.map((l) => l.issueKey).sort()).toEqual(["WAL-1", "WAL-2"]);
  });

  it("ignores a key that belongs to no issue, however plausible", async () => {
    const commits = await getCommitsSince(repo, null);

    expect(linkCommitsToIssues(commits, new Set(["OTHER-1"]))).toEqual([]);
  });

  it("carries the commit's files onto the link", async () => {
    const commits = await getCommitsSince(repo, null);
    const [link] = linkCommitsToIssues(commits, new Set(["WAL-1"]));

    expect(link!.changedFiles).toEqual(["login.ts"]);
    expect(link!.shortHash).toHaveLength(7);
  });
});
