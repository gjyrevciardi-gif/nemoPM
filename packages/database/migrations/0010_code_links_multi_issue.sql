-- A commit can belong to more than one issue.
--
-- "WAL-1, WAL-2: shared login refactor" is one commit and two pieces of work,
-- and the original UNIQUE(repository_id, commit_hash) could only record it
-- against whichever issue happened to be seen first. The second issue silently
-- got no link and no proposed transition -- silently being the problem: nothing
-- reported that half the commit's meaning had been dropped.
--
-- The uniqueness that actually matters is one link per (repository, commit,
-- issue). SQLite cannot drop a table-level constraint, so the table is rebuilt.
-- IFNULL keeps the guarantee for links with no issue at all, which would
-- otherwise duplicate freely: NULLs are distinct to a unique index.
CREATE TABLE code_links_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_id TEXT REFERENCES issues(id) ON DELETE SET NULL,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_hash TEXT NOT NULL,
  branch TEXT,
  subject TEXT NOT NULL,
  author TEXT,
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  committed_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO code_links_new
SELECT id, project_id, issue_id, repository_id, commit_hash, branch, subject,
       author, changed_files_json, committed_at, created_at
FROM code_links;

DROP TABLE code_links;
ALTER TABLE code_links_new RENAME TO code_links;

CREATE UNIQUE INDEX idx_code_links_unique
  ON code_links(repository_id, commit_hash, IFNULL(issue_id, ''));

CREATE INDEX idx_code_links_issue ON code_links(issue_id);
CREATE INDEX idx_code_links_project ON code_links(project_id, created_at DESC);
