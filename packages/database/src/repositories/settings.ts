import type Database from "better-sqlite3";
import { DEFAULT_RISK_THRESHOLDS, RiskThresholdsSchema } from "@ai-pm/shared";
import type { RiskThresholds } from "@ai-pm/shared";
import { now } from "../util.js";

const RISK_THRESHOLDS_KEY = "risk_thresholds";

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, now());
}

export function getRiskThresholds(db: Database.Database): RiskThresholds {
  const raw = getSetting(db, RISK_THRESHOLDS_KEY);
  if (!raw) return DEFAULT_RISK_THRESHOLDS;
  const parsed = RiskThresholdsSchema.partial().safeParse(JSON.parse(raw));
  if (!parsed.success) return DEFAULT_RISK_THRESHOLDS;
  return { ...DEFAULT_RISK_THRESHOLDS, ...parsed.data };
}

export function setRiskThresholds(db: Database.Database, thresholds: Partial<RiskThresholds>): RiskThresholds {
  const merged = { ...getRiskThresholds(db), ...thresholds };
  setSetting(db, RISK_THRESHOLDS_KEY, JSON.stringify(merged));
  return merged;
}
