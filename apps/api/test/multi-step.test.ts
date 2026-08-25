import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ScriptedProvider, call } from "./scripted-provider.js";
import { contextualiseStep, planSteps } from "../src/lib/multi-step.js";

process.env.DATABASE_PATH = ":memory:";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";

let app: FastifyInstance;
let closeDb: () => void;
let provider: ScriptedProvider;
let project: string;

const ask = async (message: string) =>
  (await app.inject({ method: "POST", url: `/projects/${project}/agent`, payload: { message } })).json() as {
    reply: string;
    toolCalls: { name: string; ok: boolean }[];
    actions: { tool: string }[];
  };

const issues = async () =>
  (await app.inject({ method: "GET", url: `/projects/${project}/issues` })).json() as {
    key: string;
    title: string;
    sprintId: string | null;
  }[];

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

/**
 * Priority 4. The eval measured local models doing the first action of a
 * compound request and stopping, or inventing arguments for the second. The
 * split is deterministic because a 2GB VRAM ceiling is not a prompt problem.
 */
describe("recognising a compound request", () => {
  it("splits on the conjunctions people actually use", () => {
    for (const message of [
      "Create a task called Refund emails, then put it in Sprint Beta",
      "Create a task called Refund emails and then add it to the sprint",
      "Create the issue, after that assign it to the sprint",
      "Add a bug for the crash and also set its priority to high",
    ]) {
      expect(planSteps(message).isMultiStep, message).toBe(true);
      expect(planSteps(message).steps.length, message).toBeGreaterThan(1);
    }
  });

  // A conjunction joining a noun or an aside is not a second instruction.
  it("leaves a single request alone", () => {
    for (const message of [
      "Create a task for login and signup",
      "Create a task and then we can discuss the estimate",
      "Plan the sprint",
      "What changed recently?",
      "Move WAL-1 to done",
    ]) {
      expect(planSteps(message).isMultiStep, message).toBe(false);
      expect(planSteps(message).steps, message).toEqual([message]);
    }
  });

  it("caps how many steps one message can become", () => {
    const long = "Create A, then create B, then create C, then create D, then create E";

    expect(planSteps(long).steps.length).toBeLessThanOrEqual(3);
  });

  it("tells a later step what the earlier ones did", () => {
    const step = contextualiseStep("put it in Sprint Beta", ["Created WAL-1: Refund emails"]);

    expect(step).toContain("Created WAL-1: Refund emails");
    expect(step).toContain("put it in Sprint Beta");
    expect(step).toMatch(/only this/i);
  });

  it("leaves the first step untouched", () => {
    expect(contextualiseStep("create a task", [])).toBe("create a task");
  });
});

describe("running a compound request end to end", () => {
  it("performs both actions, not just the first", async () => {
    provider.queue({ calls: [call("createIssue", { title: "Refund emails", storyPoints: 2 })], reply: "Created." });
    provider.queue({ calls: [call("createSprint", { name: "Sprint Beta", start: true })], reply: "Sprint made." });

    const body = await ask("Create a task called Refund emails worth 2 points, then create Sprint Beta");

    const names = body.toolCalls.map((t) => t.name);
    expect(names).toContain("createIssue");
    expect(names).toContain("createSprint");
    expect((await issues()).some((i) => i.title === "Refund emails")).toBe(true);
  });

  it("numbers each step in the answer", async () => {
    provider.queue({ calls: [call("createIssue", { title: "Step one issue" })], reply: "First done." });
    provider.queue({ calls: [call("createIssue", { title: "Step two issue" })], reply: "Second done." });

    const body = await ask("Create Step one issue, then create Step two issue");

    expect(body.reply).toMatch(/^1\./m);
    expect(body.reply).toMatch(/^2\./m);
  });

  // Building a later action on a result that does not exist is worse than
  // stopping, so the second step is never attempted.
  it("stops when a step does nothing, and says so", async () => {
    provider.queue({ calls: [], reply: "I could not do that." });
    provider.queue({ calls: [call("createIssue", { title: "Should never exist" })], reply: "Second." });

    const body = await ask("Create nothing at all, then create Should never exist");

    expect(body.reply).toMatch(/Stopped after step 1/);
    expect((await issues()).some((i) => i.title === "Should never exist")).toBe(false);
  });

  it("still routes a single-step request through one turn", async () => {
    provider.queue({ calls: [call("createIssue", { title: "Single step" })], reply: "Made it." });

    const body = await ask("Create an issue called Single step");

    expect(body.reply).not.toMatch(/^1\./m);
    expect(body.toolCalls.map((t) => t.name)).toEqual(["createIssue"]);
  });
});
