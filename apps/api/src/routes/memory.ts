import type { FastifyInstance } from "fastify";
import { getDb, projectsRepo } from "@ai-pm/database";
import { memoryDomain } from "@ai-pm/domain";
import {
  CreateDecisionInputSchema,
  CreateMilestoneInputSchema,
  CreateProjectNoteInputSchema,
  MilestoneStatusSchema,
  ApiError,
} from "@ai-pm/shared";
import { z } from "zod";
import { parseOrThrow, notFound } from "../lib/errors.js";

const UpdateDecisionSchema = CreateDecisionInputSchema.partial();

const UpdateMilestoneSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(4000).nullable().optional(),
  status: MilestoneStatusSchema.optional(),
  occurredAt: z.string().optional(),
});

/**
 * Project memory as a first-class surface: the decisions and milestones the
 * agent can write have to be readable, editable and deletable by a human, or
 * they are just model exhaust.
 *
 * Routes are thin -- every mutation goes through the domain layer, the same
 * one the agent's tools use, so both paths enforce the same rules.
 */
export async function memoryRoutes(app: FastifyInstance) {
  const db = getDb();

  const requireProject = (projectId: string) => {
    if (!projectsRepo.getProject(db, projectId)) throw notFound("Project", projectId);
  };

  /** Memory belongs to exactly one project; an id from another is a 404 here. */
  const requireDecisionInProject = (projectId: string, decisionId: string) => {
    const decision = memoryDomain.getDecision(db, decisionId);
    if (!decision || decision.projectId !== projectId) throw notFound("Decision", decisionId);
    return decision;
  };

  const requireMilestoneInProject = (projectId: string, milestoneId: string) => {
    const milestone = memoryDomain.getMilestone(db, milestoneId);
    if (!milestone || milestone.projectId !== projectId) throw notFound("Milestone", milestoneId);
    return milestone;
  };

  // -- decisions -------------------------------------------------------------

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/decisions", async (req) => {
    requireProject(req.params.projectId);
    return memoryDomain.listDecisionsByProject(db, req.params.projectId);
  });

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/decisions", async (req, reply) => {
    requireProject(req.params.projectId);
    const input = parseOrThrow(CreateDecisionInputSchema, req.body);
    reply.status(201);
    return memoryDomain.createDecision(db, req.params.projectId, input);
  });

  app.get<{ Params: { projectId: string; decisionId: string } }>(
    "/projects/:projectId/decisions/:decisionId",
    async (req) => {
      requireProject(req.params.projectId);
      return requireDecisionInProject(req.params.projectId, req.params.decisionId);
    },
  );

  app.patch<{ Params: { projectId: string; decisionId: string } }>(
    "/projects/:projectId/decisions/:decisionId",
    async (req) => {
      requireProject(req.params.projectId);
      requireDecisionInProject(req.params.projectId, req.params.decisionId);
      const input = parseOrThrow(UpdateDecisionSchema, req.body);
      return memoryDomain.updateDecision(db, req.params.decisionId, input);
    },
  );

  app.delete<{ Params: { projectId: string; decisionId: string } }>(
    "/projects/:projectId/decisions/:decisionId",
    async (req, reply) => {
      requireProject(req.params.projectId);
      requireDecisionInProject(req.params.projectId, req.params.decisionId);
      memoryDomain.deleteDecision(db, req.params.decisionId);
      reply.status(204);
    },
  );

  // -- milestones ------------------------------------------------------------

  app.get<{ Params: { projectId: string }; Querystring: { includeUnconfirmed?: string } }>(
    "/projects/:projectId/milestones",
    async (req) => {
      requireProject(req.params.projectId);
      return memoryDomain.listMilestonesByProject(db, req.params.projectId, {
        includeUnconfirmed: req.query.includeUnconfirmed === "true",
      });
    },
  );

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/milestones", async (req, reply) => {
    requireProject(req.params.projectId);
    const input = parseOrThrow(CreateMilestoneInputSchema, req.body);
    reply.status(201);
    // A milestone a human creates here is confirmed history by definition.
    return memoryDomain.createMilestone(db, req.params.projectId, { ...input, source: "manual" });
  });

  app.patch<{ Params: { projectId: string; milestoneId: string } }>(
    "/projects/:projectId/milestones/:milestoneId",
    async (req) => {
      requireProject(req.params.projectId);
      requireMilestoneInProject(req.params.projectId, req.params.milestoneId);
      const input = parseOrThrow(UpdateMilestoneSchema, req.body);
      return memoryDomain.updateMilestone(db, req.params.milestoneId, input);
    },
  );

  app.post<{ Params: { projectId: string; milestoneId: string } }>(
    "/projects/:projectId/milestones/:milestoneId/complete",
    async (req) => {
      requireProject(req.params.projectId);
      const milestone = requireMilestoneInProject(req.params.projectId, req.params.milestoneId);
      if (milestone.status === "reached") {
        throw new ApiError(409, "ALREADY_REACHED", `Milestone "${milestone.title}" is already reached.`);
      }
      return memoryDomain.completeMilestone(db, req.params.milestoneId);
    },
  );

  /** Promotes an AI-suggested milestone into official history. */
  app.post<{ Params: { projectId: string; milestoneId: string } }>(
    "/projects/:projectId/milestones/:milestoneId/confirm",
    async (req) => {
      requireProject(req.params.projectId);
      requireMilestoneInProject(req.params.projectId, req.params.milestoneId);
      return memoryDomain.confirmMilestone(db, req.params.milestoneId);
    },
  );

  app.delete<{ Params: { projectId: string; milestoneId: string } }>(
    "/projects/:projectId/milestones/:milestoneId",
    async (req, reply) => {
      requireProject(req.params.projectId);
      requireMilestoneInProject(req.params.projectId, req.params.milestoneId);
      memoryDomain.deleteMilestone(db, req.params.milestoneId);
      reply.status(204);
    },
  );

  // -- notes -----------------------------------------------------------------

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/notes", async (req) => {
    requireProject(req.params.projectId);
    return memoryDomain.listNotesByProject(db, req.params.projectId);
  });

  app.post<{ Params: { projectId: string } }>("/projects/:projectId/notes", async (req, reply) => {
    requireProject(req.params.projectId);
    const input = parseOrThrow(CreateProjectNoteInputSchema, req.body);
    reply.status(201);
    return memoryDomain.createNote(db, req.params.projectId, input.note);
  });
}
