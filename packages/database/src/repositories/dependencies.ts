import type Database from "better-sqlite3";
import { ApiError } from "@ai-pm/shared";
import type { IssueDependency } from "@ai-pm/shared";
import { newId, now } from "../util.js";
import { recordActivity } from "./activities.js";
import { getIssueOrThrow } from "./issues.js";

interface DependencyRow {
  id: string;
  issue_id: string;
  depends_on_issue_id: string;
  created_at: string;
}

function toDependency(row: DependencyRow): IssueDependency {
  return {
    id: row.id,
    issueId: row.issue_id,
    dependsOnIssueId: row.depends_on_issue_id,
    createdAt: row.created_at,
  };
}

export function addDependency(
  db: Database.Database,
  issueId: string,
  dependsOnIssueId: string,
): IssueDependency {
  if (issueId === dependsOnIssueId) {
    throw new Error("An issue cannot depend on itself");
  }
  const issue = getIssueOrThrow(db, issueId);
  const dependsOn = getIssueOrThrow(db, dependsOnIssueId);

  // Both ids exist -- but a dependency across two projects would make one
  // project's board depend on work it can't see, so it is rejected here,
  // where every caller (REST and agent alike) passes through.
  if (issue.projectId !== dependsOn.projectId) {
    throw new ApiError(
      400,
      "CROSS_PROJECT",
      "An issue can only depend on another issue in the same project.",
    );
  }

  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT OR IGNORE INTO issue_dependencies (id, issue_id, depends_on_issue_id, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, issueId, dependsOnIssueId, ts);

  recordActivity(db, {
    projectId: issue.projectId,
    issueId,
    type: "dependency.added",
    payload: { dependsOnIssueId },
  });

  const row = db
    .prepare("SELECT * FROM issue_dependencies WHERE issue_id = ? AND depends_on_issue_id = ?")
    .get(issueId, dependsOnIssueId) as DependencyRow;
  return toDependency(row);
}

export function listDependencies(db: Database.Database, issueId: string): IssueDependency[] {
  const rows = db
    .prepare("SELECT * FROM issue_dependencies WHERE issue_id = ? ORDER BY created_at ASC")
    .all(issueId) as DependencyRow[];
  return rows.map(toDependency);
}

export function listDependenciesForProject(db: Database.Database, projectId: string): IssueDependency[] {
  const rows = db
    .prepare(
      `SELECT d.* FROM issue_dependencies d
       JOIN issues i ON i.id = d.issue_id
       WHERE i.project_id = ?
       ORDER BY d.created_at ASC`,
    )
    .all(projectId) as DependencyRow[];
  return rows.map(toDependency);
}

export function removeDependency(db: Database.Database, issueId: string, dependencyId: string): boolean {
  const issue = getIssueOrThrow(db, issueId);
  const result = db
    .prepare("DELETE FROM issue_dependencies WHERE id = ? AND issue_id = ?")
    .run(dependencyId, issueId);
  if (result.changes > 0) {
    recordActivity(db, {
      projectId: issue.projectId,
      issueId,
      type: "dependency.removed",
      payload: { dependencyId },
    });
  }
  return result.changes > 0;
}
