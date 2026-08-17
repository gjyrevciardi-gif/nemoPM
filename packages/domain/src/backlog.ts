import type Database from "better-sqlite3";
import { issuesRepo } from "@ai-pm/database";
import type { Issue } from "@ai-pm/shared";

/** Issues not currently assigned to any sprint -- the project's backlog. */
export function getBacklog(db: Database.Database, projectId: string): Issue[] {
  return issuesRepo.listIssuesByProject(db, projectId).filter((issue) => issue.sprintId === null);
}

/**
 * Rewrites backlog order. Issues named in `orderedIssueIds` take the top of
 * the list in the given order; everything else keeps its relative order
 * below them, so a partial reorder never silently reshuffles the rest.
 */
export function reorderBacklog(
  db: Database.Database,
  projectId: string,
  orderedIssueIds: string[],
): Issue[] {
  const backlog = getBacklog(db, projectId);
  const byId = new Map(backlog.map((issue) => [issue.id, issue]));

  const ranked: Issue[] = [];
  for (const id of orderedIssueIds) {
    const issue = byId.get(id);
    if (!issue) throw new Error(`Issue ${id} is not in this project's backlog.`);
    if (!ranked.includes(issue)) ranked.push(issue);
  }
  for (const issue of backlog) {
    if (!ranked.includes(issue)) ranked.push(issue);
  }

  return issuesRepo.reorderIssues(
    db,
    ranked.map((issue, index) => ({ id: issue.id, status: issue.status, position: index })),
  );
}
