import type { FastifyInstance } from "fastify";
import { getDb } from "@ai-pm/database";
import { buildProjectState } from "../lib/state.js";

export async function stateRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/state", async (req) => {
    return buildProjectState(db, req.params.projectId);
  });
}
