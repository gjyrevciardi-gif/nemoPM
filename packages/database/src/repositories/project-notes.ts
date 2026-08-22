import type Database from "better-sqlite3";
import type { ProjectNote } from "@ai-pm/shared";
import { newId, now } from "../util.js";

interface ProjectNoteRow {
  id: string;
  project_id: string;
  note: string;
  created_at: string;
}

function toNote(row: ProjectNoteRow): ProjectNote {
  return { id: row.id, projectId: row.project_id, note: row.note, createdAt: row.created_at };
}

export function createNote(db: Database.Database, projectId: string, note: string): ProjectNote {
  const id = newId();
  db.prepare("INSERT INTO project_notes (id, project_id, note, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    projectId,
    note,
    now(),
  );
  const row = db.prepare("SELECT * FROM project_notes WHERE id = ?").get(id) as ProjectNoteRow;
  return toNote(row);
}

export function listNotesByProject(db: Database.Database, projectId: string, limit = 100): ProjectNote[] {
  const rows = db
    .prepare("SELECT * FROM project_notes WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(projectId, limit) as ProjectNoteRow[];
  return rows.map(toNote);
}

export function deleteNote(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM project_notes WHERE id = ?").run(id).changes > 0;
}
