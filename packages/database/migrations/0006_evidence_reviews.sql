CREATE TABLE IF NOT EXISTS intelligence_reviews (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 finding_id TEXT,
 category TEXT NOT NULL,
 verdict TEXT NOT NULL,
 expected_json TEXT,
 false_positive_category TEXT,
 missed_work_label TEXT,
 note TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intelligence_reviews_project ON intelligence_reviews(project_id, created_at);

CREATE TABLE IF NOT EXISTS test_evidence (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 repository_id TEXT REFERENCES repositories(id) ON DELETE CASCADE,
 evidence_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
