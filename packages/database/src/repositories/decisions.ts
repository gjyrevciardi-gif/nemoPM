import type Database from "better-sqlite3";
import type { CreateDecisionInput, Decision } from "@ai-pm/shared";
import { newId, now } from "../util.js";
import { recordActivity } from "./activities.js";

interface DecisionRow {
  id: string;
  project_id: string;
  issue_id: string | null;
  milestone_id: string | null;
  title: string;
  context: string | null;
  decision: string | null;
  rationale: string | null;
  decided_at: string;
  created_at: string;
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    projectId: row.project_id,
    issueId: row.issue_id,
    milestoneId: row.milestone_id,
    title: row.title,
    context: row.context,
    decision: row.decision,
    rationale: row.rationale,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export function createDecision(
  db: Database.Database,
  projectId: string,
  input: CreateDecisionInput,
): Decision {
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO decisions (
       id, project_id, issue_id, milestone_id, title, context, decision, rationale, decided_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.issueId ?? null,
    input.milestoneId ?? null,
    input.title,
    input.context ?? null,
    input.decision ?? null,
    input.rationale ?? null,
    input.decidedAt ?? ts,
    ts,
  );

  recordActivity(db, {
    projectId,
    issueId: input.issueId ?? undefined,
    type: "decision.recorded",
    payload: { title: input.title },
  });

  return getDecisionOrThrow(db, id);
}

export function getDecision(db: Database.Database, id: string): Decision | null {
  const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as DecisionRow | undefined;
  return row ? toDecision(row) : null;
}

export function getDecisionOrThrow(db: Database.Database, id: string): Decision {
  const decision = getDecision(db, id);
  if (!decision) throw new Error(`Decision not found: ${id}`);
  return decision;
}

export function listDecisionsByProject(db: Database.Database, projectId: string): Decision[] {
  const rows = db
    .prepare("SELECT * FROM decisions WHERE project_id = ? ORDER BY decided_at DESC")
    .all(projectId) as DecisionRow[];
  return rows.map(toDecision);
}

export function deleteDecision(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM decisions WHERE id = ?").run(id).changes > 0;
}

/** Human edits from the Decisions UI; the agent only ever creates. */
export function updateDecision(
  db: Database.Database,
  id: string,
  input: Partial<CreateDecisionInput>,
): Decision {
  const existing = getDecisionOrThrow(db, id);
  db.prepare(
    `UPDATE decisions SET title = ?, context = ?, decision = ?, rationale = ?, issue_id = ?, decided_at = ?
     WHERE id = ?`,
  ).run(
    input.title ?? existing.title,
    input.context !== undefined ? input.context : existing.context,
    input.decision !== undefined ? input.decision : existing.decision,
    input.rationale !== undefined ? input.rationale : existing.rationale,
    input.issueId !== undefined ? input.issueId : existing.issueId,
    input.decidedAt ?? existing.decidedAt,
    id,
  );
  return getDecisionOrThrow(db, id);
}
