import type Database from "better-sqlite3";
import type { Activity, ActivityType } from "@ai-pm/shared";
import { newId, now } from "../util.js";

interface ActivityRow {
  id: string;
  project_id: string;
  issue_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
}

function toActivity(row: ActivityRow): Activity {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    projectId: row.project_id,
    issueId: row.issue_id,
    type: row.type as ActivityType,
    payload,
    createdAt: row.created_at,
  };
}

export function recordActivity(
  db: Database.Database,
  input: {
    projectId: string;
    issueId?: string | null;
    type: ActivityType;
    payload?: Record<string, unknown>;
  },
): Activity {
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO activities (id, project_id, issue_id, type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.issueId ?? null, input.type, JSON.stringify(input.payload ?? {}), ts);

  return {
    id,
    projectId: input.projectId,
    issueId: input.issueId ?? null,
    type: input.type,
    payload: input.payload ?? {},
    createdAt: ts,
  };
}

export function listActivityByProject(
  db: Database.Database,
  projectId: string,
  limit = 100,
): Activity[] {
  const rows = db
    .prepare("SELECT * FROM activities WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(projectId, limit) as ActivityRow[];
  return rows.map(toActivity);
}

export function listActivityByIssue(db: Database.Database, issueId: string, limit = 100): Activity[] {
  const rows = db
    .prepare("SELECT * FROM activities WHERE issue_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(issueId, limit) as ActivityRow[];
  return rows.map(toActivity);
}

/** Most recent activity timestamp for an issue, used by the stale-task risk rule. */
export function lastActivityAtForIssue(db: Database.Database, issueId: string): string | null {
  const row = db
    .prepare("SELECT created_at FROM activities WHERE issue_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(issueId) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}
