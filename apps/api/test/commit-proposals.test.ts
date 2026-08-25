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
let projectId: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

const commit = (subject: string, file: string) => {
  fs.writeFileSync(path.join(repo, file), `// ${subject}\n`);
  git("add", file);
  git("commit", "-m", subject);
};

const issues = async () =>
  (await app.inject({ method: "GET", url: `/projects/${projectId}/issues` })).json() as {
    key: string;
    status: string;
  }[];

const notifyCommits = async () =>
  (await app.inject({ method: "POST", url: `/projects/${projectId}/git/commits` })).json();

beforeAll(async () => {
  const dbModule = await import("@ai-pm/database");
  closeDb = dbModule.closeDb;
  dbModule.getDb();

  const { buildServer } = await import("../src/app.js");
  app = buildServer();
  await app.ready();

  repo = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-proposals-"));
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test Author");
  commit("initial", "readme.md");

  projectId = (
    (await app.inject({ method: "POST", url: "/projects", payload: { name: "Wallet", key: "WAL" } })).json() as {
      id: string;
    }
  ).id;
  await app.inject({ method: "PATCH", url: `/projects/${projectId}`, payload: { repositoryPath: repo } });
  await app.inject({
    method: "POST",
    url: "/issues",
    payload: { projectId, title: "Login screen", status: "in_progress" },
  });
});

afterAll(async () => {
  await app.close();
  closeDb();
  fs.rmSync(repo, { recursive: true, force: true });
});

/**
 * The whole point of the feature: a developer commits, touches no PM UI, and
 * the board catches up on its own -- but only as far as a proposal, because
 * nobody asked NEMO to move anything.
 */
describe("commits referencing an issue key", () => {
  it("proposes a transition without applying it", async () => {
    commit("WAL-1 build the login screen", "login.ts");

    const result = (await notifyCommits()) as {
      linked: number;
      run: { id: string; status: string } | null;
      proposed: { issueKey: string; to: string }[];
    };

    expect(result.linked).toBeGreaterThan(0);
    expect(result.proposed).toEqual([expect.objectContaining({ issueKey: "WAL-1", to: "in_review" })]);
    expect(result.run?.status).toBe("proposed");

    // Proposed, not done: the issue has not moved.
    expect((await issues()).find((i) => i.key === "WAL-1")!.status).toBe("in_progress");
  });

  it("moves the issue once a human approves the run", async () => {
    const runs = (await app.inject({ method: "GET", url: `/projects/${projectId}/agent/runs` })).json() as {
      id: string;
      status: string;
    }[];
    const pending = runs.find((run) => run.status === "proposed")!;

    const applied = await app.inject({ method: "POST", url: `/projects/${projectId}/agent/${pending.id}/apply` });

    expect(applied.statusCode).toBe(200);
    expect((await issues()).find((i) => i.key === "WAL-1")!.status).toBe("in_review");
  });

  it("does not propose the same move again on a re-scan", async () => {
    const result = (await notifyCommits()) as { linked: number; proposed: unknown[] };

    expect(result.linked).toBe(0);
    expect(result.proposed).toEqual([]);
  });

  // The link is a fact about the repository. Whether anyone agreed with NEMO's
  // inference about it is a separate question.
  it("records the link even when no transition is warranted", async () => {
    commit("WAL-1 follow-up tweak", "login.ts");

    const result = (await notifyCommits()) as { linked: number; proposed: unknown[] };

    expect(result.linked).toBe(1);
    expect(result.proposed).toEqual([]);
  });

  it("ignores commits referencing keys that do not exist", async () => {
    commit("WAL-999 fix the imaginary thing", "ghost.ts");

    const result = (await notifyCommits()) as { linked: number; proposed: unknown[] };

    expect(result.linked).toBe(0);
    expect(result.proposed).toEqual([]);
  });
});
