import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ScriptedProvider, call } from "./scripted-provider.js";

process.env.DATABASE_PATH = ":memory:";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";

let app: FastifyInstance;
let closeDb: () => void;
let provider: ScriptedProvider;
let project: string;

const ask = async (message: string) =>
  (await app.inject({ method: "POST", url: `/projects/${project}/agent`, payload: { message } })).json() as {
    runId: string | null;
  };

const apply = (runId: string) =>
  app.inject({ method: "POST", url: `/projects/${project}/agent/${runId}/apply` });

const undo = (runId?: string) =>
  app.inject({ method: "POST", url: `/projects/${project}/agent/undo`, payload: runId ? { runId } : {} });

const issues = async () =>
  (await app.inject({ method: "GET", url: `/projects/${project}/issues` })).json() as {
    id: string;
    key: string;
    title: string;
    status: string;
    priority: string;
  }[];

const byKey = async (key: string) => (await issues()).find((i) => i.key === key);

/** Queues an ask-tier plan, runs the turn, applies it, and hands back the run id. */
async function applyPlan(message: string, calls: ReturnType<typeof call>[]) {
  provider.reset();
  provider.queue({ calls, reply: "Planned." });
  const { runId } = await ask(message);
  if (!runId) throw new Error("expected a run to be proposed");
  const response = await apply(runId);
  expect(response.statusCode).toBe(200);
  return runId;
}

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

  project = (
    (await app.inject({ method: "POST", url: "/projects", payload: { name: "Wallet", key: "WAL" } })).json() as {
      id: string;
    }
  ).id;
});

afterAll(async () => {
  const { setAIProvider } = await import("../src/lib/ai.js");
  setAIProvider(null);
  await app.close();
  closeDb();
});

beforeEach(() => provider.reset());

