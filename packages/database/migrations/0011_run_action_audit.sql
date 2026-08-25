-- What an applied run actually did, so it can be undone.
--
-- The claim guard proved the agent can act wrongly even after a human approves,
-- and until now there was no way back. Reversal needs more than the action that
-- was requested: it needs the state that action replaced.
--
-- Snapshots are per action and per target row, not per project. A full project
-- snapshot per run would be simpler and would grow without bound on a database
-- that is meant to sit in a developer's home directory.
CREATE TABLE IF NOT EXISTS agent_run_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_index INTEGER NOT NULL,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  -- NULL before means the action created the target; NULL after means it removed it.
  before_json TEXT,
  after_json TEXT,
  reversible INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT NOT NULL,
  approver TEXT NOT NULL DEFAULT 'local'
);

CREATE INDEX IF NOT EXISTS idx_run_actions_run ON agent_run_actions(run_id, action_index);
CREATE INDEX IF NOT EXISTS idx_run_actions_project ON agent_run_actions(project_id, applied_at DESC);
