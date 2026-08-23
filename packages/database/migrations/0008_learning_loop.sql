ALTER TABLE projects ADD COLUMN project_mode TEXT;
ALTER TABLE projects ADD COLUMN project_mode_source TEXT;

CREATE TABLE project_mode_events (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  previous_mode TEXT, next_mode TEXT NOT NULL, source TEXT NOT NULL, reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX idx_project_mode_events_project ON project_mode_events(project_id,created_at);

CREATE TABLE agent_learning_examples (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_message TEXT NOT NULL, state_summary_json TEXT NOT NULL, mode_evidence_json TEXT NOT NULL,
  router_decision_json TEXT NOT NULL, tools_offered_json TEXT NOT NULL DEFAULT '[]', tools_selected_json TEXT NOT NULL DEFAULT '[]',
  actual_behavior TEXT, expected_mode TEXT NOT NULL, expected_intent TEXT NOT NULL,
  expected_capabilities_json TEXT NOT NULL DEFAULT '[]', expected_tools_json TEXT NOT NULL DEFAULT '[]', forbidden_json TEXT NOT NULL DEFAULT '[]',
  failure_category TEXT NOT NULL, correction_source TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'UNREVIEWED', created_at TEXT NOT NULL
);
CREATE INDEX idx_agent_learning_project ON agent_learning_examples(project_id,created_at);
CREATE INDEX idx_agent_learning_review ON agent_learning_examples(review_status);
