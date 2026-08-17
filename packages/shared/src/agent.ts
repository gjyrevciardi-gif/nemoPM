import { z } from "zod";

export const PermissionTierSchema = z.enum(["auto", "ask"]);
export type PermissionTier = z.infer<typeof PermissionTierSchema>;

export const AgentActionSchema = z.object({
  tool: z.string(),
  args: z.record(z.unknown()),
  description: z.string(),
});
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const AgentActionResultSchema = z.object({
  tool: z.string(),
  description: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type AgentActionResult = z.infer<typeof AgentActionResultSchema>;

export const AgentRequestSchema = z.object({
  message: z.string().min(1, "Say what you want AI PM to do").max(8000),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;

export const AgentResponseSchema = z.object({
  runId: z.string().nullable(),
  reply: z.string(),
  /** Actions proposed but not yet applied -- present only when status is "proposed". */
  actions: z.array(AgentActionSchema),
  /** Actions already executed automatically during this turn. */
  appliedResults: z.array(AgentActionResultSchema),
  status: z.enum(["proposed", "done"]),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

export const AgentApplyResponseSchema = z.object({
  runId: z.string(),
  status: z.enum(["applied", "failed"]),
  results: z.array(AgentActionResultSchema),
});
export type AgentApplyResponse = z.infer<typeof AgentApplyResponseSchema>;
