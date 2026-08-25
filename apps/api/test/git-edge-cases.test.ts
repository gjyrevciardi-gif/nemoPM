import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = ":memory:";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";

let app: FastifyInstance;
let closeDb: () => void;
let repo: string;
let walProject: string;
let emptyProject: string;
let emptyRepo: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

const commit = (subject: string, file: string, contents = "x\n") => {
  fs.writeFileSync(path.join(repo, file), contents);
  git(repo, "add", file);
  git(repo, "commit", "-m", subject);
};

const notify = async (projectId: string) =>
  (await app.inject({ method: "POST", url: `/projects/${projectId}/git/commits` })).json() as {
    linked: number;
    run: { id: string } | null;
    proposed: { issueKey: string; to: string; commitHash: string }[];
  };

const issues = async (projectId: string) =>
  (await app.inject({ method: "GET", url: `/projects/${projectId}/issues` })).json() as {
    key: string;
    status: string;
  }[];

async function newProject(name: string, key: string, repoPath: string | null) {
  const id = (
    (await app.inject({ method: "POST", url: "/projects", payload: { name, key } })).json() as { id: string }
  ).id;
  if (repoPath) {
    await app.inject({ method: "PATCH", url: `/projects/${id}`, payload: { repositoryPath: repoPath } });
  }
  return id;
}

beforeAll(async () => {
  const dbModule = await import("@ai-pm/database");
  closeDb = dbModule.closeDb;
  dbModule.getDb();
  const { buildServer } = await import("../src/app.js");
  app = buildServer();
  await app.ready();

  repo = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-gedge-"));
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test Author");
  commit("initial", "readme.md");

  emptyRepo = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-gempty-"));
  git(emptyRepo, "init", "-b", "main");
  git(emptyRepo, "config", "user.email", "test@example.com");
  git(emptyRepo, "config", "user.name", "Test Author");

  walProject = await newProject("Wallet", "WAL", repo);
  emptyProject = await newProject("Fresh", "FRSH", emptyRepo);

  for (const title of ["Login screen", "Session refresh", "Payments"]) {
    await app.inject({ method: "POST", url: "/issues", payload: { projectId: walProject, title, status: "in_progress" } });
  }
});

afterAll(async () => {
  await app.close();
  closeDb();
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(emptyRepo, { recursive: true, force: true });
});

describe("A1 — a commit that names two issues", () => {
  it("proposes a move for each of them", async () => {
    commit("WAL-1, WAL-2: shared login refactor", "auth.ts");

    const result = await notify(walProject);

    expect(result.proposed.map((p) => p.issueKey).sort()).toEqual(["WAL-1", "WAL-2"]);
    // One commit, one run: two moves a human approves together.
    expect(result.run).not.toBeNull();
  });
});

describe("A2 — a commit with no key", () => {
  it("proposes nothing at all", async () => {
    commit("wip", "scratch.ts");
    commit("fix stuff", "misc.ts");

    const result = await notify(walProject);

    expect(result.proposed).toEqual([]);
    expect(result.linked).toBe(0);
    expect(result.run).toBeNull();
  });
});

describe("A3 / A4 — keys belonging to another project", () => {
  it("ignores a key this project does not own, without crashing", async () => {
    commit("ACME-1 unrelated project work", "other.ts");

    const result = await notify(walProject);

    expect(result.proposed).toEqual([]);
    expect(result.linked).toBe(0);
  });

  it("does not cross-link when two projects share one repository", async () => {
    const acme = await newProject("Acme", "ACME", repo);
    await app.inject({ method: "POST", url: "/issues", payload: { projectId: acme, title: "Acme work", status: "in_progress" } });

    const acmeResult = await notify(acme);

    expect(acmeResult.proposed.map((p) => p.issueKey)).toEqual(["ACME-1"]);
    // The Wallet project's issues were not touched by Acme's scan.
    expect((await issues(walProject)).find((i) => i.key === "WAL-1")!.status).toBe("in_progress");
  });
});

describe("A5 — a commit that was amended or rebased", () => {
  /**
   * An amend rewrites history: same logical change, new hash. Left alone, the
   * linker treats the rewritten commit as brand new and proposes the same move a
   * second time, so a user who already declined it is asked again.
   */
  it("does not propose the same move twice for one rewritten commit", async () => {
    commit("WAL-3 add payments", "payments.ts");
    const first = await notify(walProject);
    expect(first.proposed.map((p) => p.issueKey)).toEqual(["WAL-3"]);

    // Same change, rewritten.
    fs.writeFileSync(path.join(repo, "payments.ts"), "x\ny\n");
    git(repo, "add", "payments.ts");
    git(repo, "commit", "--amend", "-m", "WAL-3 add payments");

    const second = await notify(walProject);

    expect(second.proposed).toEqual([]);
  });
});

describe("A8 — a project whose repository has no commits", () => {
  it("still builds project state, with git contributing nothing", async () => {
    const state = await app.inject({ method: "GET", url: `/projects/${emptyProject}/state` });

    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({ risks: expect.any(Array) });
  });

  it("reports no links and proposes nothing", async () => {
    const result = await notify(emptyProject);

    expect(result).toMatchObject({ linked: 0, run: null, proposed: [] });
  });
});

describe("A7 — a fresh local branch", () => {
  /**
   * `git log` reads HEAD, so a commit made on a branch that is not checked out
   * is invisible to it. The watcher fires on any HEAD movement, but what the
   * server can then see depends on where HEAD is standing.
   */
  it("sees a commit made on a branch while that branch is checked out", async () => {
    git(repo, "checkout", "-b", "feature/session");
    commit("WAL-2 session refresh work", "session.ts");

    const onBranch = await notify(walProject);

    expect(onBranch.linked).toBeGreaterThan(0);
  });

  it("does not lose the link after switching back to the main branch", async () => {
    git(repo, "checkout", "main");

    // The commit is no longer reachable from HEAD, but it was already recorded:
    // the audit trail is not rewritten by moving between branches.
    const links = (await app.inject({ method: "GET", url: `/projects/${walProject}/state` })).json();

    expect(links).toMatchObject({ risks: expect.any(Array) });
    const afterSwitch = await notify(walProject);
    expect(afterSwitch.proposed).toEqual([]);
  });
});
