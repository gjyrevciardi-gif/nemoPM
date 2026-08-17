import type { FastifyInstance } from "fastify";
import { getDb } from "@ai-pm/database";
import { projectsDomain } from "@ai-pm/domain";
import { CreateProjectInputSchema, UpdateProjectInputSchema } from "@ai-pm/shared";
import { parseOrThrow, notFound } from "../lib/errors.js";

export async function projectRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post("/projects", async (req, reply) => {
    const input = parseOrThrow(CreateProjectInputSchema, req.body);
    const project = projectsDomain.createProject(db, input);
    reply.status(201).send(project);
  });

  app.get("/projects", async () => {
    return projectsDomain.listProjects(db);
  });

  app.get<{ Params: { id: string } }>("/projects/:id", async (req) => {
    const project = projectsDomain.getProject(db, req.params.id);
    if (!project) throw notFound("Project", req.params.id);
    return project;
  });

  app.patch<{ Params: { id: string } }>("/projects/:id", async (req) => {
    const input = parseOrThrow(UpdateProjectInputSchema, req.body);
    const project = projectsDomain.updateProject(db, req.params.id, input);
    if (!project) throw notFound("Project", req.params.id);
    return project;
  });

  app.delete<{ Params: { id: string } }>("/projects/:id", async (req, reply) => {
    const ok = projectsDomain.deleteProject(db, req.params.id);
    if (!ok) throw notFound("Project", req.params.id);
    reply.status(204).send();
  });
}
