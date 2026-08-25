import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface RunActionRecord {
  id: string;
  runId: string;
  projectId: string;
  actionIndex: number;
  tool: string;
  args: Record<string, unknown>;
  targetKind: string | null;
  targetId: string | null;
  /** The row as it stood before the action. Null means the action created it. */
  before: Record<string, unknown> | null;
  /** The row as it stood after. Null means the action removed it. */
  after: Record<string, unknown> | null;
  reversible: boolean;
  appliedAt: string;
  approver: string;
}

interface Row {
  id: string;
  run_id: string;
  project_id: string;
  action_index: number;
  tool: string;
  args_json: string;
  target_kind: string | null;
  target_id: string | null;
  before_json: string | null;
  after_json: string | null;
  reversible: number;
  applied_at: string;
  approver: string;
}

const parse = (json: string | null) => (json ? (JSON.parse(json) as Record<string, unknown>) : null);

function toRecord(row: Row): RunActionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    actionIndex: row.action_index,
    tool: row.tool,
    args: JSON.parse(row.args_json) as Record<string, unknown>,
    targetKind: row.target_kind,
    targetId: row.target_id,
    before: parse(row.before_json),
    after: parse(row.after_json),
    reversible: row.reversible === 1,
    appliedAt: row.applied_at,
    approver: row.approver,
  };
}

export function recordRunAction(
  db: Database.Database,
  input: Omit<RunActionRecord, "id" | "appliedAt"> & { appliedAt?: string },
): RunActionRecord {
  const row: Row = {
    id: randomUUID(),
    run_id: input.runId,
    project_id: input.projectId,
    action_index: input.actionIndex,
    tool: input.tool,
    args_json: JSON.stringify(input.args),
    target_kind: input.targetKind,
    target_id: input.targetId,
    before_json: input.before ? JSON.stringify(input.before) : null,
    after_json: input.after ? JSON.stringify(input.after) : null,
    reversible: input.reversible ? 1 : 0,
    applied_at: input.appliedAt ?? new Date().toISOString(),
    approver: input.approver,
  };
  db.prepare(
    `INSERT INTO agent_run_actions (
       id, run_id, project_id, action_index, tool, args_json, target_kind, target_id,
       before_json, after_json, reversible, applied_at, approver
     ) VALUES (
       @id, @run_id, @project_id, @action_index, @tool, @args_json, @target_kind, @target_id,
       @before_json, @after_json, @reversible, @applied_at, @approver
     )`,
  ).run(row);
  return toRecord(row);
}

/** In application order, which is the order a reversal must undo backwards. */
export function listRunActions(db: Database.Database, runId: string): RunActionRecord[] {
  const rows = db
    .prepare("SELECT * FROM agent_run_actions WHERE run_id = ? ORDER BY action_index ASC")
    .all(runId) as Row[];
  return rows.map(toRecord);
}

/** The most recently applied run for a project, which is the only one v1 can undo. */
export function lastAppliedRunId(db: Database.Database, projectId: string): string | null {
  const row = db
    .prepare(
      `SELECT r.id AS id
         FROM agent_runs r
        WHERE r.project_id = ? AND r.status = 'applied'
        ORDER BY COALESCE(r.resolved_at, r.created_at) DESC
        LIMIT 1`,
    )
    .get(projectId) as { id: string } | undefined;
  return row?.id ?? null;
}
