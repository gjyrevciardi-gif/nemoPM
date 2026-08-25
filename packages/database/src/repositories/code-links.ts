import type Database from "better-sqlite3";
import { newId, now } from "../util.js";

export interface CodeLink {
  id: string;
  projectId: string;
  issueId: string | null;
  repositoryId: string;
  commitHash: string;
  branch: string | null;
  subject: string;
  author: string | null;
  changedFiles: string[];
  committedAt: string | null;
  createdAt: string;
}

interface CodeLinkRow {
  id: string;
  project_id: string;
  issue_id: string | null;
  repository_id: string;
  commit_hash: string;
  branch: string | null;
  subject: string;
  author: string | null;
  changed_files_json: string;
  committed_at: string | null;
  created_at: string;
}

function toCodeLink(row: CodeLinkRow): CodeLink {
  let changedFiles: string[] = [];
  try {
    changedFiles = JSON.parse(row.changed_files_json);
  } catch {
    changedFiles = [];
  }
  return {
    id: row.id,
    projectId: row.project_id,
    issueId: row.issue_id,
    repositoryId: row.repository_id,
    commitHash: row.commit_hash,
    branch: row.branch,
    subject: row.subject,
    author: row.author,
    changedFiles,
    committedAt: row.committed_at,
    createdAt: row.created_at,
  };
}

export function createCodeLink(
  db: Database.Database,
  input: {
    projectId: string;
    issueId: string | null;
    repositoryId: string;
    commitHash: string;
    branch: string | null;
    subject: string;
    author: string | null;
    changedFiles: string[];
    committedAt: string | null;
  },
): CodeLink {
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT OR IGNORE INTO code_links (
      id, project_id, issue_id, repository_id, commit_hash, branch, subject, author,
      changed_files_json, committed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.issueId,
    input.repositoryId,
    input.commitHash,
    input.branch,
    input.subject,
    input.author,
    JSON.stringify(input.changedFiles),
    input.committedAt,
    ts,
  );

  const row = db
    .prepare("SELECT * FROM code_links WHERE repository_id = ? AND commit_hash = ?")
    .get(input.repositoryId, input.commitHash) as CodeLinkRow;
  return toCodeLink(row);
}

export function listCodeLinksForIssue(db: Database.Database, issueId: string): CodeLink[] {
  const rows = db
    .prepare("SELECT * FROM code_links WHERE issue_id = ? ORDER BY created_at DESC")
    .all(issueId) as CodeLinkRow[];
  return rows.map(toCodeLink);
}

export function listCodeLinksForProject(db: Database.Database, projectId: string, limit = 50): CodeLink[] {
  const rows = db
    .prepare("SELECT * FROM code_links WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(projectId, limit) as CodeLinkRow[];
  return rows.map(toCodeLink);
}

/**
 * Whether this commit is already recorded for this repository.
 *
 * createCodeLink is INSERT OR IGNORE and reads the row back either way, so it
 * cannot tell a new commit from one seen on a previous scan. Callers that act
 * on new commits -- proposing a transition, say -- need that difference, and
 * must not re-propose the same move on every scan.
 */
export function hasCodeLink(
  db: Database.Database,
  repositoryId: string,
  commitHash: string,
  issueId: string | null = null,
): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS present FROM code_links WHERE repository_id = ? AND commit_hash = ? AND IFNULL(issue_id,'') = ? LIMIT 1",
    )
    .get(repositoryId, commitHash, issueId ?? "") as { present: number } | undefined;
  return !!row;
}

/**
 * Whether this issue already has a link with this commit subject.
 *
 * An amend or a rebase rewrites history: the same logical change comes back
 * with a new hash, so hash-based deduplication sees a brand new commit and
 * proposes the same move a second time -- asking a user to approve something
 * they may have just declined. Subject plus issue is the stable identity of a
 * change across a rewrite.
 */
export function hasCodeLinkWithSubject(
  db: Database.Database,
  repositoryId: string,
  issueId: string,
  subject: string,
): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM code_links WHERE repository_id = ? AND issue_id = ? AND subject = ? LIMIT 1")
    .get(repositoryId, issueId, subject) as { present: number } | undefined;
  return !!row;
}
