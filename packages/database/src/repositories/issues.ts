import type Database from "better-sqlite3";
import type { CreateIssueInput, Issue, IssueStatus, UpdateIssueInput } from "@ai-pm/shared";
import { newId, now } from "../util.js";
import { nextIssueKey } from "./projects.js";
import { recordActivity } from "./activities.js";

interface IssueRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  key: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  story_points: number | null;
  sprint_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function toIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    key: row.key,
    type: row.type as Issue["type"],
    title: row.title,
    description: row.description,
    status: row.status as Issue["status"],
    priority: row.priority as Issue["priority"],
    storyPoints: row.story_points,
    sprintId: row.sprint_id,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function createIssue(db: Database.Database, input: CreateIssueInput): Issue {
  const id = newId();
  const ts = now();
  const key = nextIssueKey(db, input.projectId);

  const maxPositionRow = db
    .prepare("SELECT COALESCE(MAX(position), -1) as maxPos FROM issues WHERE project_id = ? AND status = ?")
    .get(input.projectId, input.status) as { maxPos: number };
  const position = maxPositionRow.maxPos + 1;

  db.prepare(
    `INSERT INTO issues (
      id, project_id, parent_id, key, type, title, description, status, priority,
      story_points, sprint_id, position, created_at, updated_at, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    id,
    input.projectId,
    input.parentId ?? null,
    key,
    input.type,
    input.title,
    input.description ?? null,
    input.status,
    input.priority,
    input.storyPoints ?? null,
    input.sprintId ?? null,
    position,
    ts,
    ts,
  );

  recordActivity(db, {
    projectId: input.projectId,
    issueId: id,
    type: "issue.created",
    payload: { key, title: input.title, status: input.status },
  });

  return getIssueOrThrow(db, id);
}

export function listIssuesByProject(db: Database.Database, projectId: string): Issue[] {
  const rows = db
    .prepare("SELECT * FROM issues WHERE project_id = ? ORDER BY status, position ASC")
    .all(projectId) as IssueRow[];
  return rows.map(toIssue);
}

export function listIssuesBySprint(db: Database.Database, sprintId: string): Issue[] {
  const rows = db
    .prepare("SELECT * FROM issues WHERE sprint_id = ? ORDER BY status, position ASC")
    .all(sprintId) as IssueRow[];
  return rows.map(toIssue);
}

export function getIssue(db: Database.Database, id: string): Issue | null {
  const row = db.prepare("SELECT * FROM issues WHERE id = ?").get(id) as IssueRow | undefined;
  return row ? toIssue(row) : null;
}

export function getIssueOrThrow(db: Database.Database, id: string): Issue {
  const issue = getIssue(db, id);
  if (!issue) throw new Error(`Issue not found: ${id}`);
  return issue;
}

export function updateIssue(db: Database.Database, id: string, input: UpdateIssueInput): Issue | null {
  const existing = getIssue(db, id);
  if (!existing) return null;
  const ts = now();

  const next = {
    parentId: input.parentId !== undefined ? input.parentId : existing.parentId,
    type: input.type ?? existing.type,
    title: input.title ?? existing.title,
    description: input.description !== undefined ? input.description : existing.description,
    status: input.status ?? existing.status,
    priority: input.priority ?? existing.priority,
    storyPoints: input.storyPoints !== undefined ? input.storyPoints : existing.storyPoints,
    sprintId: input.sprintId !== undefined ? input.sprintId : existing.sprintId,
    position: input.position !== undefined ? input.position : existing.position,
  };

  // Track status-driven timestamps when status changes through a generic update.
  let startedAt = existing.startedAt;
  let completedAt = existing.completedAt;
  if (next.status !== existing.status) {
    if (next.status === "in_progress" && !startedAt) startedAt = ts;
    if (next.status === "done") completedAt = ts;
    if (next.status !== "done") completedAt = null;
  }

  db.prepare(
    `UPDATE issues SET
      parent_id = ?, type = ?, title = ?, description = ?, status = ?, priority = ?,
      story_points = ?, sprint_id = ?, position = ?, updated_at = ?, started_at = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    next.parentId,
    next.type,
    next.title,
    next.description,
    next.status,
    next.priority,
    next.storyPoints,
    next.sprintId,
    next.position,
    ts,
    startedAt,
    completedAt,
    id,
  );

  if (next.status !== existing.status) {
    recordActivity(db, {
      projectId: existing.projectId,
      issueId: id,
      type: "issue.status_changed",
      payload: { from: existing.status, to: next.status },
    });
  } else {
    recordActivity(db, {
      projectId: existing.projectId,
      issueId: id,
      type: "issue.updated",
      payload: { fields: Object.keys(input) },
    });
  }

  return getIssueOrThrow(db, id);
}

// Batch-persists a whole column's (or two columns') worth of positions after a drag,
// so displaced siblings don't keep stale positions that can collide with the moved issue.
export function reorderIssues(
  db: Database.Database,
  updates: { id: string; status: IssueStatus; position: number }[],
): Issue[] {
  const ts = now();
  const existingById = new Map(updates.map((u) => [u.id, getIssue(db, u.id)]));

  const txn = db.transaction(() => {
    for (const u of updates) {
      const existing = existingById.get(u.id);
      if (!existing) continue;

      let startedAt = existing.startedAt;
      let completedAt = existing.completedAt;
      if (u.status !== existing.status) {
        if (u.status === "in_progress" && !startedAt) startedAt = ts;
        if (u.status === "done") completedAt = ts;
        if (u.status !== "done") completedAt = null;
      }

      db.prepare(
        "UPDATE issues SET status = ?, position = ?, updated_at = ?, started_at = ?, completed_at = ? WHERE id = ?",
      ).run(u.status, u.position, ts, startedAt, completedAt, u.id);

      if (u.status !== existing.status) {
        recordActivity(db, {
          projectId: existing.projectId,
          issueId: u.id,
          type: "issue.status_changed",
          payload: { from: existing.status, to: u.status },
        });
      }
    }
  });
  txn();

  return updates.map((u) => getIssueOrThrow(db, u.id));
}

export function deleteIssue(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM issues WHERE id = ?").run(id);
  return result.changes > 0;
}

export function startIssue(db: Database.Database, id: string): Issue {
  const existing = getIssueOrThrow(db, id);
  const ts = now();
  db.prepare(
    "UPDATE issues SET status = 'in_progress', started_at = COALESCE(started_at, ?), completed_at = NULL, updated_at = ? WHERE id = ?",
  ).run(ts, ts, id);
  recordActivity(db, {
    projectId: existing.projectId,
    issueId: id,
    type: "issue.started",
    payload: { from: existing.status },
  });
  return getIssueOrThrow(db, id);
}

export function reviewIssue(db: Database.Database, id: string): Issue {
  const existing = getIssueOrThrow(db, id);
  const ts = now();
  db.prepare("UPDATE issues SET status = 'in_review', updated_at = ? WHERE id = ?").run(ts, id);
  recordActivity(db, {
    projectId: existing.projectId,
    issueId: id,
    type: "issue.status_changed",
    payload: { from: existing.status, to: "in_review" },
  });
  return getIssueOrThrow(db, id);
}

export function completeIssue(db: Database.Database, id: string): Issue {
  const existing = getIssueOrThrow(db, id);
  const ts = now();
  db.prepare("UPDATE issues SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?").run(
    ts,
    ts,
    id,
  );
  recordActivity(db, {
    projectId: existing.projectId,
    issueId: id,
    type: "issue.completed",
    payload: { from: existing.status },
  });
  return getIssueOrThrow(db, id);
}
