import type { FastifyInstance } from "fastify";
import { getDb, activitiesRepo, projectsRepo } from "@ai-pm/database";
import { AIUnavailableError } from "@ai-pm/ai";
import { AgentRequestSchema, ApiError } from "@ai-pm/shared";
import { parseOrThrow, notFound } from "../lib/errors.js";
import { applyAgentRun, runProjectAgent } from "../lib/agent.js";

export async function agentRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/agent", async (req) => {
    if (!projectsRepo.getProject(db, req.params.projectId)) throw notFound("Project", req.params.projectId);
    const input = parseOrThrow(AgentRequestSchema, req.body);

    try {
      const result = await runProjectAgent(db, req.params.projectId, input.message);
      activitiesRepo.recordActivity(db, {
        projectId: req.params.projectId,
        type: "ai.agent_run",
        payload: {
          status: result.status,
          appliedCount: result.appliedResults.length,
          proposedCount: result.actions.length,
        },
      });
      return result;
    } catch (err) {
      if (err instanceof AIUnavailableError) {
        throw new ApiError(
          503,
          "AI_UNAVAILABLE",
          `AI PM requires a running local model and none is available: ${err.message}`,
        );
      }
      throw err;
    }
  });

  app.post<{ Params: { projectId: string; runId: string } }>(
    "/projects/:projectId/agent/:runId/apply",
    async (req) => {
      if (!projectsRepo.getProject(db, req.params.projectId)) throw notFound("Project", req.params.projectId);
      const result = applyAgentRun(db, req.params.projectId, req.params.runId);
      activitiesRepo.recordActivity(db, {
        projectId: req.params.projectId,
        type: "ai.agent_run",
        payload: { runId: result.runId, status: result.status, actionCount: result.results.length },
      });
      return result;
    },
  );
}
