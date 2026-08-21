import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ScriptedProvider, call } from "./scripted-provider.js";

process.env.DATABASE_PATH = ":memory:";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";

let app: FastifyInstance;
let closeDb: () => void;
let provider: ScriptedProvider;
let ecom: { id: string; key: string };
let crm: { id: string; key: string };

async function post(url: string, payload?: unknown) {
  const res = await app.inject({ method: "POST", url, payload: payload as never });
  return { status: res.statusCode, body: res.statusCode === 204 ? null : res.json() };
}
async function get(url: string) {
  const res = await app.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.json() };
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

  ecom = (await post("/projects", { name: "Ecommerce", key: "ECOM", repositoryPath: "/tmp/ecom" })).body;
  crm = (await post("/projects", { name: "CRM Platform", key: "CRM" })).body;

  // ECOM: an active sprint, one blocked issue, real progress.
  const sprint = (await post("/sprints", { projectId: ecom.id, name: "Sprint 8" })).body;
  await post(`/sprints/${sprint.id}/start`);
  const blocker = (
    await post("/issues", { projectId: ecom.id, title: "Auth service", status: "todo", storyPoints: 5, sprintId: sprint.id })
  ).body;
  const blocked = (
    await post("/issues", { projectId: ecom.id, title: "Checkout", status: "todo", storyPoints: 8, sprintId: sprint.id })
  ).body;
  await post(`/issues/${blocked.id}/dependencies`, { dependsOnIssueId: blocker.id });
  const done = (
    await post("/issues", { projectId: ecom.id, title: "Landing page", status: "todo", storyPoints: 7, sprintId: sprint.id })
  ).body;
  await post(`/issues/${done.id}/complete`);

  // CRM: quieter, no active sprint.
  await post("/issues", { projectId: crm.id, title: "Contact import", status: "todo", storyPoints: 5 });
});

afterAll(async () => {
  const { setAIProvider } = await import("../src/lib/ai.js");
  setAIProvider(null);
  await app.close();
  closeDb();
});

beforeEach(() => provider.reset());

describe("portfolio state", () => {
  it("summarizes every project deterministically, without AI", async () => {
    const { status, body } = await get("/portfolio/state");
    expect(status).toBe(200);
    expect(body.generatedAt).toBeTruthy();

    const ecomSummary = body.projects.find((p: { key: string }) => p.key === "ECOM");
    expect(ecomSummary.activeSprint.name).toBe("Sprint 8");
    expect(ecomSummary.activeSprint.totalPoints).toBe(20);
    expect(ecomSummary.activeSprint.completedPoints).toBe(7);
    expect(ecomSummary.progressPercent).toBe(35); // 7 of 20 points
    expect(ecomSummary.doneIssues).toBe(1);
    expect(ecomSummary.openIssues).toBe(2);
    expect(ecomSummary.blockedIssues).toBe(1); // Checkout waits on Auth service
    expect(ecomSummary.repositoryConnected).toBe(true);
    expect(ecomSummary.lastActivityAt).toBeTruthy();

    const crmSummary = body.projects.find((p: { key: string }) => p.key === "CRM");
    expect(crmSummary.activeSprint).toBeNull();
    expect(crmSummary.blockedIssues).toBe(0);
    expect(crmSummary.repositoryConnected).toBe(false);
    expect(crmSummary.velocity).toBeNull(); // no completed sprints yet
  });

  it("does not carry any project's issue list", async () => {
    const { body } = await get("/portfolio/state");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("Checkout");
    expect(serialized).not.toContain("Contact import");
  });
});

