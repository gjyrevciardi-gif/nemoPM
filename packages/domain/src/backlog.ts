import type Database from "better-sqlite3";
import { issuesRepo } from "@ai-pm/database";
import type { Issue } from "@ai-pm/shared";

/** Issues not currently assigned to any sprint -- the project's backlog. */
export function getBacklog(db: Database.Database, projectId: string): Issue[] {
  return issuesRepo.listIssuesByProject(db, projectId).filter((issue) => issue.sprintId === null);
}
