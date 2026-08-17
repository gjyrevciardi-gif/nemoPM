import type { FastifyInstance } from "fastify";
import { getDb, activitiesRepo, agentRunsRepo, projectsRepo } from "@ai-pm/database";
import { AIUnavailableError } from "@ai-pm/ai";
import { AgentRequestSchema, ApiError } from "@ai-pm/shared";
import { parseOrThrow, notFound } from "../lib/errors.js";
import { applyAgentRun, rejectAgentRun, runProjectAgent } from "../lib/agent.js";

export async function agentRoutes(app: FastifyInstance) {
  const db = getDb();

  const requireProject = (projectId: string) => {
    if (!projectsRepo.getProject(db, projectId)) throw notFound("Project", projectId);
  };

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/agent", async (req) => {
    requireProject(req.params.projectId);
    const input = parseOrThrow(AgentRequestSchema, req.body);

    try {
      const result = await runProjectAgent(db, req.params.projectId, input.message, {
        codeContext: input.codeContext ?? null,
      });
      activitiesRepo.recordActivity(db, {
        projectId: req.params.projectId,
        type: "ai.agent_run",
        payload: {
          status: result.status,
          appliedCount: result.appliedResults.length,
          proposedCount: result.actions.length,
          toolCallCount: result.toolCalls.length,
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
      requireProject(req.params.projectId);
      const result = applyAgentRun(db, req.params.projectId, req.params.runId);
      activitiesRepo.recordActivity(db, {
        projectId: req.params.projectId,
        type: "ai.agent_run",
        payload: { runId: result.runId, status: result.status, actionCount: result.results.length },
      });
      return result;
    },
  );

  app.post<{ Params: { projectId: string; runId: string } }>(
    "/projects/:projectId/agent/:runId/reject",
    async (req) => {
      requireProject(req.params.projectId);
      const result = rejectAgentRun(db, req.params.projectId, req.params.runId);
      activitiesRepo.recordActivity(db, {
        projectId: req.params.projectId,
        type: "ai.agent_run",
        payload: { runId: result.runId, status: result.status },
      });
      return result;
    },
  );

  // Audit trail: what was asked, which model answered, which tools it called,
  // what was proposed, what a human decided, and what actually changed.
  app.get<{ Params: { projectId: string }; Querystring: { limit?: string } }>(
    "/projects/:projectId/agent/runs",
    async (req) => {
      requireProject(req.params.projectId);
      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
      return agentRunsRepo.listRunsByProject(db, req.params.projectId, limit);
    },
  );

  app.get<{ Params: { projectId: string; runId: string } }>(
    "/projects/:projectId/agent/runs/:runId",
    async (req) => {
      requireProject(req.params.projectId);
      const run = agentRunsRepo.getRun(db, req.params.runId);
      if (!run || run.projectId !== req.params.projectId) throw notFound("Agent run", req.params.runId);
      return run;
    },
  );
}
