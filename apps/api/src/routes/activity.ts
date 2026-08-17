import type { FastifyInstance } from "fastify";
import { getDb, activitiesRepo } from "@ai-pm/database";

export async function activityRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get<{ Params: { projectId: string }; Querystring: { limit?: string; issueId?: string } }>(
    "/projects/:projectId/activity",
    async (req) => {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      const safeLimit = Number.isFinite(limit) ? limit : 100;
      if (req.query.issueId) {
        return activitiesRepo.listActivityByIssue(db, req.query.issueId, safeLimit);
      }
      return activitiesRepo.listActivityByProject(db, req.params.projectId, safeLimit);
    },
  );
}
