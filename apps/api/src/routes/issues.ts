import type { FastifyInstance } from "fastify";
import { getDb, issuesRepo, dependenciesRepo, codeLinksRepo } from "@ai-pm/database";
import {
  AddDependencyInputSchema,
  CreateIssueInputSchema,
  ReorderIssuesInputSchema,
  UpdateIssueInputSchema,
} from "@ai-pm/shared";
import { parseOrThrow, notFound } from "../lib/errors.js";

export async function issueRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post("/issues", async (req, reply) => {
    const input = parseOrThrow(CreateIssueInputSchema, req.body);
    const issue = issuesRepo.createIssue(db, input);
    reply.status(201).send(issue);
  });

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/issues", async (req) => {
    return issuesRepo.listIssuesByProject(db, req.params.projectId);
  });

  app.get<{ Params: { id: string } }>("/issues/:id", async (req) => {
    const issue = issuesRepo.getIssue(db, req.params.id);
    if (!issue) throw notFound("Issue", req.params.id);
    return issue;
  });

  app.patch<{ Params: { id: string } }>("/issues/:id", async (req) => {
    const input = parseOrThrow(UpdateIssueInputSchema, req.body);
    const issue = issuesRepo.updateIssue(db, req.params.id, input);
    if (!issue) throw notFound("Issue", req.params.id);
    return issue;
  });

  app.delete<{ Params: { id: string } }>("/issues/:id", async (req, reply) => {
    const ok = issuesRepo.deleteIssue(db, req.params.id);
    if (!ok) throw notFound("Issue", req.params.id);
    reply.status(204).send();
  });

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/issues/reorder", async (req) => {
    const input = parseOrThrow(ReorderIssuesInputSchema, req.body);
    return issuesRepo.reorderIssues(db, input.updates);
  });

  // -- Workflow actions --------------------------------------------------

  app.post<{ Params: { id: string } }>("/issues/:id/start", async (req) => {
    if (!issuesRepo.getIssue(db, req.params.id)) throw notFound("Issue", req.params.id);
    return issuesRepo.startIssue(db, req.params.id);
  });

  app.post<{ Params: { id: string } }>("/issues/:id/review", async (req) => {
    if (!issuesRepo.getIssue(db, req.params.id)) throw notFound("Issue", req.params.id);
    return issuesRepo.reviewIssue(db, req.params.id);
  });

  app.post<{ Params: { id: string } }>("/issues/:id/complete", async (req) => {
    if (!issuesRepo.getIssue(db, req.params.id)) throw notFound("Issue", req.params.id);
    return issuesRepo.completeIssue(db, req.params.id);
  });

  // -- Dependencies --------------------------------------------------------

  app.post<{ Params: { id: string } }>("/issues/:id/dependencies", async (req, reply) => {
    const input = parseOrThrow(AddDependencyInputSchema, req.body);
    const dep = dependenciesRepo.addDependency(db, req.params.id, input.dependsOnIssueId);
    reply.status(201).send(dep);
  });

  app.get<{ Params: { id: string } }>("/issues/:id/dependencies", async (req) => {
    return dependenciesRepo.listDependencies(db, req.params.id);
  });

  app.delete<{ Params: { id: string; dependencyId: string } }>(
    "/issues/:id/dependencies/:dependencyId",
    async (req, reply) => {
      const ok = dependenciesRepo.removeDependency(db, req.params.id, req.params.dependencyId);
      if (!ok) throw notFound("Dependency", req.params.dependencyId);
      reply.status(204).send();
    },
  );

  // -- Extra: Git activity linked to an issue (used by the issue detail view) --

  app.get<{ Params: { id: string } }>("/issues/:id/code-links", async (req) => {
    return codeLinksRepo.listCodeLinksForIssue(db, req.params.id);
  });
}
