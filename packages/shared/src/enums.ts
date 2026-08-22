import { z } from "zod";

export const IssueTypeSchema = z.enum(["epic", "story", "task", "bug", "subtask"]);
export type IssueType = z.infer<typeof IssueTypeSchema>;

export const IssueStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
]);
export type IssueStatus = z.infer<typeof IssueStatusSchema>;

export const PrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof PrioritySchema>;

export const SprintStatusSchema = z.enum(["planned", "active", "completed"]);
export type SprintStatus = z.infer<typeof SprintStatusSchema>;

export const RiskTypeSchema = z.enum(["stale_task", "dependency", "sprint_delivery"]);
export type RiskType = z.infer<typeof RiskTypeSchema>;

export const RiskSeveritySchema = z.enum(["low", "medium", "high"]);
export type RiskSeverity = z.infer<typeof RiskSeveritySchema>;

export const RiskStatusSchema = z.enum(["open", "resolved"]);
export type RiskStatus = z.infer<typeof RiskStatusSchema>;

export const ActivityTypeSchema = z.enum([
  "issue.created",
  "issue.updated",
  "issue.started",
  "issue.completed",
  "issue.status_changed",
  "sprint.created",
  "sprint.started",
  "sprint.completed",
  "git.scan",
  "git.branch_detected",
  "git.commit_detected",
  "git.files_changed",
  "ai.status_requested",
  "ai.plan_generated",
  "ai.agent_run",
  "risk.detected",
  "risk.resolved",
  "dependency.added",
  "dependency.removed",
  "decision.recorded",
  "milestone.created",
  "milestone.confirmed",
]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;
