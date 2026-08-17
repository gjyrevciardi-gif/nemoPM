import type { FastifyInstance } from "fastify";
import { getDb, risksRepo } from "@ai-pm/database";
import { buildProjectState } from "../lib/state.js";

export async function riskRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/risks", async (req) => {
    // Recompute state first so risks reflect the latest issues/dependencies/git
    // info rather than whatever was last reconciled by an earlier request.
    await buildProjectState(db, req.params.projectId);
    return risksRepo.listOpenRisksByProject(db, req.params.projectId);
  });
}
