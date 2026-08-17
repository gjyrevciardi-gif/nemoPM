import type Database from "better-sqlite3";
import type { ComputedRisk, Risk } from "@ai-pm/shared";
import { newId, now } from "../util.js";
import { recordActivity } from "./activities.js";

interface RiskRow {
  id: string;
  project_id: string;
  issue_id: string | null;
  type: string;
  severity: string;
  status: string;
  message: string;
  evidence_json: string;
  dedupe_key: string;
  created_at: string;
  resolved_at: string | null;
}

function toRisk(row: RiskRow): Risk {
  let evidence: string[] = [];
  try {
    evidence = JSON.parse(row.evidence_json);
  } catch {
    evidence = [];
  }
  return {
    id: row.id,
    projectId: row.project_id,
    issueId: row.issue_id,
    type: row.type as Risk["type"],
    severity: row.severity as Risk["severity"],
    status: row.status as Risk["status"],
    message: row.message,
    evidence,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export function listOpenRisksByProject(db: Database.Database, projectId: string): Risk[] {
  const rows = db
    .prepare("SELECT * FROM risks WHERE project_id = ? AND status = 'open' ORDER BY severity DESC, created_at DESC")
    .all(projectId) as RiskRow[];
  return rows.map(toRisk);
}

/**
 * Reconciles freshly computed risks against what's stored: opens new risks,
 * updates evidence on ones that still apply, and resolves ones that no longer do.
 * Returns the current set of open risks after reconciliation.
 */
export function reconcileRisks(
  db: Database.Database,
  projectId: string,
  computed: ComputedRisk[],
): Risk[] {
  const openRows = db
    .prepare("SELECT * FROM risks WHERE project_id = ? AND status = 'open'")
    .all(projectId) as RiskRow[];
  const openByKey = new Map(openRows.map((r) => [r.dedupe_key, r]));
  const computedKeys = new Set(computed.map((c) => c.dedupeKey));

  const insert = db.prepare(
    `INSERT INTO risks (id, project_id, issue_id, type, severity, status, message, evidence_json, dedupe_key, created_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, NULL)`,
  );
  const update = db.prepare(
    `UPDATE risks SET severity = ?, message = ?, evidence_json = ? WHERE id = ?`,
  );
  const resolve = db.prepare(`UPDATE risks SET status = 'resolved', resolved_at = ? WHERE id = ?`);

  const tx = db.transaction(() => {
    for (const risk of computed) {
      const existing = openByKey.get(risk.dedupeKey);
      if (existing) {
        update.run(risk.severity, risk.message, JSON.stringify(risk.evidence), existing.id);
      } else {
        const id = newId();
        insert.run(
          id,
          projectId,
          risk.issueId,
          risk.type,
          risk.severity,
          risk.message,
          JSON.stringify(risk.evidence),
          risk.dedupeKey,
          now(),
        );
        recordActivity(db, {
          projectId,
          issueId: risk.issueId,
          type: "risk.detected",
          payload: { type: risk.type, severity: risk.severity, message: risk.message },
        });
      }
    }

    for (const row of openRows) {
      if (!computedKeys.has(row.dedupe_key)) {
        resolve.run(now(), row.id);
        recordActivity(db, {
          projectId,
          issueId: row.issue_id,
          type: "risk.resolved",
          payload: { type: row.type, message: row.message },
        });
      }
    }
  });
  tx();

  return listOpenRisksByProject(db, projectId);
}
