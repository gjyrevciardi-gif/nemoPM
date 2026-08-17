import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

// Force an isolated in-memory database before any module (including
// @ai-pm/database) is imported, so these tests never touch the real
// data/ai-pm.db file used by `pnpm dev`.
process.env.DATABASE_PATH = ":memory:";

let app: FastifyInstance;
let closeDb: () => void;

beforeAll(async () => {
  const dbModule = await import("@ai-pm/database");
  closeDb = dbModule.closeDb;
  dbModule.getDb(); // ensure migrations run before the server starts handling requests

  const { buildServer } = await import("../src/app.js");
  app = buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDb();
});

describe("health", () => {
  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});

describe("core workflow", () => {
  it("creates a project, creates an issue, starts it, and completes it", async () => {
    const createProject = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Test Project", key: "TST" },
    });
    expect(createProject.statusCode).toBe(201);
    const project = createProject.json();
    expect(project.key).toBe("TST");

    const createIssue = await app.inject({
      method: "POST",
      url: "/issues",
      payload: { projectId: project.id, title: "Do the thing", type: "task", status: "todo", priority: "high" },
    });
    expect(createIssue.statusCode).toBe(201);
    const issue = createIssue.json();
    expect(issue.key).toBe("TST-1");
    expect(issue.status).toBe("todo");

    const start = await app.inject({ method: "POST", url: `/issues/${issue.id}/start` });
    expect(start.statusCode).toBe(200);
    expect(start.json().status).toBe("in_progress");

    const complete = await app.inject({ method: "POST", url: `/issues/${issue.id}/complete` });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().status).toBe("done");

    const state = await app.inject({ method: "GET", url: `/projects/${project.id}/state` });
    expect(state.statusCode).toBe(200);
    expect(state.json().metrics.completedIssues).toBe(1);
  });

  it("returns 404 with a structured error for a missing project", async () => {
    const res = await app.inject({ method: "GET", url: "/projects/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("returns 400 with a validation error for an invalid project payload", async () => {
    const res = await app.inject({ method: "POST", url: "/projects", payload: { name: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("computes a dependency risk once both issues are in the active sprint", async () => {
    const project = (
      await app.inject({ method: "POST", url: "/projects", payload: { name: "Risk Project", key: "RSK" } })
    ).json();
    const sprint = (
      await app.inject({ method: "POST", url: "/sprints", payload: { projectId: project.id, name: "Sprint 1" } })
    ).json();
    await app.inject({ method: "POST", url: `/sprints/${sprint.id}/start` });

    const blocker = (
      await app.inject({
        method: "POST",
        url: "/issues",
        payload: { projectId: project.id, title: "Blocker", status: "in_progress", sprintId: sprint.id },
      })
    ).json();
    const blocked = (
      await app.inject({
        method: "POST",
        url: "/issues",
        payload: { projectId: project.id, title: "Blocked", status: "todo", sprintId: sprint.id },
      })
    ).json();

    await app.inject({
      method: "POST",
      url: `/issues/${blocked.id}/dependencies`,
      payload: { dependsOnIssueId: blocker.id },
    });

    const risks = await app.inject({ method: "GET", url: `/projects/${project.id}/risks` });
    expect(risks.statusCode).toBe(200);
    const riskList = risks.json();
    expect(riskList.some((r: { type: string }) => r.type === "dependency")).toBe(true);
  });
});
