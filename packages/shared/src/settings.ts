import { z } from "zod";

export const RiskThresholdsSchema = z.object({
  /** A task in progress with no activity for this many days is a medium risk. */
  staleMediumDays: z.number().positive(),
  /** A task in progress with no activity for this many days is a high risk. */
  staleHighDays: z.number().positive(),
  /** Minimum days a sprint must be active before a "no progress" risk can fire. */
  sprintMinDaysBeforeFlag: z.number().nonnegative(),
  /**
   * If, at the current completion pace, finishing the remaining points would take
   * more than this multiple of the time already spent, the sprint is flagged as
   * overloaded relative to its observed pace.
   */
  sprintPaceRatioThreshold: z.number().positive(),
});
export type RiskThresholds = z.infer<typeof RiskThresholdsSchema>;

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  staleMediumDays: 2,
  staleHighDays: 5,
  sprintMinDaysBeforeFlag: 2,
  sprintPaceRatioThreshold: 1.5,
};

export const UpdateRiskThresholdsInputSchema = RiskThresholdsSchema.partial();
export type UpdateRiskThresholdsInput = z.infer<typeof UpdateRiskThresholdsInputSchema>;
