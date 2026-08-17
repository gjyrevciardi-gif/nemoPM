import type Database from "better-sqlite3";
import type { Repository } from "@ai-pm/shared";
import { newId, now } from "../util.js";

interface RepositoryRow {
  id: string;
  project_id: string;
  path: string;
  last_scanned_commit_hash: string | null;
  last_branch: string | null;
  last_scanned_at: string | null;
  created_at: string;
}

function toRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    createdAt: row.created_at,
  };
}

export function connectRepository(db: Database.Database, projectId: string, repoPath: string): Repository {
  const existing = db
    .prepare("SELECT * FROM repositories WHERE project_id = ? AND path = ?")
    .get(projectId, repoPath) as RepositoryRow | undefined;
  if (existing) return toRepository(existing);

  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO repositories (id, project_id, path, last_scanned_commit_hash, last_branch, last_scanned_at, created_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?)`,
  ).run(id, projectId, repoPath, ts);

  return getRepositoryByProjectOrThrow(db, projectId);
}

export function getRepositoryByProject(db: Database.Database, projectId: string): Repository | null {
  const row = db
    .prepare("SELECT * FROM repositories WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(projectId) as RepositoryRow | undefined;
  return row ? toRepository(row) : null;
}

function getRepositoryByProjectOrThrow(db: Database.Database, projectId: string): Repository {
  const repo = getRepositoryByProject(db, projectId);
  if (!repo) throw new Error(`No repository connected for project: ${projectId}`);
  return repo;
}

export function getRepositoryRow(db: Database.Database, id: string): RepositoryRow | undefined {
  return db.prepare("SELECT * FROM repositories WHERE id = ?").get(id) as RepositoryRow | undefined;
}

export function updateRepositoryScanState(
  db: Database.Database,
  repositoryId: string,
  update: { commitHash: string | null; branch: string | null },
): void {
  db.prepare(
    "UPDATE repositories SET last_scanned_commit_hash = ?, last_branch = ?, last_scanned_at = ? WHERE id = ?",
  ).run(update.commitHash, update.branch, now(), repositoryId);
}
