import type { FastifyInstance } from "fastify";
import { getDb, activitiesRepo, decisionsRepo, issuesRepo } from "@ai-pm/database";
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

export async function aiRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/ai/status", async (req) => {
    const input = parseOrThrow(AiStatusRequestSchema, req.body ?? {});
    const state = await buildProjectState(db, req.params.projectId);
    const result = await generateAiStatus(state, input.question);

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
  app.post<{ Params: { projectId: string } }>(
    "/projects/:projectId/ai/plan-task/confirm",
    async (req, reply) => {
      const input = parseOrThrow(ConfirmPlanInputSchema, req.body);

      const created = input.tasks.map((task) =>
        issuesRepo.createIssue(db, {
          projectId: req.params.projectId,
          type: task.type,
          title: task.title,
          description: task.description,
          status: "backlog",
          priority: task.priority,
          storyPoints: task.storyPoints,
          sprintId: input.sprintId ?? null,
        }),
      );

      decisionsRepo.createDecision(db, {
        projectId: req.params.projectId,
        title: `Confirmed AI plan: ${input.feature ?? "Untitled feature"}`,
        description: `Created ${created.length} issue(s): ${created.map((i) => i.key).join(", ")}`,
      });

      reply.status(201).send(created);
    },
  );
}
