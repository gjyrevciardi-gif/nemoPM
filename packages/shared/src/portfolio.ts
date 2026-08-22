import { z } from "zod";

/**
 * One project, summarized enough for a portfolio card or a cross-project
 * question, and small enough that every project in the portfolio can fit in
 * one prompt. Anything deeper is a per-project read.
 */
export const ProjectSummarySchema = z.object({
  projectId: z.string(),
  key: z.string(),
  name: z.string(),
  activeSprint: z
    .object({
      id: z.string(),
      name: z.string(),
      totalPoints: z.number(),
      completedPoints: z.number(),
      remainingPoints: z.number(),
      startedAt: z.string().nullable(),
    })
    .nullable(),
  totalIssues: z.number(),
  openIssues: z.number(),
  doneIssues: z.number(),
  inProgressIssues: z.number(),
  /** Completed points over total points, 0-100; falls back to issue counts when nothing is estimated. */
  progressPercent: z.number(),
  repositoryConnected: z.boolean(),
  /** Issues that can't start because something they depend on isn't done. */
  blockedIssues: z.number(),
  risks: z.object({ high: z.number(), medium: z.number(), low: z.number() }),
  /** Average completed points across recent completed sprints; null with no history. */
  velocity: z.number().nullable(),
  staleInProgressIssues: z.number(),
  lastActivityAt: z.string().nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const PortfolioStateSchema = z.object({
  generatedAt: z.string(),
  projects: z.array(ProjectSummarySchema),
});
export type PortfolioState = z.infer<typeof PortfolioStateSchema>;
