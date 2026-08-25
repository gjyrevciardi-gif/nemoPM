import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getBranchActivity, getCommitsSince } from "../src/commits.js";
import { extractIssueKeys, linkCommitsToIssues } from "../src/links.js";

/**
 * Edge-case sweep for the git reader. Every case runs against a real repository:
 * the first version of this parser passed a mocked-output test and still
 * mis-attributed diff stats, because a mock only proves the parser agrees with
 * my own assumptions about a format I did not design.
 */
let repo: string;
let empty: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

const commit = (subject: string, file: string, contents: string) => {
  fs.writeFileSync(path.join(repo, file), contents);
  git(repo, "add", file);
  git(repo, "commit", "-m", subject);
};

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-edge-"));
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test Author");

  commit("WAL-1, WAL-2: shared login refactor", "auth.ts", "a\nb\nc\n");
  commit("wip", "scratch.ts", "x\n");
  commit("fix stuff", "misc.ts", "y\n");
  commit("ACME-1 belongs to another project", "other.ts", "z\n");

  // A repository that exists but has never been committed to.
  empty = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-empty-"));
  git(empty, "init", "-b", "main");
  git(empty, "config", "user.email", "test@example.com");
  git(empty, "config", "user.name", "Test Author");
});

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
});

describe("A1 — one commit naming several issues", () => {
  it("links every key it names, not just the first", async () => {
    const commits = await getCommitsSince(repo, null);
    const links = linkCommitsToIssues(commits, new Set(["WAL-1", "WAL-2"]));

    expect(links.map((l) => l.issueKey).sort()).toEqual(["WAL-1", "WAL-2"]);
    expect(new Set(links.map((l) => l.commitHash)).size).toBe(1);
  });
});

describe("A2 — commits with no issue key", () => {
  it("finds nothing in ordinary commit messages", () => {
    for (const subject of ["wip", "fix stuff", "Merge branch 'main'", "bump deps", "WIP-ish cleanup"]) {
      expect(extractIssueKeys(subject), subject).toEqual([]);
    }
  });

  it("does not find a key inside a longer token", () => {
    // XWAL-1 is a well-formed key for a project called XWAL, so extracting it
    // is right -- grounding against real issues is what rejects it later. What
    // must never happen is WAL-1 being read out of the middle of XWAL-1.
    expect(extractIssueKeys("XWAL-1 something")).not.toContain("WAL-1");
    expect(extractIssueKeys("release v2-1 and build 3-4")).toEqual([]);
    expect(extractIssueKeys("see WAL-12 for detail")).toEqual(["WAL-12"]);
  });
});

describe("A3 — a key that exists nowhere", () => {
  it("produces no link rather than a phantom one", async () => {
    const commits = await getCommitsSince(repo, null);

    expect(linkCommitsToIssues(commits, new Set(["WAL-1"])).every((l) => l.issueKey === "WAL-1")).toBe(true);
    expect(linkCommitsToIssues(commits, new Set()).length).toBe(0);
  });

  it("survives an empty known-key set without throwing", async () => {
    const commits = await getCommitsSince(repo, null);

    expect(() => linkCommitsToIssues(commits, new Set())).not.toThrow();
  });
});

describe("A4 — a monorepo holding more than one project", () => {
  it("links only the keys the caller vouches for", async () => {
    const commits = await getCommitsSince(repo, null);

    // The WAL project asks: ACME-1 is in the history but is not its business.
    expect(linkCommitsToIssues(commits, new Set(["WAL-1", "WAL-2"])).map((l) => l.issueKey).sort()).toEqual([
      "WAL-1",
      "WAL-2",
    ]);
    // The ACME project asks: it sees only its own.
    expect(linkCommitsToIssues(commits, new Set(["ACME-1"])).map((l) => l.issueKey)).toEqual(["ACME-1"]);
  });
});

describe("A6 — the header/stats/header/stats parse", () => {
  /**
   * Regression lock. The first implementation split on the record separator,
   * which hands each chunk the *previous* commit's numstat lines together with
   * the *next* commit's header -- so every commit was reported with its
   * neighbour's diff. Real output, real assertions, permanently.
   */
  it("gives every commit its own files and line counts", async () => {
    const commits = await getCommitsSince(repo, null);
    const bySubject = new Map(commits.map((c) => [c.subject, c]));

    expect(bySubject.get("WAL-1, WAL-2: shared login refactor")!.changedFiles).toEqual(["auth.ts"]);
    expect(bySubject.get("WAL-1, WAL-2: shared login refactor")!.insertions).toBe(3);

    expect(bySubject.get("wip")!.changedFiles).toEqual(["scratch.ts"]);
    expect(bySubject.get("wip")!.insertions).toBe(1);

    expect(bySubject.get("ACME-1 belongs to another project")!.changedFiles).toEqual(["other.ts"]);
    expect(bySubject.get("ACME-1 belongs to another project")!.insertions).toBe(1);
  });

  it("never attributes one commit's files to another", async () => {
    const commits = await getCommitsSince(repo, null);
    const allFiles = commits.flatMap((c) => c.changedFiles);

    // Four commits, four distinct files, one each.
    expect(allFiles).toHaveLength(4);
    expect(new Set(allFiles).size).toBe(4);
    expect(commits.every((c) => c.changedFiles.length === 1)).toBe(true);
  });
});

describe("A8 — a repository with no history at all", () => {
  it("reports no commits instead of failing", async () => {
    await expect(getCommitsSince(empty, null)).resolves.toEqual([]);
  });

  it("reports no branches instead of failing", async () => {
    await expect(getBranchActivity(empty)).resolves.toEqual([]);
  });
});

describe("A7b — work committed on a branch that is not checked out", () => {
  /**
   * The dangerous shape of this gap is not the missing link, it is the false
   * risk: an issue with a week of commits on a feature branch would be reported
   * as "in progress with no commits" if only HEAD were read.
   */
  it("still sees the commit after the branch is left", async () => {
    const branch = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-branch-"));
    fs.rmSync(branch, { recursive: true, force: true });

    git(repo, "checkout", "-b", "feature/offstage");
    commit("WAL-7 work done off the main branch", "offstage.ts", "q\n");
    git(repo, "checkout", "main");

    const commits = await getCommitsSince(repo, null);

    expect(commits.map((c) => c.subject)).toContain("WAL-7 work done off the main branch");
  });
});
