import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ScriptedProvider, call } from "./scripted-provider.js";
import { correctUnsupportedClaims } from "../src/lib/agent.js";

process.env.DATABASE_PATH = ":memory:";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";

let app: FastifyInstance;
let closeDb: () => void;
let provider: ScriptedProvider;
let repo: string;
let wallet: string;
let other: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

const commit = (subject: string, file: string) => {
  fs.writeFileSync(path.join(repo, file), `// ${subject}\n`);
  git("add", file);
  git("commit", "-m", subject);
};

const ask = async (projectId: string, message: string) =>
  (await app.inject({ method: "POST", url: `/projects/${projectId}/agent`, payload: { message } })).json();

const lastUserPrompt = () => provider.lastMessages.find((m) => m.role === "user")!.content;

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

  repo = fs.mkdtempSync(path.join(os.tmpdir(), "nemo-sweep-"));
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test Author");
  commit("initial", "readme.md");

  const project = async (name: string, key: string, repoPath: string | null) => {
    const id = ((await app.inject({ method: "POST", url: "/projects", payload: { name, key } })).json() as { id: string })
      .id;
    if (repoPath) await app.inject({ method: "PATCH", url: `/projects/${id}`, payload: { repositoryPath: repoPath } });
    return id;
  };

  wallet = await project("Wallet", "WAL", repo);
  other = await project("Ledger", "LED", null);
  await app.inject({
    method: "POST",
    url: "/issues",
    payload: { projectId: wallet, title: "Login screen", status: "in_progress" },
  });
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
 * C — the claim guard, retested now that git proposals put a second kind of
 * pending ask-tier action alongside the ones chat creates.
 */
describe("C1 — a write that was queued, not applied", () => {
  it("is not described as done", () => {
    const queuedOnly = [{ kind: "write", ok: true, queued: true }];
    const reply = "I have created the issue and it is now in the backlog.";

    // A queued write is a proposal. Only an applied one earns the past tense.
    const corrected = correctUnsupportedClaims(
      reply,
      queuedOnly.map((c) => ({ kind: c.kind, ok: c.queued ? false : c.ok })),
      new Set(),
    );

    expect(corrected).toMatch(/^Nothing was created or changed/);
  });
});

describe("C2 — an issue key proposed by a commit but not yet approved", () => {
  it("is not reported as done while the proposal is still pending", async () => {
    commit("WAL-1 finish the login screen", "login.ts");
    const proposal = (await app.inject({ method: "POST", url: `/projects/${wallet}/git/commits` })).json() as {
      proposed: unknown[];
    };
    expect(proposal.proposed).toHaveLength(1);

    // The board still says in_progress: a proposal is not a transition.
    const issues = (await app.inject({ method: "GET", url: `/projects/${wallet}/issues` })).json() as {
      key: string;
      status: string;
    }[];
    expect(issues.find((i) => i.key === "WAL-1")!.status).toBe("in_progress");

    // And a model claiming otherwise gets corrected, because no write ran.
    const corrected = correctUnsupportedClaims(
      "WAL-1 has been moved to review.",
      [{ kind: "read", ok: true }],
      new Set(["WAL-1"]),
    );
    expect(corrected).toMatch(/^Nothing was created or changed/);
  });
});

/**
 * D — conversation memory, retested alongside git-triggered proposals.
 */
describe("D1 — the turn right after a git proposal", () => {
  it("carries the earlier conversation into the next prompt", async () => {
    provider.queue({ calls: [], reply: "Wallet holds several currencies." });
    await ask(wallet, "Wallet is a multi-currency app.");

    await app.inject({ method: "POST", url: `/projects/${wallet}/git/commits` });

    provider.queue({ calls: [], reply: "Here is what is pending." });
    await ask(wallet, "What is waiting for me?");

    const prompt = lastUserPrompt();
    expect(prompt).toContain("Wallet is a multi-currency app.");
    expect(prompt).toContain("<conversation>");
  });

  it("shows the pending proposal in project state, so it is not invisible", async () => {
    const runs = (await app.inject({ method: "GET", url: `/projects/${wallet}/agent/runs` })).json() as {
      status: string;
    }[];

    expect(runs.some((run) => run.status === "proposed")).toBe(true);
  });
});

describe("D2 — two projects, one of them receiving commits", () => {
  it("never leaks one project's conversation into the other's prompt", async () => {
    provider.queue({ calls: [], reply: "Noted for Wallet." });
    await ask(wallet, "Wallet stores balances in cents.");

    provider.queue({ calls: [], reply: "Noted for Ledger." });
    await ask(other, "What should Ledger do next?");

    const prompt = lastUserPrompt();
    expect(prompt).not.toContain("Wallet stores balances in cents.");
    expect(prompt).not.toContain("Noted for Wallet.");
  });

  it("keeps git-derived work on the project that owns the repository", async () => {
    const otherRuns = (await app.inject({ method: "GET", url: `/projects/${other}/agent/runs` })).json() as unknown[];

    expect(otherRuns).toEqual([]);
  });
});

/**
 * E1 — the routing ordering fix, checked with phrasings that were not in the
 * original test, so a regression cannot hide behind the examples it was built on.
 */
describe("E1 — ambiguous phrasing that matches a read rule and a write rule", () => {
  it("prefers the rule that can act when the message plainly asks for action", async () => {
    const { DeterministicRouter } = await import("../src/lib/project-mode.js");
    const features = {
      projectCreatedAt: new Date().toISOString(),
      repositoryConnected: false,
      repositoryScanned: false,
      totalIssues: 0,
      activeIssues: 0,
      totalSprints: 0,
      activeSprint: false,
      completedRatio: 0,
      recentRepositoryActivity: false,
    };
    const route = (message: string) => new DeterministicRouter().route(message, features, {});

    for (const message of [
      "Build out the backlog from the MVP we discussed",
      "Draft the epics for this MVP",
      "Turn the MVP into a backlog please",
    ]) {
      expect((await route(message)).mutationIntent, message).not.toBe("none");
    }
  });

  it("still refuses to reach for a write when the message is a question", async () => {
    const { DeterministicRouter } = await import("../src/lib/project-mode.js");
    const features = {
      projectCreatedAt: new Date().toISOString(),
      repositoryConnected: false,
      repositoryScanned: false,
      totalIssues: 0,
      activeIssues: 0,
      totalSprints: 0,
      activeSprint: false,
      completedRatio: 0,
      recentRepositoryActivity: false,
    };
    const route = (message: string) => new DeterministicRouter().route(message, features, {});

    for (const message of [
      "What would the MVP backlog look like?",
      "Should we create epics for this MVP?",
      "Which issues would the MVP need?",
    ]) {
      expect((await route(message)).mutationIntent, message).toBe("none");
    }
  });
});
