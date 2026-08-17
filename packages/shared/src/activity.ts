import { z } from "zod";
import { ActivityTypeSchema } from "./enums.js";

export const ActivitySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  issueId: z.string().nullable(),
  type: ActivityTypeSchema,
  payload: z.record(z.unknown()),
  createdAt: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;
