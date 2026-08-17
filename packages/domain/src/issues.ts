import type Database from "better-sqlite3";
import { issuesRepo } from "@ai-pm/database";
import type { Issue, IssueStatus } from "@ai-pm/shared";

export const {
  createIssue,
  updateIssue,
  startIssue,
  reviewIssue,
  completeIssue,
  reorderIssues,
  deleteIssue,
  listIssuesByProject,
  listIssuesBySprint,
  getIssue,
  getIssueOrThrow,
} = issuesRepo;

export interface MoveIssueInput {
  status?: IssueStatus;
  sprintId?: string | null;
}

/**
 * Single entry point for "move this issue" requests (REST route and future
 * agent tool alike) -- a thin, explicitly-named wrapper over updateIssue so
 * callers don't need to know status and sprint reassignment both go through
 * the same generic update path underneath.
 */
export function moveIssue(db: Database.Database, issueId: string, input: MoveIssueInput): Issue {
  const updated = issuesRepo.updateIssue(db, issueId, input);
  if (!updated) throw new Error(`Issue not found: ${issueId}`);
  return updated;
}
