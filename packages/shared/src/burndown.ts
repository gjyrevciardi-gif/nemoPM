import { z } from "zod";

export const BurndownPointSchema = z.object({
  date: z.string(),
  remainingPoints: z.number(),
  completedPoints: z.number(),
});
export type BurndownPoint = z.infer<typeof BurndownPointSchema>;

export const SprintBurndownSchema = z.object({
  sprintId: z.string(),
  totalPoints: z.number(),
  points: z.array(BurndownPointSchema),
});
export type SprintBurndown = z.infer<typeof SprintBurndownSchema>;
