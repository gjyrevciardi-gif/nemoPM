import type Database from "better-sqlite3";
import { newId, now } from "../util.js";

export interface Decision {
  id: string;
  projectId: string;
  issueId: string | null;
  title: string;
  description: string | null;
  createdAt: string;
}

interface DecisionRow {
  id: string;
  project_id: string;
  issue_id: string | null;
  title: string;
  description: string | null;
  created_at: string;
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    projectId: row.project_id,
    issueId: row.issue_id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function createDecision(
  db: Database.Database,
  input: { projectId: string; issueId?: string | null; title: string; description?: string | null },
): Decision {
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO decisions (id, project_id, issue_id, title, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.projectId, input.issueId ?? null, input.title, input.description ?? null, ts);

  const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as DecisionRow;
  return toDecision(row);
}

export function listDecisionsByProject(db: Database.Database, projectId: string): Decision[] {
  const rows = db
    .prepare("SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as DecisionRow[];
  return rows.map(toDecision);
}
