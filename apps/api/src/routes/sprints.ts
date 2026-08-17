import type { FastifyInstance } from "fastify";
import { getDb } from "@ai-pm/database";
import { issuesDomain, sprintsDomain } from "@ai-pm/domain";
import { CreateSprintInputSchema } from "@ai-pm/shared";
import { computeBurndown } from "@ai-pm/project-state";
import { parseOrThrow, notFound } from "../lib/errors.js";

export async function sprintRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post("/sprints", async (req, reply) => {
    const input = parseOrThrow(CreateSprintInputSchema, req.body);
    const sprint = sprintsDomain.createSprint(db, input);
    reply.status(201).send(sprint);
  });

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/sprints", async (req) => {
    return sprintsDomain.listSprintsByProject(db, req.params.projectId);
  });

  app.post<{ Params: { id: string } }>("/sprints/:id/start", async (req) => {
    if (!sprintsDomain.getSprint(db, req.params.id)) throw notFound("Sprint", req.params.id);
    return sprintsDomain.startSprint(db, req.params.id);
  });

  app.post<{ Params: { id: string } }>("/sprints/:id/complete", async (req) => {
    if (!sprintsDomain.getSprint(db, req.params.id)) throw notFound("Sprint", req.params.id);
    return sprintsDomain.completeSprint(db, req.params.id);
  });

  app.get<{ Params: { id: string } }>("/sprints/:id/burndown", async (req) => {
    const sprint = sprintsDomain.getSprint(db, req.params.id);
    if (!sprint) throw notFound("Sprint", req.params.id);
    const issues = issuesDomain.listIssuesBySprint(db, sprint.id);
    return computeBurndown(sprint, issues, new Date());
  });
}