describe("portfolio agent", () => {
  it("answers from the summary and can drill into one project", async () => {
    provider.queue({
      calls: [call("getPortfolioState"), call("getProjectDetail", { projectKey: "ECOM" })],
      reply: "FACT: ECOM has 1 blocked issue.\nRISK: Checkout cannot start.\nRECOMMENDATION: unblock Auth service.",
    });

    const { status, body } = await post("/agent", { message: "Which project needs my attention most?" });
    expect(status).toBe(200);
    expect(body.toolCalls.every((tc: { ok: boolean }) => tc.ok)).toBe(true);
    expect(body.actions).toHaveLength(0);
    expect(body.status).toBe("done");

    const detail = body.toolCalls[1];
    expect(detail.name).toBe("getProjectDetail");
    expect(detail.kind).toBe("read");
  });

  it("has no write tools at all: cross-project mutation is impossible, not merely gated", async () => {
    const before = await get("/portfolio/state");

    provider.queue({
      calls: [
        call("createIssue", { title: "Should never exist" }),
        call("planSprint", { name: "Should never exist" }),
        call("deleteProject", {}),
      ],
      reply: "I can only read across projects.",
    });

    const { body } = await post("/agent", { message: "Clean up all the stale work everywhere." });
    expect(body.toolCalls).toHaveLength(3);
    expect(body.toolCalls.every((tc: { ok: boolean }) => !tc.ok)).toBe(true);
    expect(body.toolCalls[0].summary).toMatch(/read-only/i);
    expect(body.actions).toHaveLength(0);
    expect(body.appliedResults).toHaveLength(0);

    // Neither project moved.
    expect((await get("/portfolio/state")).body.projects).toEqual(before.body.projects);
    const ecomIssues = (await get(`/projects/${ecom.id}/issues`)).body;
    expect(ecomIssues.some((i: { title: string }) => i.title === "Should never exist")).toBe(false);
  });

  it("refuses to invent a project that does not exist", async () => {
    provider.queue({
      calls: [call("getProjectDetail", { projectKey: "MOBILE" })],
      reply: "There is no MOBILE project in this portfolio.",
    });

    const { body } = await post("/agent", { message: "How is the Mobile app doing?" });
    expect(body.toolCalls[0].ok).toBe(false);
    expect(body.toolCalls[0].summary).toMatch(/No project with key or name "MOBILE"/);
  });

  it("keeps the portfolio prompt bounded and fenced", async () => {
    provider.queue({ calls: [], reply: "Nothing to report." });
    await post("/agent", { message: "Status?" });

    const prompt = provider.lastMessages.find((m) => m.role === "user")!.content;
    expect(prompt).toContain("<portfolio_data>");
    expect(provider.lastPromptChars).toBeLessThan(8_000);
    // One line per project, not one line per issue.
    expect(prompt.split("\n").filter((l) => l.startsWith("- ")).length).toBe(2);

    const system = provider.lastMessages.find((m) => m.role === "system")!.content;
    expect(system).toMatch(/FACT/);
    expect(system).toMatch(/read-only/i);
  });
});

