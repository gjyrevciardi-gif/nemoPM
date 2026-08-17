import { z } from "zod";
import { IssueTypeSchema, PrioritySchema } from "./enums.js";

export const AiStatusRequestSchema = z.object({
  question: z.string().max(8000).optional(),
});
export type AiStatusRequest = z.infer<typeof AiStatusRequestSchema>;

export const AiStatusResponseSchema = z.object({
  text: z.string(),
  source: z.enum(["ai", "fallback"]),
  model: z.string().nullable(),
  generatedAt: z.string(),
});
export type AiStatusResponse = z.infer<typeof AiStatusResponseSchema>;

export const PlanTaskRequestSchema = z.object({
  request: z.string().min(3, "Describe the feature or change you want a plan for").max(8000),
});
export type PlanTaskRequest = z.infer<typeof PlanTaskRequestSchema>;

export const PlanTaskItemSchema = z.object({
  title: z.string().min(1).max(200),
  type: IssueTypeSchema,
  description: z.string().max(2000),
  storyPoints: z.number().min(0).max(21),
  priority: PrioritySchema,
});
export type PlanTaskItem = z.infer<typeof PlanTaskItemSchema>;

export const PlanTaskResponseSchema = z.object({
  feature: z.string().min(1).max(200),
  summary: z.string().max(2000),
  tasks: z.array(PlanTaskItemSchema).min(1).max(12),
  risks: z.array(z.string()).max(10),
  dependencies: z.array(z.string()).max(10),
});
export type PlanTaskResponse = z.infer<typeof PlanTaskResponseSchema>;

export const ConfirmPlanInputSchema = z.object({
  sprintId: z.string().nullable().optional(),
  tasks: z.array(PlanTaskItemSchema).min(1).max(12),
  feature: z.string().max(200).optional(),
  /**
   * When true and `sprintId` is omitted, use the active sprint if one
   * exists, otherwise create and start a new sprint named after `feature`.
   * Ignored if `sprintId` is explicitly provided (including `null`, which
   * always means "leave in backlog").
   */
  autoSprint: z.boolean().optional(),
});
export type ConfirmPlanInput = z.infer<typeof ConfirmPlanInputSchema>;
