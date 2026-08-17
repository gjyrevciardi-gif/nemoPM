-- Agent run history: backs the project agent's preview -> apply flow.
-- A row is created when a chat turn proposes ASK-tier actions; applying or
-- discarding it updates the same row rather than needing separate storage.

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  request_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | applied | failed
  actions_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id, created_at);
