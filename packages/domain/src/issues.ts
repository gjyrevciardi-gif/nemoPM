import type Database from "better-sqlite3";
import { issuesRepo } from "@ai-pm/database";
import type { Issue, IssueStatus, IssueType, Priority, UpdateIssueInput } from "@ai-pm/shared";

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

function updateOrThrow(db: Database.Database, issueId: string, input: UpdateIssueInput): Issue {
  const updated = issuesRepo.updateIssue(db, issueId, input);
  if (!updated) throw new Error(`Issue not found: ${issueId}`);
  return updated;
}

/**
 * Re-parents an issue, rejecting the two shapes that corrupt a hierarchy:
 * an issue owning itself, and a cycle further up the chain.
 */
export function setParent(db: Database.Database, issueId: string, parentId: string | null): Issue {
  if (parentId === issueId) throw new Error("An issue cannot be its own parent.");

  if (parentId) {
    const parent = issuesRepo.getIssue(db, parentId);
    if (!parent) throw new Error(`Parent issue not found: ${parentId}`);

    const child = issuesRepo.getIssueOrThrow(db, issueId);
    if (parent.projectId !== child.projectId) {
      throw new Error("A parent issue must belong to the same project.");
    }

    let cursor: Issue | null = parent;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor.id === issueId) throw new Error("That would create a circular parent/child relationship.");
      if (seen.has(cursor.id)) break;
      seen.add(cursor.id);
      cursor = cursor.parentId ? issuesRepo.getIssue(db, cursor.parentId) : null;
    }
  }

  return updateOrThrow(db, issueId, { parentId });
}

export interface SubtaskInput {
  title: string;
  description?: string;
  storyPoints?: number | null;
  priority?: Priority;
}

/**
 * Breaks a parent issue into subtasks. Subtasks inherit the parent's sprint
 * so that splitting committed work doesn't quietly drop it out of the sprint,
 * and inherit its priority unless the caller says otherwise.
 */
export function createSubtasks(
  db: Database.Database,
  parentId: string,
  subtasks: SubtaskInput[],
): Issue[] {
  const parent = issuesRepo.getIssueOrThrow(db, parentId);

  return subtasks.map((subtask) =>
    issuesRepo.createIssue(db, {
      projectId: parent.projectId,
      parentId: parent.id,
      type: "subtask" as IssueType,
      title: subtask.title,
      description: subtask.description,
      status: "backlog",
      priority: subtask.priority ?? parent.priority,
      storyPoints: subtask.storyPoints ?? null,
      sprintId: parent.sprintId,
    }),
  );
}

export interface BulkIssueUpdate {
  issueId: string;
  changes: UpdateIssueInput;
}

/** Applies the same kind of edit to many issues. Callers wrap this in a transaction. */
export function bulkUpdateIssues(db: Database.Database, updates: BulkIssueUpdate[]): Issue[] {
  return updates.map((update) => updateOrThrow(db, update.issueId, update.changes));
}

/** Issues that depend on something unfinished -- i.e. work that cannot start yet. */
export function findBlockedIssues(
  db: Database.Database,
  issues: Issue[],
  dependencies: { issueId: string; dependsOnIssueId: string }[],
): Issue[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const blockedIds = new Set(
    dependencies
      .filter((dep) => {
        const blocker = byId.get(dep.dependsOnIssueId);
        return blocker ? blocker.status !== "done" : false;
      })
      .map((dep) => dep.issueId),
  );
  return issues.filter((issue) => blockedIds.has(issue.id) && issue.status !== "done");
}
