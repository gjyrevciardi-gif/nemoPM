import type { FastifyInstance } from "fastify";
import { getDb, projectsRepo, repositoriesRepo } from "@ai-pm/database";
import { notFound } from "../lib/errors.js";
import { getGitStatus } from "../lib/git.js";
import { scanGitActivity } from "../lib/git-scan.js";

export async function gitRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/git/status", async (req) => {
    const project = projectsRepo.getProject(db, req.params.projectId);
    if (!project) throw notFound("Project", req.params.projectId);

    const repo = repositoriesRepo.getRepositoryByProject(db, req.params.projectId);
    return getGitStatus(repo?.path ?? project.repositoryPath ?? null);
  });

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/git/scan", async (req) => {
    if (!projectsRepo.getProject(db, req.params.projectId)) throw notFound("Project", req.params.projectId);
    return scanGitActivity(db, req.params.projectId);
  });
}
