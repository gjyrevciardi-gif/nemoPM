import type { FastifyInstance } from "fastify";
import { getDb, projectsRepo } from "@ai-pm/database";
import { CreateProjectInputSchema, UpdateProjectInputSchema } from "@ai-pm/shared";
import { parseOrThrow, notFound } from "../lib/errors.js";

export async function projectRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post("/projects", async (req, reply) => {
    const input = parseOrThrow(CreateProjectInputSchema, req.body);
    const project = projectsRepo.createProject(db, input);
    reply.status(201).send(project);
  });

  app.get("/projects", async () => {
    return projectsRepo.listProjects(db);
  });

  app.get<{ Params: { id: string } }>("/projects/:id", async (req) => {
    const project = projectsRepo.getProject(db, req.params.id);
    if (!project) throw notFound("Project", req.params.id);
    return project;
  });

  app.patch<{ Params: { id: string } }>("/projects/:id", async (req) => {
    const input = parseOrThrow(UpdateProjectInputSchema, req.body);
    const project = projectsRepo.updateProject(db, req.params.id, input);
    if (!project) throw notFound("Project", req.params.id);
    return project;
  });

  app.delete<{ Params: { id: string } }>("/projects/:id", async (req, reply) => {
    const ok = projectsRepo.deleteProject(db, req.params.id);
    if (!ok) throw notFound("Project", req.params.id);
    reply.status(204).send();
  });
}