describe("undoing an applied run", () => {
  it("puts an issue back the way it was", async () => {
    await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project, title: "Login screen", status: "todo", priority: "low" },
    });

    const runId = await applyPlan("Raise the priority of WAL-1", [
      call("advanceIssueFromCommit", { issueKey: "WAL-1", status: "in_review", commitHash: "abc1234" }),
    ]);
    expect((await byKey("WAL-1"))!.status).toBe("in_review");

    const result = await undo(runId);

    expect(result.statusCode).toBe(200);
    expect((await byKey("WAL-1"))!.status).toBe("todo");
  });

  // B2
  it("refuses a second undo of the same run rather than reversing twice", async () => {
    const runId = await applyPlan("Move WAL-1 again", [
      call("advanceIssueFromCommit", { issueKey: "WAL-1", status: "in_review", commitHash: "def5678" }),
    ]);
    expect((await undo(runId)).statusCode).toBe(200);

    const second = await undo(runId);

    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: "ALREADY_REVERTED" } });
    // Still exactly one reversal: the issue did not move a second time.
    expect((await byKey("WAL-1"))!.status).toBe("todo");
  });

  // B1
  it("refuses when the target was edited by hand after the run", async () => {
    const runId = await applyPlan("Move WAL-1 to review", [
      call("advanceIssueFromCommit", { issueKey: "WAL-1", status: "in_review", commitHash: "aaa1111" }),
    ]);

    // Somebody edits the same issue through the ordinary API.
    const issue = (await byKey("WAL-1"))!;
    await app.inject({ method: "PATCH", url: `/issues/${issue.id}`, payload: { priority: "critical" } });

    const result = await undo(runId);

    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({ error: { code: "CONFLICT" } });
    // The manual edit survived, and so did the run's own change.
    expect((await byKey("WAL-1"))!.priority).toBe("critical");
    expect((await byKey("WAL-1"))!.status).toBe("in_review");
  });

  // B3
  it("reports plainly when the target no longer exists", async () => {
    await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project, title: "Temporary", status: "todo" },
    });
    const temp = (await issues()).find((i) => i.title === "Temporary")!;

    const runId = await applyPlan("Move the temporary issue", [
      call("advanceIssueFromCommit", { issueKey: temp.key, status: "in_review", commitHash: "bbb2222" }),
    ]);

    await app.inject({ method: "DELETE", url: `/issues/${temp.id}` });

    const result = await undo(runId);

    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({ error: { code: "TARGET_GONE" } });
  });

  // B5
  it("rejects a run containing an action with no defined reversal, before touching anything", async () => {
    await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project, title: "Sprint candidate", status: "todo", storyPoints: 3 },
    });

    const runId = await applyPlan("Plan a sprint", [call("planSprint", { name: "Sprint One", start: true })]);

    const result = await undo(runId);

    expect(result.statusCode).toBe(409);
    expect(result.json()).toMatchObject({ error: { code: "NO_REVERSAL" } });
    expect(result.json().error.message).toMatch(/planSprint/);
  });

  // B4
  it("reverses every action or none of them", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project, title: "Multi A", status: "todo" },
    });
    const second = await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project, title: "Multi B", status: "todo" },
    });
    const keyA = (first.json() as { key: string }).key;
    const keyB = (second.json() as { key: string }).key;

    const runId = await applyPlan("Move both", [
      call("advanceIssueFromCommit", { issueKey: keyA, status: "in_review", commitHash: "ccc3333" }),
      call("advanceIssueFromCommit", { issueKey: keyB, status: "in_review", commitHash: "ccc3333" }),
    ]);
    expect((await byKey(keyA))!.status).toBe("in_review");
    expect((await byKey(keyB))!.status).toBe("in_review");

    // Make only the second one conflict.
    const bId = (await byKey(keyB))!.id;
    await app.inject({ method: "PATCH", url: `/issues/${bId}`, payload: { priority: "critical" } });

    const blocked = await undo(runId);

    expect(blocked.statusCode).toBe(409);
    // All or none: the first issue was not quietly reverted on its own.
    expect((await byKey(keyA))!.status).toBe("in_review");
    expect((await byKey(keyB))!.status).toBe("in_review");
  });

  it("undoes a whole multi-action run when nothing has moved", async () => {
    const a = await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project, title: "Clean A", status: "todo" },
    });
    const b = await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project, title: "Clean B", status: "backlog" },
    });
    const keyA = (a.json() as { key: string }).key;
    const keyB = (b.json() as { key: string }).key;

    const runId = await applyPlan("Move both cleanly", [
      call("advanceIssueFromCommit", { issueKey: keyA, status: "in_review", commitHash: "ddd4444" }),
      call("advanceIssueFromCommit", { issueKey: keyB, status: "in_review", commitHash: "ddd4444" }),
    ]);

    expect((await undo(runId)).statusCode).toBe(200);
    expect((await byKey(keyA))!.status).toBe("todo");
    expect((await byKey(keyB))!.status).toBe("backlog");
  });

  it("has nothing to undo in a project that has applied nothing", async () => {
    const fresh = (
      (await app.inject({ method: "POST", url: "/projects", payload: { name: "Fresh", key: "FRSH" } })).json() as {
        id: string;
      }
    ).id;

    const result = await app.inject({ method: "POST", url: `/projects/${fresh}/agent/undo`, payload: {} });

    expect(result.statusCode).toBe(404);
    expect(result.json()).toMatchObject({ error: { code: "NOTHING_TO_UNDO" } });
  });

  // B6 — approver policy, stated deliberately rather than left to whatever the
  // code happens to do.
  it("records who approved, and does not gate undo on identity", async () => {
    const { getDb, runActionsRepo } = await import("@ai-pm/database");
    await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project, title: "Approver check", status: "todo" },
    });
    const target = (await issues()).find((i) => i.title === "Approver check")!;

    const runId = await applyPlan("Move the approver-check issue", [
      call("advanceIssueFromCommit", { issueKey: target.key, status: "in_review", commitHash: "eee5555" }),
    ]);

    // Every applied action carries an approver, so the audit trail can answer
    // "who agreed to this" even though today there is only ever one answer.
    const recorded = runActionsRepo.listRunActions(getDb(), runId);
    expect(recorded).not.toHaveLength(0);
    expect(recorded.every((entry) => entry.approver === "local")).toBe(true);

    // NEMO is local-first with no accounts: there is no second identity that
    // could be checked, so undo is deliberately not gated on matching the
    // original approver. If accounts ever arrive, this is the test that should
    // start failing.
    expect((await undo(runId)).statusCode).toBe(200);
    expect((await byKey(target.key))!.status).toBe("todo");
  });
});
