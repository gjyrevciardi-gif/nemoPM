import type Database from "better-sqlite3";
import { issuesRepo, sprintsRepo } from "@ai-pm/database";
import type { Issue } from "@ai-pm/shared";

export const { createSprint, listSprintsByProject, getSprint, getActiveSprint, startSprint, completeSprint } =
  sprintsRepo;

/** Assigns an issue to a sprint. Thin, named wrapper over updateIssue for tool-schema clarity. */
export function addIssueToSprint(db: Database.Database, issueId: string, sprintId: string): Issue {
  const updated = issuesRepo.updateIssue(db, issueId, { sprintId });
  if (!updated) throw new Error(`Issue not found: ${issueId}`);
  return updated;
}

/** Removes an issue from whatever sprint it's in, returning it to the backlog. */
export function removeIssueFromSprint(db: Database.Database, issueId: string): Issue {
  const updated = issuesRepo.updateIssue(db, issueId, { sprintId: null });
  if (!updated) throw new Error(`Issue not found: ${issueId}`);
  return updated;
}

/**
 * Moves every not-done issue from one sprint into another -- e.g. rolling
 * unfinished work from a just-completed sprint into a freshly created one.
 */
export function carryOverUnfinishedIssues(
  db: Database.Database,
  fromSprintId: string,
  toSprintId: string,
): Issue[] {
  const unfinished = issuesRepo.listIssuesBySprint(db, fromSprintId).filter((issue) => issue.status !== "done");

  return unfinished.map((issue) => {
    const updated = issuesRepo.updateIssue(db, issue.id, { sprintId: toSprintId });
    if (!updated) throw new Error(`Issue not found: ${issue.id}`);
    return updated;
  });
}
