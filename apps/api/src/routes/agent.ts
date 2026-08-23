import type { FastifyInstance } from "fastify";
import { getDb, activitiesRepo, agentRunsRepo, projectsRepo,learningRepo } from "@ai-pm/database";
import { AIUnavailableError } from "@ai-pm/ai";
import { AgentRequestSchema, ApiError } from "@ai-pm/shared";
import { parseOrThrow, notFound } from "../lib/errors.js";
import { applyAgentRun, rejectAgentRun, runProjectAgent } from "../lib/agent.js";
import {ProjectModeSchema,FailureCategorySchema,TrainingProvenanceSchema,TrainingReviewStatusSchema,RoutingDecisionSchema} from "@ai-pm/shared";
import {z} from "zod";
import {collectModeFeatures,detectProjectMode} from "../lib/project-mode.js";

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
          modelCalls:result.runtime?.modelCalls??null,
          toolsOffered:result.runtime?.toolsOffered??[],
          route:result.runtime?.route??null,
          routingConfidence:result.runtime?.routingConfidence??null,
          projectMode:result.runtime?.projectMode??null,intent:result.runtime?.intent??null,capabilities:result.runtime?.capabilities??[],contextSources:result.runtime?.contextSources??[],agentSteps:result.runtime?.agentSteps??0,
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

  app.get<{Params:{projectId:string}}>("/projects/:projectId/agent/mode",async req=>{requireProject(req.params.projectId);const features=collectModeFeatures(db,req.params.projectId);const detected=detectProjectMode(features);return{persisted:learningRepo.getProjectMode(db,req.params.projectId),detected,features,events:learningRepo.listModeEvents(db,req.params.projectId)};});
  app.put<{Params:{projectId:string}}>("/projects/:projectId/agent/mode",async req=>{requireProject(req.params.projectId);const body=z.object({mode:ProjectModeSchema,reason:z.string().min(1).max(500)}).parse(req.body);return learningRepo.setProjectMode(db,req.params.projectId,body.mode,"USER_OVERRIDE",body.reason,{userOverride:true});});
  const FeedbackSchema=z.object({message:z.string().min(1).max(8000),stateSummary:z.record(z.unknown()).default({}),modeEvidence:z.record(z.unknown()).default({}),routerDecision:RoutingDecisionSchema,toolsOffered:z.array(z.string()).default([]),toolsSelected:z.array(z.string()).default([]),actualBehavior:z.string().max(8000).optional(),expectedMode:ProjectModeSchema,expectedIntent:z.string(),expectedCapabilities:z.array(z.string()),expectedTools:z.array(z.string()).default([]),forbidden:z.array(z.string()).default([]),failureCategory:FailureCategorySchema,correctionSource:TrainingProvenanceSchema.default("REAL_USER_CORRECTION"),reviewStatus:TrainingReviewStatusSchema.default("UNREVIEWED")});
  app.post<{Params:{projectId:string}}>("/projects/:projectId/agent/feedback",async req=>{requireProject(req.params.projectId);const body=FeedbackSchema.parse(req.body);const id=learningRepo.recordLearningExample(db,{projectId:req.params.projectId,...body});return{id,reviewStatus:body.reviewStatus};});
  app.put<{Params:{projectId:string;exampleId:string}}>("/projects/:projectId/agent/feedback/:exampleId/review",async req=>{requireProject(req.params.projectId);const{status}=z.object({status:z.enum(["APPROVED","REJECTED"])}).parse(req.body);if(!learningRepo.reviewLearningExample(db,req.params.projectId,req.params.exampleId,status))throw notFound("Learning example",req.params.exampleId);return{id:req.params.exampleId,status};});
  app.get<{Params:{projectId:string}}>("/projects/:projectId/agent/training-export",async req=>{requireProject(req.params.projectId);return{version:1,examples:learningRepo.exportApprovedTrainingData(db,req.params.projectId),stats:learningRepo.learningStats(db),privacy:"absolute paths, secrets, tokens, passwords, and source-like fields are removed"};});
}
