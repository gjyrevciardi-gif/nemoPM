import type { FastifyInstance } from "fastify";
import { getDb, activitiesRepo } from "@ai-pm/database";
import { planDomain } from "@ai-pm/domain";
import { AIUnavailableError } from "@ai-pm/ai";
import {
  AiStatusRequestSchema,
  ApiError,
  ConfirmPlanInputSchema,
  PlanTaskRequestSchema,
} from "@ai-pm/shared";
import { parseOrThrow } from "../lib/errors.js";
import { buildProjectState } from "../lib/state.js";
import { generateAiStatus, generatePlanTask } from "../lib/ai.js";
import {makeRoutingDecision} from "../lib/project-mode.js";
import {buildDeterministicFallback} from "../lib/deterministic-fallback.js";

export async function aiRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/ai/status", async (req) => {
    const input = parseOrThrow(AiStatusRequestSchema, req.body ?? {});
    const state = await buildProjectState(db, req.params.projectId);
    const routed=await makeRoutingDecision(db,req.params.projectId,input.question??"What is the current status of this project?");
    const fallback=buildDeterministicFallback({db,projectId:req.params.projectId,routing:routed.decision,state});
    const result = await generateAiStatus(state, input.question,fallback);

    activitiesRepo.recordActivity(db, {
      projectId: req.params.projectId,
      type: "ai.status_requested",
      payload: { source: result.source, model: result.model },
    });

    return {
      text: result.text,
      source: result.source,
      model: result.model,
      generatedAt: new Date().toISOString(),
    };
  });

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/ai/plan-task", async (req) => {
    const input = parseOrThrow(PlanTaskRequestSchema, req.body);
    const state = await buildProjectState(db, req.params.projectId);

    try {
      const plan = await generatePlanTask(state, input.request);
      activitiesRepo.recordActivity(db, {
        projectId: req.params.projectId,
        type: "ai.plan_generated",
        payload: { feature: plan.feature, taskCount: plan.tasks.length },
      });
      return plan;
    } catch (err) {
      if (err instanceof AIUnavailableError) {
        throw new ApiError(
          503,
          "AI_UNAVAILABLE",
          `AI planning requires a running local model and none is available: ${err.message}`,
        );
      }
      throw err;
    }
  });

  // Not part of the minimal literal endpoint list, but required to close the
  // product's "Generate plan -> Preview -> Confirm creation" loop: nothing
  // from a generated plan is ever saved until the user explicitly confirms it.
  // Sprint-assignment decisions live in packages/domain's confirmPlanTask so
  // every caller (this route, and later the agent) behaves identically.
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/ai/plan-task/confirm",
    async (req, reply) => {
      const input = parseOrThrow(ConfirmPlanInputSchema, req.body);
      const result = planDomain.confirmPlanTask(db, req.params.projectId, input);
      reply.status(201).send(result.issues);
    },
  );
}
