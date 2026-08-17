import type Database from "better-sqlite3";
import type { CreateMilestoneInput, Milestone } from "@ai-pm/shared";
import { newId, now } from "../util.js";
import { recordActivity } from "./activities.js";

interface MilestoneRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  source: string;
  confirmed: number;
  occurred_at: string;
  created_at: string;
}

function toMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status as Milestone["status"],
    source: row.source as Milestone["source"],
    confirmed: row.confirmed === 1,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

export function createMilestone(
  db: Database.Database,
  projectId: string,
  input: CreateMilestoneInput,
): Milestone {
  const id = newId();
  const ts = now();
  const source = input.source ?? "manual";
  // Anything NEMO inferred from Git or activity is a suggestion until a human
  // confirms it -- history is never written automatically.
  const confirmed = input.confirmed ?? source === "manual";

  db.prepare(
    `INSERT INTO milestones (
       id, project_id, title, description, status, source, confirmed, occurred_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.title,
    input.description ?? null,
    input.status ?? "planned",
    source,
    confirmed ? 1 : 0,
    input.occurredAt ?? ts,
    ts,
  );

  recordActivity(db, {
    projectId,
    type: "milestone.created",
    payload: { title: input.title, source, confirmed },
  });

  return getMilestoneOrThrow(db, id);
}

export function getMilestone(db: Database.Database, id: string): Milestone | null {
  const row = db.prepare("SELECT * FROM milestones WHERE id = ?").get(id) as MilestoneRow | undefined;
  return row ? toMilestone(row) : null;
}

export function getMilestoneOrThrow(db: Database.Database, id: string): Milestone {
  const milestone = getMilestone(db, id);
  if (!milestone) throw new Error(`Milestone not found: ${id}`);
  return milestone;
}

export function listMilestonesByProject(
  db: Database.Database,
  projectId: string,
  options: { includeUnconfirmed?: boolean } = {},
): Milestone[] {
  const sql = options.includeUnconfirmed
    ? "SELECT * FROM milestones WHERE project_id = ? ORDER BY occurred_at DESC"
    : "SELECT * FROM milestones WHERE project_id = ? AND confirmed = 1 ORDER BY occurred_at DESC";
  const rows = db.prepare(sql).all(projectId) as MilestoneRow[];
  return rows.map(toMilestone);
}

/** Promotes an inferred suggestion into official project history. */
export function confirmMilestone(db: Database.Database, id: string): Milestone {
  const existing = getMilestoneOrThrow(db, id);
  db.prepare("UPDATE milestones SET confirmed = 1 WHERE id = ?").run(id);
  recordActivity(db, {
    projectId: existing.projectId,
    type: "milestone.confirmed",
    payload: { title: existing.title },
  });
  return getMilestoneOrThrow(db, id);
}

export function updateMilestone(
  db: Database.Database,
  id: string,
  input: { title?: string; description?: string | null; status?: Milestone["status"]; occurredAt?: string },
): Milestone {
  const existing = getMilestoneOrThrow(db, id);
  db.prepare("UPDATE milestones SET title = ?, description = ?, status = ?, occurred_at = ? WHERE id = ?").run(
    input.title ?? existing.title,
    input.description !== undefined ? input.description : existing.description,
    input.status ?? existing.status,
    input.occurredAt ?? existing.occurredAt,
    id,
  );
  return getMilestoneOrThrow(db, id);
}

export function deleteMilestone(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM milestones WHERE id = ?").run(id).changes > 0;
}
