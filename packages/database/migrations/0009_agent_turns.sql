-- Conversation memory, scoped to one project.
--
-- Every agent turn used to start from zero: told what a product was in one
-- message, NEMO answered the next with "[open decision: what purpose does this
-- serve?]". Recording the exchange lets the next turn read the last few.
--
-- Deliberately small. On local hardware the prompt is the dominant cost, so
-- this is read back bounded by both count and characters, never in full.
CREATE TABLE IF NOT EXISTS agent_turns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  reply TEXT NOT NULL,
  tools_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_turns_project_created
  ON agent_turns(project_id, created_at DESC);
