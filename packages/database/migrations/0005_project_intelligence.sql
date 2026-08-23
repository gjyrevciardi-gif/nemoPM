-- Deterministic repository intelligence: baselines, normalized events,
-- reconciliation proposals, automatic-action audit, and project policy.

CREATE TABLE IF NOT EXISTS repository_baselines (
  repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  snapshot_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  head_commit TEXT,
  branch TEXT,
  pm_state_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  processed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_events_project ON project_events(project_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_project_events_pending ON project_events(processed_at, created_at);

CREATE TABLE IF NOT EXISTS intelligence_actions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES project_events(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL, -- applied | proposed | observed | blocked | rejected
  impact TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  policy_json TEXT NOT NULL DEFAULT '{}',
  previous_json TEXT,
  next_json TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_intelligence_actions_project ON intelligence_actions(project_id, created_at);

CREATE TABLE IF NOT EXISTS project_autonomy_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
