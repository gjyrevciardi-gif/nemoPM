import type Database from "better-sqlite3";
import type {
  AgentAction,
  AgentActionResult,
  AgentPlan,
  AgentRunStatus,
  AgentToolCallRecord,
} from "@ai-pm/shared";
import { newId, now } from "../util.js";

export interface AgentRun {
  id: string;
  /** Null for portfolio runs; their actions carry their own target project. */
  projectId: string | null;
  scope: "project" | "portfolio";
  requestText: string;
  status: AgentRunStatus;
  actions: AgentAction[];
  results: AgentActionResult[];
  toolCalls: AgentToolCallRecord[];
  plan: AgentPlan | null;
  model: string | null;
  provider: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface AgentRunRow {
  id: string;
  project_id: string | null;
  scope: string;
  request_text: string;
  status: string;
  actions_json: string;
  result_json: string;
  tool_calls_json: string;
  plan_json: string | null;
  model: string | null;
  provider: string | null;
  created_at: string;
  resolved_at: string | null;
}

function toRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope as AgentRun["scope"],
    requestText: row.request_text,
    status: row.status as AgentRunStatus,
    actions: JSON.parse(row.actions_json),
    results: JSON.parse(row.result_json),
    toolCalls: JSON.parse(row.tool_calls_json),
    plan: row.plan_json ? (JSON.parse(row.plan_json) as AgentPlan) : null,
    model: row.model,
    provider: row.provider,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export function createRun(
  db: Database.Database,
  input: {
    projectId: string | null;
    scope?: "project" | "portfolio";
    requestText: string;
    actions: AgentAction[];
    toolCalls?: AgentToolCallRecord[];
    plan?: AgentPlan | null;
    model?: string | null;
    provider?: string | null;
  },
): AgentRun {
  const id = newId();
  db.prepare(
    `INSERT INTO agent_runs (
       id, project_id, scope, request_text, status, actions_json, result_json,
       tool_calls_json, plan_json, model, provider, created_at, resolved_at
     ) VALUES (?, ?, ?, ?, 'proposed', ?, '[]', ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    input.projectId,
    input.scope ?? "project",
    input.requestText,
    JSON.stringify(input.actions),
    JSON.stringify(input.toolCalls ?? []),
    input.plan ? JSON.stringify(input.plan) : null,
    input.model ?? null,
    input.provider ?? null,
    now(),
  );
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

export function listRunsByProject(db: Database.Database, projectId: string, limit = 50): AgentRun[] {
  const rows = db
    .prepare("SELECT * FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(projectId, limit) as AgentRunRow[];
  return rows.map(toRun);
}

export function listRunsByScope(db: Database.Database, scope: "project" | "portfolio", limit = 50): AgentRun[] {
  const rows = db
    .prepare("SELECT * FROM agent_runs WHERE scope = ? ORDER BY created_at DESC LIMIT ?")
    .all(scope, limit) as AgentRunRow[];
  return rows.map(toRun);
}

/**
 * Records a run's final state. Terminal by construction: the status column
 * moves out of 'proposed' exactly once, which is what stops the same plan
 * from being applied twice.
 */
export function resolveRun(
  db: Database.Database,
  id: string,
  input: { status: Exclude<AgentRunStatus, "proposed">; results?: AgentActionResult[] },
): AgentRun {
  db.prepare("UPDATE agent_runs SET status = ?, result_json = ?, resolved_at = ? WHERE id = ?").run(
    input.status,
    JSON.stringify(input.results ?? []),
    now(),
    id,
  );
  return getRunOrThrow(db, id);
}

/**
 * Ages out proposals nobody acted on. An approval screen from an hour ago was
 * computed against a project that has since moved, so applying it would be
 * acting on stale evidence.
 */
export function expireStaleRuns(db: Database.Database, olderThanIso: string): number {
  const result = db
    .prepare("UPDATE agent_runs SET status = 'expired', resolved_at = ? WHERE status = 'proposed' AND created_at < ?")
    .run(now(), olderThanIso);
  return result.changes;
}
