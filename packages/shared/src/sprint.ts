import { z } from "zod";
import { SprintStatusSchema } from "./enums.js";

export const SprintSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  goal: z.string().nullable(),
  status: SprintStatusSchema,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Sprint = z.infer<typeof SprintSchema>;

export const CreateSprintInputSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(200),
  goal: z.string().max(2000).optional(),
});
export type CreateSprintInput = z.infer<typeof CreateSprintInputSchema>;
