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

describe("A5b — two different commits that happen to share a subject", () => {
  /**
   * The other half of A5. Deduplicating on subject alone was too blunt: a second,
   * genuinely separate commit reusing a message would be swallowed and never
   * proposed. The author date separates them, because git preserves it through
   * amend and rebase -- a rewritten commit keeps its identity, a new one does not
   * inherit somebody else's.
   */
  it("proposes for the second one instead of swallowing it", async () => {
    const project = await newProject("Ledger", "LED", repo);
    for (const title of ["First task", "Second task"]) {
      await app.inject({
        method: "POST",
        url: "/issues",
        payload: { projectId: project, title, status: "in_progress" },
      });
    }

    // Same subject, same issue, deliberately different author dates.
    fs.writeFileSync(path.join(repo, "dup-one.ts"), "first\n");
    git(repo, "add", "dup-one.ts");
    git(repo, "-c", "user.name=Test Author", "commit", "--date=2026-01-01T10:00:00", "-m", "LED-1 recurring cleanup");

    const first = await notify(project);
    expect(first.proposed.map((p) => p.issueKey)).toEqual(["LED-1"]);

    // Approve nothing; just record a second, different commit with the same message.
    fs.writeFileSync(path.join(repo, "dup-two.ts"), "second\n");
    git(repo, "add", "dup-two.ts");
    git(repo, "-c", "user.name=Test Author", "commit", "--date=2026-02-02T10:00:00", "-m", "LED-1 recurring cleanup");

    const second = await notify(project);

    // A real second commit, so a real second link -- not swallowed as a rewrite.
    expect(second.linked).toBe(1);
  });
});

describe("A7b — the risk engine's view of a branch that is not checked out", () => {
  /**
   * The end of the chain #1 broke. `git log` reads HEAD, so a week of work on a
   * branch nobody has checked out again used to be invisible -- and the failure
   * was not a missing signal but a false one: "in progress, nothing committed"
   * about an issue somebody had been writing code for all week.
   *
   * Asserted through the real state endpoint against a real repository, with a
   * second issue as the control: if the rule had simply gone quiet, that issue
   * would stop being flagged too, and the test would prove nothing.
   */
  it("does not claim an issue has no commits when the commits are on an unmerged branch", async () => {
    const branchRepo = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-branchy-"));
    git(branchRepo, "init", "-b", "main");
    git(branchRepo, "config", "user.email", "test@example.com");
    git(branchRepo, "config", "user.name", "Test Author");
    fs.writeFileSync(path.join(branchRepo, "readme.md"), "start\n");
    git(branchRepo, "add", "readme.md");
    git(branchRepo, "commit", "-m", "initial");

    const project = await newProject("Branchy", "BR", branchRepo);
    for (const title of ["Worked on a branch", "Genuinely untouched"]) {
      await app.inject({ method: "POST", url: "/issues", payload: { projectId: project, title, status: "in_progress" } });
    }

    // Both issues have been in progress well past the no-commit threshold.
    const { getDb } = await import("@ai-pm/database");
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    getDb()
      .prepare("UPDATE issues SET started_at = ?, updated_at = ? WHERE project_id = ?")
      .run(tenDaysAgo, tenDaysAgo, project);

    // Real work, committed on a branch, and then left there.
    git(branchRepo, "checkout", "-b", "feature/session-work");
    fs.writeFileSync(path.join(branchRepo, "session.ts"), "export const session = 1;\n");
    git(branchRepo, "add", "session.ts");
    git(branchRepo, "commit", "-m", "BR-1 build the session layer");
    git(branchRepo, "checkout", "main");

    // The commit really is unreachable from HEAD -- otherwise this proves nothing.
    expect(git(branchRepo, "log", "--oneline")).not.toContain("BR-1");

    const rows = (await app.inject({ method: "GET", url: `/projects/${project}/issues` })).json() as {
      id: string;
      key: string;
    }[];
    const idOf = (key: string) => rows.find((i) => i.key === key)!.id;

    const state = (await app.inject({ method: "GET", url: `/projects/${project}/state` })).json() as {
      risks: { type: string; issueId: string | null; message: string }[];
    };
    const noCommitRisks = state.risks.filter((r) => r.type === "no_commits");

    expect(noCommitRisks.map((r) => r.issueId)).not.toContain(idOf("BR-1"));
    // The control: the rule is live, it simply has nothing to say about BR-1.
    expect(noCommitRisks.map((r) => r.issueId)).toContain(idOf("BR-2"));

    fs.rmSync(branchRepo, { recursive: true, force: true });
  });
});

describe("A5c — the residual collision: same subject AND same author date", () => {
  /**
   * Documented, not fixed -- and narrower than it first looks. Change identity
   * is (issue, subject, author date), so two commits sharing both are
   * indistinguishable under it.
   *
   * What that costs is only the second *proposal*, across separate scans. The
   * link itself is always recorded, because recording what the repository says
   * is not conditional on NEMO's inference about it. So the audit trail stays
   * complete and the collision can only ever cost a suggestion -- which is the
   * same direction A5 deliberately errs in.
   *
   * This asserts the known behaviour rather than the desired one, so the limit
   * has a reproduction instead of a sentence in a document, and so anyone who
   * later folds the hash into the identity sees exactly what they changed.
   */
  it("records both commits but proposes only once", async () => {
    const project = await newProject("Collide", "COL", repo);
    const issueId = (
      (
        await app.inject({
          method: "POST",
          url: "/issues",
          payload: { projectId: project, title: "Colliding work", status: "in_progress" },
        })
      ).json() as { id: string }
    ).id;

    // Same issue, same subject, same author date -- different content, so
    // genuinely different commits with different hashes.
    const sameDate = "2026-03-03T09:00:00";
    fs.writeFileSync(path.join(repo, "collide-one.ts"), "// one");
    git(repo, "add", "collide-one.ts");
    git(repo, "commit", `--date=${sameDate}`, "-m", "COL-1 nightly cleanup");

    const first = await notify(project);
    expect(first.proposed.map((p) => p.issueKey)).toEqual(["COL-1"]);

    // Nobody approves it. Then a second, separate commit arrives.
    fs.writeFileSync(path.join(repo, "collide-two.ts"), "// two");
    git(repo, "add", "collide-two.ts");
    git(repo, "commit", `--date=${sameDate}`, "-m", "COL-1 nightly cleanup");

    const second = await notify(project);

    // The link is kept -- the audit trail is never the thing that is lost.
    expect(second.linked).toBe(1);
    const { getDb, codeLinksRepo } = await import("@ai-pm/database");
    const hashes = new Set(codeLinksRepo.listCodeLinksForIssue(getDb(), issueId).map((l) => l.commitHash));
    expect(hashes.size).toBe(2);

    // This is the cost, and all of it: the repeat suggestion is suppressed,
    // exactly as it would be for a rebase of the first commit.
    expect(second.proposed).toEqual([]);
  });
});
