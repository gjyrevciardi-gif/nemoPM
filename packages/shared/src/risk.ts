import { z } from "zod";
import { RiskTypeSchema, RiskSeveritySchema, RiskStatusSchema } from "./enums.js";

export const RiskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  issueId: z.string().nullable(),
  type: RiskTypeSchema,
  severity: RiskSeveritySchema,
  status: RiskStatusSchema,
  message: z.string(),
  evidence: z.array(z.string()),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type Risk = z.infer<typeof RiskSchema>;

// A risk as freshly computed by the deterministic risk engine, before
// being reconciled against what is already stored in the database.
export const ComputedRiskSchema = z.object({
  type: RiskTypeSchema,
  severity: RiskSeveritySchema,
  issueId: z.string().nullable(),
  message: z.string(),
  evidence: z.array(z.string()),
  // A stable key used to match this computed risk against previously
  // stored risks so we don't create duplicate rows every scan.
  dedupeKey: z.string(),
});
export type ComputedRisk = z.infer<typeof ComputedRiskSchema>;
