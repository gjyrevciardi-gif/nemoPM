import { z } from "zod";

/**
 * Project memory: the "why" that code and issues never record.
 *
 * A decision is the answer to "why is it built this way?", written down when
 * it's made so nobody -- human or model -- has to reconstruct it later from
 * guesswork. NEMO answers such questions from these rows or not at all.
 */
export const DecisionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  issueId: z.string().nullable(),
  milestoneId: z.string().nullable(),
  title: z.string(),
  /** The situation that forced a choice. */
  context: z.string().nullable(),
  /** What was chosen. */
  decision: z.string().nullable(),
  /** Why this option won. */
  rationale: z.string().nullable(),
  decidedAt: z.string(),
  createdAt: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

export const CreateDecisionInputSchema = z.object({
  title: z.string().min(1, "A decision needs a title").max(300),
  context: z.string().max(4000).optional(),
  decision: z.string().max(4000).optional(),
  rationale: z.string().max(4000).optional(),
  issueId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  decidedAt: z.string().optional(),
});
export type CreateDecisionInput = z.infer<typeof CreateDecisionInputSchema>;

export const MilestoneStatusSchema = z.enum(["planned", "reached"]);
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>;

/**
 * A phase or release worth remembering. `source: "inferred"` marks something
 * NEMO suggested from Git or activity -- it stays unconfirmed, and therefore
 * out of the official history, until a human confirms it.
 */
export const MilestoneSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: MilestoneStatusSchema,
  source: z.enum(["manual", "inferred"]),
  confirmed: z.boolean(),
  occurredAt: z.string(),
  createdAt: z.string(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const CreateMilestoneInputSchema = z.object({
  title: z.string().min(1, "A milestone needs a title").max(300),
  description: z.string().max(4000).optional(),
  status: MilestoneStatusSchema.optional(),
  source: z.enum(["manual", "inferred"]).optional(),
  confirmed: z.boolean().optional(),
  occurredAt: z.string().optional(),
});
export type CreateMilestoneInput = z.infer<typeof CreateMilestoneInputSchema>;

export const ProjectNoteSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  note: z.string(),
  createdAt: z.string(),
});
export type ProjectNote = z.infer<typeof ProjectNoteSchema>;

export const CreateProjectNoteInputSchema = z.object({
  note: z.string().min(1, "A note needs text").max(4000),
});
export type CreateProjectNoteInput = z.infer<typeof CreateProjectNoteInputSchema>;
