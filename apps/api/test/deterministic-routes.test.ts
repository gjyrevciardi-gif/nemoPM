import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { OllamaShapedProvider } from "./ollama-shaped-provider.js";

process.env.DATABASE_PATH = ":memory:";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";

let app: FastifyInstance;
let closeDb: () => void;
let provider: OllamaShapedProvider;
let project: string;

const ask = async (message: string) =>
  (await app.inject({ method: "POST", url: `/projects/${project}/agent`, payload: { message } })).json() as {
    reply: string;
    toolCalls: { name: string; ok: boolean }[];
    runtime?: { modelCalls?: number };
  };

beforeAll(async () => {
  const dbModule = await import("@ai-pm/database");
  closeDb = dbModule.closeDb;
  dbModule.getDb();
  const { buildServer } = await import("../src/app.js");
  app = buildServer();
  await app.ready();

  const { setAIProvider } = await import("../src/lib/ai.js");
  provider = new OllamaShapedProvider();
  setAIProvider(provider);

  project = (
    (await app.inject({ method: "POST", url: "/projects", payload: { name: "Wallet", key: "WAL" } })).json() as {
      id: string;
    }
  ).id;

  const issue = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/issues", payload: { projectId: project, ...payload } });

  await issue({ title: "Login screen", status: "in_progress", priority: "high", storyPoints: 5 });
  await issue({ title: "Payments", status: "todo", priority: "medium", storyPoints: 8 });
  await issue({ title: "Wishlist", status: "backlog", priority: "low", storyPoints: 3 });
});

afterAll(async () => {
  const { setAIProvider } = await import("../src/lib/ai.js");
  setAIProvider(null);
  await app.close();
  closeDb();
});

beforeEach(() => provider.reset());

/**
 * E2 — the coverage gap called out in the last report, closed.
 *
 * These routes exist to answer without the model, and were previously
 * unreachable in tests because the gate was a `constructor.name` check for
 * "OllamaProvider". They are the paths that matter most on the hardware NEMO
 * actually runs on, and they were the least covered.
 */
describe("deterministic routes answer without consulting the model", () => {
  it("answers a question about recent changes from the record", async () => {
    const body = await ask("What changed recently?");

    expect(provider.turns).toBe(0);
    expect(body.toolCalls.map((t) => t.name)).toEqual(["getRecentActivity"]);
  });

  it("answers a question about risk from the risk engine", async () => {
    const body = await ask("What risks are open on this project?");

    expect(provider.turns).toBe(0);
    expect(body.toolCalls.map((t) => t.name)).toEqual(["getRisks"]);
  });

  it("plans a sprint under a points cap without the model", async () => {
    const body = await ask("Plan the next sprint with a maximum of 13 points.");

    expect(provider.turns).toBe(0);
    expect(body.toolCalls.map((t) => t.name)).toEqual(["planSprint"]);
    expect(body.reply).toMatch(/Total: \d+ pts/);
  });

  it("refuses destructive deletion without asking the model's opinion", async () => {
    const body = await ask("Delete this project and everything in it.");

    expect(provider.turns).toBe(0);
    expect(body.toolCalls[0]!.ok).toBe(false);
    expect(body.reply).toMatch(/blocked/i);
  });

  it("stops on an issue key that does not exist", async () => {
    const body = await ask("Move WAL-999 to done.");

    expect(provider.turns).toBe(0);
    expect(body.reply).toMatch(/WAL-999/);
    expect(body.reply).toMatch(/Nothing was changed/i);
  });
});

/**
 * The other half of the gap: what NEMO does with the badly-shaped answers real
 * small models give, end to end over HTTP rather than in a provider unit test.
 */
describe("badly-shaped model answers, over HTTP", () => {
  it("acts on a tool call the model printed as text", async () => {
    provider.queue({
      kind: "printedCall",
      text: '{"type":"function","name":"createIssue","parameters":{"title":"Recovered from text","type":"task"}}',
    });

    const body = await ask("Create a task for the login refactor");

    expect(body.toolCalls.map((t) => t.name)).toContain("createIssue");
    const issues = (await app.inject({ method: "GET", url: `/projects/${project}/issues` })).json() as {
      title: string;
    }[];
    expect(issues.some((i) => i.title === "Recovered from text")).toBe(true);
  });

  it("does not invent a call from prose that merely names a tool", async () => {
    provider.queue({ kind: "text", text: "I could use createIssue here, but I need more detail first." });

    const body = await ask("Create something for the payments work");

    expect(body.toolCalls.filter((t) => t.name === "createIssue")).toEqual([]);
  });

  it("corrects an answer claiming work that no write performed", async () => {
    provider.queue({ kind: "text", text: "I have created three new issues and they are now in the backlog." });

    const body = await ask("Create the backlog for the payments epic");

    expect(body.reply).toMatch(/^Nothing was created or changed/);
  });
});
