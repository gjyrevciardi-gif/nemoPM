import { z } from "zod";
import { ProjectSchema } from "./project.js";
import { IssueSchema } from "./issue.js";
import { SprintSchema } from "./sprint.js";
import { GitStatusSchema } from "./git.js";
import { RiskSchema } from "./risk.js";

export const DependencyStatusSchema = z.object({
  issueId: z.string(),
  issueKey: z.string(),
  issueTitle: z.string(),
  dependsOnIssueId: z.string(),
  dependsOnKey: z.string(),
  dependsOnTitle: z.string(),
  dependsOnStatus: z.string(),
  satisfied: z.boolean(),
});
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;

export const StaleIssueSchema = z.object({
  issueId: z.string(),
  issueKey: z.string(),
  title: z.string(),
  status: z.string(),
  daysSinceActivity: z.number(),
  lastActivityAt: z.string().nullable(),
});
export type StaleIssue = z.infer<typeof StaleIssueSchema>;

export const ProjectMetricsSchema = z.object({
  totalIssues: z.number(),
  completedIssues: z.number(),
  remainingIssues: z.number(),
  totalPoints: z.number(),
  completedPoints: z.number(),
  remainingPoints: z.number(),
  scope: z.enum(["sprint", "project"]),
});
export type ProjectMetrics = z.infer<typeof ProjectMetricsSchema>;

export const ProjectStateSchema = z.object({
  project: ProjectSchema,
  activeIssue: IssueSchema.nullable(),
  sprint: SprintSchema.nullable(),
  metrics: ProjectMetricsSchema,
  git: GitStatusSchema,
  dependencies: z.array(DependencyStatusSchema),
  staleIssues: z.array(StaleIssueSchema),
  risks: z.array(RiskSchema),
  generatedAt: z.string(),
});
export type ProjectState = z.infer<typeof ProjectStateSchema>;
