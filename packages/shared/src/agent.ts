import { z } from "zod";
import { CodeContextSchema } from "./code-context.js";

/**
 * How much authority a tool carries.
 *
 * auto    -- executes during the turn; cheap, additive, reversible by hand.
 * ask     -- only ever previewed, then executed by an explicit human approval.
 * blocked -- never callable by a model, at any tier, for any reason.
 */
export const PermissionTierSchema = z.enum(["auto", "ask", "blocked"]);
export type PermissionTier = z.infer<typeof PermissionTierSchema>;

export const AgentActionSchema = z.object({
  tool: z.string(),
  args: z.record(z.unknown()),
  description: z.string(),
  /**
   * Project the action targets. Always set for portfolio runs, where a single
   * plan may reach into a project the run itself isn't scoped to; null on
   * project runs, where the run's own project is the only possible target.
   */
  projectId: z.string().nullable().default(null),
});
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const AgentActionResultSchema = z.object({
  tool: z.string(),
  description: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type AgentActionResult = z.infer<typeof AgentActionResultSchema>;

/** One tool the model actually called this turn -- the run's audit trail. */
export const AgentToolCallRecordSchema = z.object({
  name: z.string(),
  args: z.record(z.unknown()),
  kind: z.enum(["read", "write"]),
  tier: PermissionTierSchema,
  ok: z.boolean(),
  summary: z.string(),
});
export type AgentToolCallRecord = z.infer<typeof AgentToolCallRecordSchema>;

/**
 * The facts behind a proposal. Computed from the database, never written by
 * the model, so an approval screen can't be talked into a number.
 */
export const AgentPlanSchema = z.object({
  goal: z.string(),
  /** Story points the plan would put into a sprint, when it touches sprint scope. */
  points: z.number().nullable(),
  evidence: z.array(z.string()),
  risks: z.array(z.string()),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export const AgentRunStatusSchema = z.enum(["proposed", "applied", "rejected", "failed", "expired"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export const AgentRequestSchema = z.object({
  message: z.string().min(1, "Say what you want AI PM to do").max(8000),
  /** Optional editor context from the VS Code extension. */
  codeContext: CodeContextSchema.nullable().optional(),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

export const AgentResponseSchema = z.object({
  runId: z.string().nullable(),
  reply: z.string(),
  /** Actions proposed but not yet applied -- present only when status is "proposed". */
  actions: z.array(AgentActionSchema),
  /** Actions already executed automatically during this turn. */
  appliedResults: z.array(AgentActionResultSchema),
  /** Evidence behind a proposal; null when the turn proposed nothing. */
  plan: AgentPlanSchema.nullable().default(null),
  toolCalls: z.array(AgentToolCallRecordSchema).default([]),
  status: z.enum(["proposed", "done"]),
  runtime: z.object({ modelCalls:z.number().int().min(0), toolsOffered:z.array(z.string()), route:z.string(), routingConfidence:z.number().min(0).max(1),projectMode:z.string().optional(),intent:z.string().optional(),capabilities:z.array(z.string()).optional(),repositoryContext:z.boolean().optional(),codeContext:z.boolean().optional(),contextSources:z.array(z.string()).optional(),agentSteps:z.number().optional(),debug:z.object({responseContract:z.string(),agentPath:z.string(),endpoint:z.string(),systemPromptSections:z.array(z.string()),contextSources:z.array(z.string()),repositoryStateAttached:z.boolean(),codeContextAttached:z.boolean(),rawModelResponse:z.string(),finalRenderedResponse:z.string(),contractViolation:z.boolean()}).optional() }).optional(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export const AgentApplyResponseSchema = z.object({
  runId: z.string(),
  /** "failed" means nothing was applied -- the whole plan rolled back. */
  status: z.enum(["applied", "failed"]),
  results: z.array(AgentActionResultSchema),
});
export type AgentApplyResponse = z.infer<typeof AgentApplyResponseSchema>;

export const AgentRunSummarySchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  scope: z.enum(["project", "portfolio"]),
  requestText: z.string(),
  status: AgentRunStatusSchema,
  actions: z.array(AgentActionSchema),
  results: z.array(AgentActionResultSchema),
  toolCalls: z.array(AgentToolCallRecordSchema),
  plan: AgentPlanSchema.nullable(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type AgentRunSummary = z.infer<typeof AgentRunSummarySchema>;
