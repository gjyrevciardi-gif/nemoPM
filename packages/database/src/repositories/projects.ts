import type Database from "better-sqlite3";
import type { CreateProjectInput, Project, UpdateProjectInput } from "@ai-pm/shared";
import { newId, now } from "../util.js";

interface ProjectRow {
  id: string;
  name: string;
  key: string;
  description: string | null;
  repository_path: string | null;
  issue_seq: number;
  created_at: string;
  updated_at: string;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description,
    repositoryPath: row.repository_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deriveKey(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  const base = (letters || "PROJ").slice(0, 4) || "PROJ";
  return base;
}

export function createProject(db: Database.Database, input: CreateProjectInput): Project {
  const id = newId();
  const ts = now();
  let key = input.key ?? deriveKey(input.name);

  // Ensure uniqueness by appending a numeric suffix if needed.
  const exists = db.prepare("SELECT 1 FROM projects WHERE key = ?");
  let attempt = key;
  let suffix = 2;
  while (exists.get(attempt)) {
    attempt = `${key}${suffix}`;
    suffix += 1;
  }
  key = attempt;

  db.prepare(
    `INSERT INTO projects (id, name, key, description, repository_path, issue_seq, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, input.name, key, input.description ?? null, input.repositoryPath ?? null, ts, ts);

  return getProjectOrThrow(db, id);
}

export function listProjects(db: Database.Database): Project[] {
  const rows = db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as ProjectRow[];
  return rows.map(toProject);
}

export function getProject(db: Database.Database, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return row ? toProject(row) : null;
}

export function getProjectOrThrow(db: Database.Database, id: string): Project {
  const project = getProject(db, id);
  if (!project) throw new Error(`Project not found: ${id}`);
  return project;
}

export function updateProject(
  db: Database.Database,
  id: string,
  input: UpdateProjectInput,
): Project | null {
  const existing = getProject(db, id);
  if (!existing) return null;

  const ts = now();
  db.prepare(
    `UPDATE projects SET
      name = ?,
      description = ?,
      repository_path = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.description !== undefined ? input.description : existing.description,
    input.repositoryPath !== undefined ? input.repositoryPath : existing.repositoryPath,
    ts,
    id,
  );

  return getProjectOrThrow(db, id);
}

export function deleteProject(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Atomically allocates the next human-friendly issue key for a project, e.g. "ACME-7". */
export function nextIssueKey(db: Database.Database, projectId: string): string {
  const project = db
    .prepare("SELECT key, issue_seq FROM projects WHERE id = ?")
    .get(projectId) as { key: string; issue_seq: number } | undefined;
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const nextSeq = project.issue_seq + 1;
  db.prepare("UPDATE projects SET issue_seq = ? WHERE id = ?").run(nextSeq, projectId);
  return `${project.key}-${nextSeq}`;
}