describe("project memory API", () => {
  it("supports the full decision lifecycle through domain functions", async () => {
    const created = await post(`/projects/${ecom.id}/decisions`, {
      title: "Use Redis for token revocation",
      context: "Sessions had to be killable instantly",
      decision: "Redis with a short TTL denylist",
      rationale: "Immediate logout was a hard requirement",
    });
    expect(created.status).toBe(201);

    const list = await get(`/projects/${ecom.id}/decisions`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].rationale).toMatch(/Immediate logout/);

    const patched = await app.inject({
      method: "PATCH",
      url: `/projects/${ecom.id}/decisions/${created.body.id}`,
      payload: { rationale: "Immediate logout was required by security review" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().rationale).toMatch(/security review/);
    expect(patched.json().title).toBe("Use Redis for token revocation"); // untouched fields survive

    const removed = await app.inject({
      method: "DELETE",
      url: `/projects/${ecom.id}/decisions/${created.body.id}`,
    });
    expect(removed.statusCode).toBe(204);
    expect((await get(`/projects/${ecom.id}/decisions`)).body).toHaveLength(0);
  });

  it("keeps decisions and milestones scoped to their project", async () => {
    const decision = (await post(`/projects/${ecom.id}/decisions`, { title: "ECOM only decision" })).body;
    const milestone = (await post(`/projects/${ecom.id}/milestones`, { title: "ECOM only milestone" })).body;

    expect((await get(`/projects/${crm.id}/decisions`)).body).toHaveLength(0);
    expect((await get(`/projects/${crm.id}/milestones`)).body).toHaveLength(0);

    // Addressing another project's memory by id is a 404, not a silent edit.
    expect((await get(`/projects/${crm.id}/decisions/${decision.id}`)).status).toBe(404);
    const crossPatch = await app.inject({
      method: "PATCH",
      url: `/projects/${crm.id}/decisions/${decision.id}`,
      payload: { title: "Stolen" },
    });
    expect(crossPatch.statusCode).toBe(404);
    expect((await get(`/projects/${ecom.id}/decisions/${decision.id}`)).body.title).toBe("ECOM only decision");

    const crossDelete = await app.inject({
      method: "DELETE",
      url: `/projects/${crm.id}/milestones/${milestone.id}`,
    });
    expect(crossDelete.statusCode).toBe(404);
    expect((await get(`/projects/${ecom.id}/milestones`)).body).toHaveLength(1);
  });

  it("keeps AI-inferred milestones out of history until a human confirms them", async () => {
    const { milestonesRepo, getDb } = await import("@ai-pm/database");
    const inferred = milestonesRepo.createMilestone(getDb(), ecom.id, {
      title: "Inferred: v1 shipped",
      source: "inferred",
    });
    expect(inferred.confirmed).toBe(false);

    const confirmedOnly = (await get(`/projects/${ecom.id}/milestones`)).body;
    expect(confirmedOnly.some((m: { id: string }) => m.id === inferred.id)).toBe(false);

    const withUnconfirmed = (await get(`/projects/${ecom.id}/milestones?includeUnconfirmed=true`)).body;
    expect(withUnconfirmed.some((m: { id: string }) => m.id === inferred.id)).toBe(true);

    await post(`/projects/${ecom.id}/milestones/${inferred.id}/confirm`);
    const afterConfirm = (await get(`/projects/${ecom.id}/milestones`)).body;
    expect(afterConfirm.some((m: { id: string }) => m.id === inferred.id)).toBe(true);
  });

  it("completes a milestone with a timestamp, once", async () => {
    const milestone = (await post(`/projects/${ecom.id}/milestones`, { title: "Beta launch" })).body;
    expect(milestone.status).toBe("planned");
    expect(milestone.completedAt).toBeNull();

    const completed = await post(`/projects/${ecom.id}/milestones/${milestone.id}/complete`);
    expect(completed.body.status).toBe("reached");
    expect(completed.body.completedAt).toBeTruthy();

    const again = await post(`/projects/${ecom.id}/milestones/${milestone.id}/complete`);
    expect(again.status).toBe(409);
  });

  it("answers 'why did we choose X' from memory, and says so when nothing was recorded", async () => {
    await post(`/projects/${ecom.id}/decisions`, {
      title: "Chose SQLite",
      decision: "SQLite as the only datastore",
      rationale: "NEMO is local-first, so a server database would defeat the point",
    });

    provider.queue({
      calls: [call("listDecisions", { search: "SQLite" })],
      reply: "You chose SQLite because NEMO is local-first.",
    });
    const answered = await post(`/projects/${ecom.id}/agent`, { message: "Why did we choose SQLite?" });
    const readCall = answered.body.toolCalls[0];
    expect(readCall.ok).toBe(true);

    // The tool result is what grounds the answer -- it must actually contain it.
    const { getDb, decisionsRepo } = await import("@ai-pm/database");
    const stored = decisionsRepo.listDecisionsByProject(getDb(), ecom.id);
    expect(stored.some((d) => /local-first/.test(d.rationale ?? ""))).toBe(true);

    // Nothing recorded about Kafka: the read returns no matches to ground on.
    provider.queue({
      calls: [call("listDecisions", { search: "Kafka" })],
      reply: "Nothing was recorded about Kafka.",
    });
    const unanswerable = await post(`/projects/${ecom.id}/agent`, { message: "Why did we choose Kafka?" });
    expect(unanswerable.body.toolCalls[0].ok).toBe(true);
    expect(unanswerable.body.actions).toHaveLength(0);
  });
});

describe("code context transport", () => {
  const secretSelection = {
    activeFile: { path: "src/auth/login.ts", languageId: "typescript" },
    selection: {
      path: "src/auth/login.ts",
      languageId: "typescript",
      startLine: 10,
      endLine: 13,
      text: 'const token = verify(req);\nconst API_KEY = "sk-live-4f9d8a7b6c5e4d3f2a1b0c9d8e7f6a5b";\nreturn token;',
    },
    diagnostics: [
      { path: "src/auth/login.ts", line: 11, severity: "error", message: "Token may be undefined", source: "ts" },
    ],
    branch: "feature/auth-refresh",
    workingTree: "2 file(s) changed (src/auth/login.ts, src/auth/session.ts)",
    relatedFiles: [],
  };

  it("carries the editor context into the prompt and to the getCodeContext tool", async () => {
    provider.queue({
      calls: [call("getCodeContext"), call("createIssue", { title: "Login token may be undefined", type: "bug", priority: "high" })],
      reply: "Created a bug for the selected code.",
    });

    const { body } = await post(`/projects/${ecom.id}/agent`, {
      message: "Create a high priority bug for this.",
      codeContext: secretSelection,
    });

    expect(body.appliedResults[0].ok).toBe(true);
    const prompt = provider.lastMessages.find((m) => m.role === "user")!.content;
    expect(prompt).toContain("src/auth/login.ts");
    expect(prompt).toContain("feature/auth-refresh");
    expect(prompt).toContain("Token may be undefined");
    expect(prompt).toContain("Selected lines 10-13");
  });

  it("redacts credentials and drops unsafe paths before anything reaches the model", async () => {
    provider.queue({ calls: [], reply: "ok" });
    await post(`/projects/${ecom.id}/agent`, {
      message: "What about this?",
      codeContext: {
        ...secretSelection,
        activeFile: { path: ".env", languageId: "dotenv" },
        selection: { ...secretSelection.selection, path: ".env" },
        diagnostics: [
          { path: "node_modules/lib/index.js", line: 1, severity: "error", message: "x", source: null },
        ],
        relatedFiles: ["node_modules/lib/index.js", "../../etc/passwd", "C:/Users/me/keys.pem", "src/ok.ts"],
      },
    });

    const prompt = provider.lastMessages.find((m) => m.role === "user")!.content;
    expect(prompt).not.toContain("sk-live-4f9d8a7b6c5e4d3f2a1b0c9d8e7f6a5b");
    expect(prompt).not.toContain(".env");
    expect(prompt).not.toContain("node_modules");
    expect(prompt).not.toContain("etc/passwd");
    expect(prompt).not.toContain("keys.pem");
    expect(prompt).toContain("src/ok.ts");
  });

  it("redacts a credential even inside an allowed file", async () => {
    provider.queue({ calls: [call("getCodeContext")], reply: "ok" });
    const { body } = await post(`/projects/${ecom.id}/agent`, {
      message: "Explain this selection.",
      codeContext: secretSelection,
    });

    const prompt = provider.lastMessages.find((m) => m.role === "user")!.content;
    expect(prompt).not.toContain("sk-live-4f9d8a7b6c5e4d3f2a1b0c9d8e7f6a5b");
    expect(prompt).toContain("[redacted: possible credential]");
    expect(prompt).toContain("const token = verify(req);"); // the harmless lines survive
    expect(body.toolCalls[0].ok).toBe(true);
  });

  it("works without editor context: web requests are not second-class", async () => {
    provider.queue({
      calls: [call("createIssue", { title: "From the web", type: "task" })],
      reply: "Created it.",
    });
    const { body } = await post(`/projects/${ecom.id}/agent`, { message: "Create a task called From the web." });

    expect(body.appliedResults[0].ok).toBe(true);
    const prompt = provider.lastMessages.find((m) => m.role === "user")!.content;
    expect(prompt).not.toContain("Editor context");
  });
});

describe("web agent flow", () => {
  it("runs the same propose/apply/reject cycle the extension uses", async () => {
    provider.queue({
      calls: [call("createSprint", { name: "Web Sprint" })],
      reply: "Proposing a sprint.",
    });
    const proposed = await post(`/projects/${ecom.id}/agent`, { message: "Create a sprint called Web Sprint." });
    expect(proposed.body.status).toBe("proposed");
    expect(proposed.body.plan).not.toBeNull();

    const applied = await post(`/projects/${ecom.id}/agent/${proposed.body.runId}/apply`);
    expect(applied.body.status).toBe("applied");
    expect((await get(`/projects/${ecom.id}/sprints`)).body.some((s: { name: string }) => s.name === "Web Sprint")).toBe(
      true,
    );

    provider.queue({ calls: [call("createSprint", { name: "Rejected From Web" })], reply: "Proposing a sprint." });
    const toReject = await post(`/projects/${ecom.id}/agent`, { message: "Create another sprint." });
    const rejected = await post(`/projects/${ecom.id}/agent/${toReject.body.runId}/reject`);
    expect(rejected.body.status).toBe("rejected");
    expect(
      (await get(`/projects/${ecom.id}/sprints`)).body.some((s: { name: string }) => s.name === "Rejected From Web"),
    ).toBe(false);
  });
});
