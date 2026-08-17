import type Database from "better-sqlite3";
import { ApiError } from "@ai-pm/shared";
import type { CreateSprintInput, Sprint } from "@ai-pm/shared";
import { newId, now } from "../util.js";
import { recordActivity } from "./activities.js";

interface SprintRow {
  id: string;
  project_id: string;
  name: string;
  goal: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function toSprint(row: SprintRow): Sprint {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    goal: row.goal,
    status: row.status as Sprint["status"],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export function createSprint(db: Database.Database, input: CreateSprintInput): Sprint {
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO sprints (id, project_id, name, goal, status, started_at, completed_at, created_at)
     VALUES (?, ?, ?, ?, 'planned', NULL, NULL, ?)`,
  ).run(id, input.projectId, input.name, input.goal ?? null, ts);

  recordActivity(db, {
    projectId: input.projectId,
    type: "sprint.created",
    payload: { name: input.name },
  });

  return getSprintOrThrow(db, id);
}

export function listSprintsByProject(db: Database.Database, projectId: string): Sprint[] {
  const rows = db
    .prepare("SELECT * FROM sprints WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId) as SprintRow[];
  return rows.map(toSprint);
}

export function getSprint(db: Database.Database, id: string): Sprint | null {
  const row = db.prepare("SELECT * FROM sprints WHERE id = ?").get(id) as SprintRow | undefined;
  return row ? toSprint(row) : null;
}

export function getSprintOrThrow(db: Database.Database, id: string): Sprint {
  const sprint = getSprint(db, id);
  if (!sprint) throw new Error(`Sprint not found: ${id}`);
  return sprint;
}

export function getActiveSprint(db: Database.Database, projectId: string): Sprint | null {
  const row = db
    .prepare("SELECT * FROM sprints WHERE project_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1")
    .get(projectId) as SprintRow | undefined;
  return row ? toSprint(row) : null;
}

/**
 * A project has at most one active sprint. Enforced here with a readable
 * error, and again by a partial unique index in the database so no code path
 * -- REST, agent, or a future one -- can leave two sprints running.
 */
export function startSprint(db: Database.Database, id: string): Sprint {
  const existing = getSprintOrThrow(db, id);
  if (existing.status === "completed") {
    throw new ApiError(409, "SPRINT_COMPLETED", `Sprint "${existing.name}" is already completed.`);
  }

  const active = getActiveSprint(db, existing.projectId);
  if (active && active.id !== id) {
    throw new ApiError(
      409,
      "SPRINT_CONFLICT",
      `Sprint "${active.name}" is already active in this project. Complete it before starting "${existing.name}".`,
    );
  }

  const ts = now();
  db.prepare("UPDATE sprints SET status = 'active', started_at = COALESCE(started_at, ?) WHERE id = ?").run(
    ts,
    id,
  );
  recordActivity(db, {
    projectId: existing.projectId,
    type: "sprint.started",
    payload: { sprintId: id, name: existing.name },
  });
  return getSprintOrThrow(db, id);
}

export function completeSprint(db: Database.Database, id: string): Sprint {
  const existing = getSprintOrThrow(db, id);
  const ts = now();
  db.prepare("UPDATE sprints SET status = 'completed', completed_at = ? WHERE id = ?").run(ts, id);
  recordActivity(db, {
    projectId: existing.projectId,
    type: "sprint.completed",
    payload: { sprintId: id, name: existing.name },
  });
  return getSprintOrThrow(db, id);
}
