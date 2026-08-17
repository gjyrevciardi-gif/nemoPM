import type Database from "better-sqlite3";
import type { AgentAction, AgentActionResult } from "@ai-pm/shared";
import { newId, now } from "../util.js";

export interface AgentRun {
  id: string;
  projectId: string;
  requestText: string;
  status: "proposed" | "applied" | "failed";
  actions: AgentAction[];
  results: AgentActionResult[];
  createdAt: string;
  appliedAt: string | null;
}

interface AgentRunRow {
  id: string;
  project_id: string;
  request_text: string;
  status: string;
  actions_json: string;
  result_json: string;
  created_at: string;
  applied_at: string | null;
}

function toRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    projectId: row.project_id,
    requestText: row.request_text,
    status: row.status as AgentRun["status"],
    actions: JSON.parse(row.actions_json),
    results: JSON.parse(row.result_json),
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

export function createRun(
  db: Database.Database,
  input: { projectId: string; requestText: string; actions: AgentAction[] },
): AgentRun {
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO agent_runs (id, project_id, request_text, status, actions_json, result_json, created_at, applied_at)
     VALUES (?, ?, ?, 'proposed', ?, '[]', ?, NULL)`,
  ).run(id, input.projectId, input.requestText, JSON.stringify(input.actions), ts);
  return getRunOrThrow(db, id);
}

export function getRun(db: Database.Database, id: string): AgentRun | null {
  const row = db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(id) as AgentRunRow | undefined;
  return row ? toRun(row) : null;
}

export function getRunOrThrow(db: Database.Database, id: string): AgentRun {
  const run = getRun(db, id);
  if (!run) throw new Error(`Agent run not found: ${id}`);
  return run;
}

export function completeRun(
  db: Database.Database,
  id: string,
  input: { status: "applied" | "failed"; results: AgentActionResult[] },
): AgentRun {
  db.prepare("UPDATE agent_runs SET status = ?, result_json = ?, applied_at = ? WHERE id = ?").run(
    input.status,
    JSON.stringify(input.results),
    now(),
    id,
  );
  return getRunOrThrow(db, id);
}
