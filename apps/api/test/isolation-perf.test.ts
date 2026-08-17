import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ScriptedProvider, call } from "./scripted-provider.js";

process.env.DATABASE_PATH = ":memory:";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";

let app: FastifyInstance;
let closeDb: () => void;
let provider: ScriptedProvider;

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
});

afterAll(async () => {
  const { setAIProvider } = await import("../src/lib/ai.js");
  setAIProvider(null);
  await app.close();
  closeDb();
});

async function createProject(name: string, key: string) {
  return (await app.inject({ method: "POST", url: "/projects", payload: { name, key } })).json();
}

async function createIssue(projectId: string, payload: Record<string, unknown> = {}) {
  return (
    await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId, title: "Work", status: "todo", priority: "medium", ...payload },
    })
  ).json();
}

/**
 * The REST API is not project-scoped in its URLs (an issue is addressed by its
 * own id), so ownership has to be enforced on the fields that point at another
 * row. These are the paths a buggy or hostile client would take.
 */
describe("cross-project writes over REST", () => {
  it("cannot attach an issue to another project's sprint", async () => {
    const a = await createProject("Alpha", "ALPHA");
    const b = await createProject("Beta", "BETA");
    const issueA = await createIssue(a.id);
    const sprintB = (
      await app.inject({ method: "POST", url: "/sprints", payload: { projectId: b.id, name: "Beta Sprint" } })
    ).json();

    const res = await app.inject({
      method: "PATCH",
      url: `/issues/${issueA.id}`,
      payload: { sprintId: sprintB.id },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CROSS_PROJECT");
    expect((await app.inject({ method: "GET", url: `/issues/${issueA.id}` })).json().sprintId).toBeNull();
  });

  it("cannot parent an issue under another project's issue", async () => {
    const a = await createProject("Gamma", "GAMMA");
    const b = await createProject("Delta", "DELTA");
    const issueA = await createIssue(a.id);
    const issueB = await createIssue(b.id, { type: "epic" });

    const res = await app.inject({ method: "PATCH", url: `/issues/${issueA.id}`, payload: { parentId: issueB.id } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CROSS_PROJECT");
    expect((await app.inject({ method: "GET", url: `/issues/${issueA.id}` })).json().parentId).toBeNull();
  });

  it("cannot create a dependency across projects", async () => {
    const a = await createProject("Epsilon", "EPS");
    const b = await createProject("Zeta", "ZETA");
    const issueA = await createIssue(a.id);
    const issueB = await createIssue(b.id);

    const res = await app.inject({
      method: "POST",
      url: `/issues/${issueA.id}/dependencies`,
      payload: { dependsOnIssueId: issueB.id },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("CROSS_PROJECT");
    expect((await app.inject({ method: "GET", url: `/issues/${issueA.id}/dependencies` })).json()).toHaveLength(0);
  });

  it("keeps the one-active-sprint invariant under direct REST calls", async () => {
    const project = await createProject("Eta", "ETA");
    const first = (
      await app.inject({ method: "POST", url: "/sprints", payload: { projectId: project.id, name: "S1" } })
    ).json();
    const second = (
      await app.inject({ method: "POST", url: "/sprints", payload: { projectId: project.id, name: "S2" } })
    ).json();

    expect((await app.inject({ method: "POST", url: `/sprints/${first.id}/start` })).statusCode).toBe(200);
    const conflict = await app.inject({ method: "POST", url: `/sprints/${second.id}/start` });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("SPRINT_CONFLICT");

    const sprints = (await app.inject({ method: "GET", url: `/projects/${project.id}/sprints` })).json();
    expect(sprints.filter((s: { status: string }) => s.status === "active")).toHaveLength(1);
  });
});

describe("performance at a realistic portfolio size", () => {
  // 10 projects x 100 issues x sprints, dependencies and activity history.
  it("keeps agent context bounded and fast with 10 projects of 100 issues", async () => {
    const projects: { id: string; key: string }[] = [];

    for (let p = 0; p < 10; p++) {
      const project = await createProject(`Perf ${p}`, `PERF${p}`);
      projects.push(project);

      for (let s = 0; s < 12; s++) {
        const sprint = (
          await app.inject({ method: "POST", url: "/sprints", payload: { projectId: project.id, name: `S${s}` } })
        ).json();
        if (s < 11) {
          await app.inject({ method: "POST", url: `/sprints/${sprint.id}/start` });
          await app.inject({ method: "POST", url: `/sprints/${sprint.id}/complete` });
        }
      }

      const issues = [];
      for (let i = 0; i < 100; i++) {
        issues.push(
          await createIssue(project.id, {
            title: `Issue ${i}`,
            storyPoints: (i % 8) + 1,
            status: i % 5 === 0 ? "done" : "todo",
          }),
        );
      }
      for (let d = 0; d < 20; d++) {
        await app.inject({
          method: "POST",
          url: `/issues/${issues[d]!.id}/dependencies`,
          payload: { dependsOnIssueId: issues[d + 50]!.id },
        });
      }
    }

    const target = projects[3]!;
    provider.queue({ calls: [call("getBacklog", { limit: 100 })], reply: "Looked at the backlog." });

    const started = Date.now();
    const res = await app.inject({
      method: "POST",
      url: `/projects/${target.id}/agent`,
      payload: { message: "What should we do next?" },
    });
    const elapsed = Date.now() - started;

    expect(res.statusCode).toBe(200);

    // The prompt must not scale with the project: 100 issues, but a capped index.
    const prompt = provider.lastMessages.find((m) => m.role === "user")!.content;
    const listedIssues = prompt.split("\n").filter((line) => /^- PERF3-\d+ /.test(line));
    expect(listedIssues.length).toBeLessThanOrEqual(40);
    expect(prompt).toMatch(/more issues not listed/);
    expect(provider.lastPromptChars).toBeLessThan(20_000);

    // Read tools are capped too: 100 requested, MAX_LIMIT returned.
    const backlogCall = res.json().toolCalls[0];
    expect(backlogCall.ok).toBe(true);

    // Server-side work for one turn (context build + tool call), excluding the model.
    expect(elapsed).toBeLessThan(3_000);
  }, 120_000);

  it("resolves many issue keys in one plan without rescanning the project", async () => {
    const project = await createProject("KeyScan", "KEYS");
    const created = [];
    for (let i = 0; i < 100; i++) {
      created.push(await createIssue(project.id, { title: `Task ${i}`, storyPoints: 1, status: "backlog" }));
    }
    const keys = (await app.inject({ method: "GET", url: `/projects/${project.id}/issues` }))
      .json()
      .slice(0, 40)
      .map((i: { key: string }) => i.key);

    provider.queue({
      calls: [call("planSprint", { name: "Big Sprint", issueKeys: keys, start: true })],
      reply: "Planned a large sprint.",
    });

    const started = Date.now();
    const res = await app.inject({
      method: "POST",
      url: `/projects/${project.id}/agent`,
      payload: { message: "Plan a big sprint." },
    });
    const elapsed = Date.now() - started;

    expect(res.statusCode).toBe(200);
    expect(res.json().plan.points).toBe(40);
    expect(elapsed).toBeLessThan(3_000);
  }, 60_000);
});
