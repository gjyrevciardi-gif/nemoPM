-- Agent system v2 + project memory.
--
-- Three things happen here:
--   1. The "one active sprint per project" rule becomes a database invariant
--      instead of a convention the agent was trusted to respect.
--   2. agent_runs grows a real lifecycle (rejected/expired), an audit trail of
--      tool calls, the evidence behind a proposal, and portfolio scope.
--   3. Decisions become first-class memory, joined by milestones and notes.

-- 1. ONE ACTIVE SPRINT ------------------------------------------------------

-- Existing databases may already hold two active sprints, which the old
-- startSprint allowed. Keep the most recently started one per project and
-- close the rest, otherwise the unique index below can't be created.
UPDATE sprints
SET status = 'completed',
    completed_at = COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
WHERE status = 'active'
  AND id NOT IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY project_id
               ORDER BY COALESCE(started_at, created_at) DESC, id DESC
             ) AS rn
      FROM sprints
      WHERE status = 'active'
    )
    WHERE rn = 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_sprints_one_active
  ON sprints(project_id) WHERE status = 'active';

-- 2. AGENT RUN LIFECYCLE ----------------------------------------------------

-- Rebuilt rather than altered: project_id has to become nullable for
-- portfolio runs, which SQLite can't do with ALTER TABLE.
ALTER TABLE agent_runs RENAME TO agent_runs_old;

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  -- Null for portfolio runs, whose actions carry their own target project.
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'project',   -- project | portfolio
  request_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | applied | rejected | failed | expired
  actions_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT NOT NULL DEFAULT '[]',
  tool_calls_json TEXT NOT NULL DEFAULT '[]',
  plan_json TEXT,
  model TEXT,
  provider TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

INSERT INTO agent_runs (
  id, project_id, scope, request_text, status, actions_json, result_json,
  tool_calls_json, plan_json, model, provider, created_at, resolved_at
)
SELECT id, project_id, 'project', request_text, status, actions_json, result_json,
       '[]', NULL, NULL, NULL, created_at, applied_at
FROM agent_runs_old;

DROP TABLE agent_runs_old;

CREATE INDEX IF NOT EXISTS idx_agent_runs_project ON agent_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, created_at);

-- 3. PROJECT MEMORY ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned',  -- planned | reached
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | inferred
  -- Inferred milestones stay out of the official history until confirmed.
  confirmed INTEGER NOT NULL DEFAULT 1,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id, occurred_at);

-- Decisions gain the fields that make them answerable later: the situation,
-- the choice, and why it won. The old free-text description becomes context.
ALTER TABLE decisions RENAME TO decisions_old;

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  context TEXT,
  decision TEXT,
  rationale TEXT,
  decided_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO decisions (
  id, project_id, issue_id, milestone_id, title, context, decision, rationale, decided_at, created_at
)
SELECT id, project_id, issue_id, NULL, title, description, NULL, NULL, created_at, created_at
FROM decisions_old;

DROP TABLE decisions_old;

CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, decided_at);

CREATE TABLE IF NOT EXISTS project_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project_id, created_at);
