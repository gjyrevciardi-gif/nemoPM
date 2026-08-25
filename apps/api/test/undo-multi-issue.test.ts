import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ScriptedProvider, call } from "./scripted-provider.js";

process.env.DATABASE_PATH = ":memory:";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";

let app: FastifyInstance;
let closeDb: () => void;
let provider: ScriptedProvider;
let project: string;
let repo: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

const commit = (subject: string, file: string) => {
  fs.writeFileSync(path.join(repo, file), `// ${subject}\n`);
  git("add", file);
  git("commit", "-m", subject);
};

const issues = async () =>
  (await app.inject({ method: "GET", url: `/projects/${project}/issues` })).json() as {
    id: string;
    key: string;
    title: string;
    status: string;
  }[];

const byKey = async (key: string) => (await issues()).find((i) => i.key === key);

const undo = (runId?: string) =>
  app.inject({ method: "POST", url: `/projects/${project}/agent/undo`, payload: runId ? { runId } : {} });

beforeAll(async () => {
  const dbModule = await import("@ai-pm/database");
  closeDb = dbModule.closeDb;
  dbModule.getDb();
  const { buildServer } = await import("../src/app.js");
  app = buildServer();
  await app.ready();

  const { setAIProvider } = await import("../src/lib/ai.js");
  provider = new ScriptedProvider();
  setAIProvider(provider);

  repo = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-undo-multi-"));
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test Author");
  commit("initial", "readme.md");

  project = (
    (await app.inject({ method: "POST", url: "/projects", payload: { name: "Wallet", key: "WAL" } })).json() as {
      id: string;
    }
  ).id;
  await app.inject({ method: "PATCH", url: `/projects/${project}`, payload: { repositoryPath: repo } });

  for (const title of ["Login screen", "Session refresh", "Parent feature"]) {
    await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project, title, status: "in_progress" },
    });
  }
});

afterAll(async () => {
  const { setAIProvider } = await import("../src/lib/ai.js");
  setAIProvider(null);
  await app.close();
  closeDb();
  fs.rmSync(repo, { recursive: true, force: true });
});

beforeEach(() => provider.reset());

/**
 * A1 fixed the recording side: a commit naming two issues links to both. This
 * asks the matching question about the reversal side -- whether undo puts both
 * back, refuses explicitly, or silently reverts one and leaves the other, which
 * would be the original A1 bug reappearing at the other end of the pipeline.
 */
describe("undoing a run that came from a multi-issue commit", () => {
  it("reverses every issue the commit moved, not just the first", async () => {
    commit("WAL-1, WAL-2: shared login refactor", "auth.ts");

    const proposal = (await app.inject({ method: "POST", url: `/projects/${project}/git/commits` })).json() as {
      run: { id: string } | null;
      proposed: { issueKey: string }[];
    };
    expect(proposal.proposed.map((p) => p.issueKey).sort()).toEqual(["WAL-1", "WAL-2"]);

    const applied = await app.inject({
      method: "POST",
      url: `/projects/${project}/agent/${proposal.run!.id}/apply`,
    });
    expect(applied.statusCode).toBe(200);
    expect((await byKey("WAL-1"))!.status).toBe("in_review");
    expect((await byKey("WAL-2"))!.status).toBe("in_review");

    const reverted = await undo(proposal.run!.id);

    expect(reverted.statusCode).toBe(200);
    expect((await byKey("WAL-1"))!.status).toBe("in_progress");
    expect((await byKey("WAL-2"))!.status).toBe("in_progress");
  });
});

/**
 * The genuinely unreversible shape: one action that touches several rows.
 * createSubtasks creates N issues in a single call, so there is no single row to
 * restore -- the question is whether that is refused or half-done.
 */
describe("undoing a run whose single action touched many rows", () => {
  it("refuses explicitly rather than reversing part of it", async () => {
    const parent = (await issues()).find((i) => i.title === "Parent feature")!;

    provider.queue({
      calls: [
        call("createSubtasks", {
          parentKey: parent.key,
          subtasks: [{ title: "Sub one" }, { title: "Sub two" }],
        }),
      ],
      reply: "Broken down.",
    });
    const turn = (await app.inject({
      method: "POST",
      url: `/projects/${project}/agent`,
      payload: { message: "Break the parent feature into subtasks" },
    })).json() as { runId: string | null };

    expect(turn.runId).not.toBeNull();
    expect(
      (await app.inject({ method: "POST", url: `/projects/${project}/agent/${turn.runId}/apply` })).statusCode,
    ).toBe(200);

    const before = await issues();
    expect(before.some((i) => i.title === "Sub one")).toBe(true);
    expect(before.some((i) => i.title === "Sub two")).toBe(true);

    const result = await undo(turn.runId!);

    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({ error: { code: "NO_REVERSAL" } });
    expect(result.json().error.message).toMatch(/createSubtasks/);

    // Refused before touching anything: both subtasks survive intact.
    const after = await issues();
    expect(after.some((i) => i.title === "Sub one")).toBe(true);
    expect(after.some((i) => i.title === "Sub two")).toBe(true);
  });
});

/**
 * Explicit confirmation, not inference: the audit trail must hold a multi-issue
 * commit as one row per issue. If it collapsed them into a single row, undo
 * would reverse one issue and leave the other -- the original A1 bug
 * reappearing at the other end of the pipeline, and invisible until someone
 * undid a run and found half of it still applied.
 */
describe("what the audit trail stores for a multi-issue commit", () => {
  it("stores one action row per issue, with distinct targets", async () => {
    commit("WAL-1, WAL-3: touch two issues again", "pair.ts");

    const proposal = (await app.inject({ method: "POST", url: `/projects/${project}/git/commits` })).json() as {
      run: { id: string } | null;
      proposed: { issueKey: string }[];
    };
    expect(proposal.proposed.map((p) => p.issueKey).sort()).toEqual(["WAL-1", "WAL-3"]);

    await app.inject({ method: "POST", url: `/projects/${project}/agent/${proposal.run!.id}/apply` });

    const { getDb, runActionsRepo } = await import("@ai-pm/database");
    const recorded = runActionsRepo.listRunActions(getDb(), proposal.run!.id);

    // Two rows, not one row describing two issues.
    expect(recorded).toHaveLength(2);
    expect(new Set(recorded.map((r) => r.targetId)).size).toBe(2);
    expect(recorded.every((r) => r.reversible)).toBe(true);
    expect(recorded.every((r) => r.tool === "advanceIssueFromCommit")).toBe(true);

    // Each row carries its own before/after, which is what makes both
    // reversible independently.
    expect(recorded.every((r) => r.before !== null && r.after !== null)).toBe(true);
    expect(recorded.map((r) => r.before!.status)).toEqual(["in_progress", "in_progress"]);
    expect(recorded.map((r) => r.after!.status)).toEqual(["in_review", "in_review"]);
  });
});
