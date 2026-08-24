import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface AgentTurn {
  id: string;
  projectId: string;
  message: string;
  reply: string;
  tools: string[];
  createdAt: string;
}

interface Row {
  id: string;
  project_id: string;
  message: string;
  reply: string;
  tools_json: string;
  created_at: string;
}

/** Long replies are stored truncated: recall needs the gist, not the transcript. */
const MAX_STORED_REPLY = 1200;

function toTurn(row: Row): AgentTurn {
  return {
    id: row.id,
    projectId: row.project_id,
    message: row.message,
    reply: row.reply,
    tools: JSON.parse(row.tools_json) as string[],
    createdAt: row.created_at,
  };
}

export function recordTurn(
  db: Database.Database,
  input: { projectId: string; message: string; reply: string; tools?: string[] },
): AgentTurn {
  const row: Row = {
    id: randomUUID(),
    project_id: input.projectId,
    message: input.message.slice(0, MAX_STORED_REPLY),
    reply: input.reply.slice(0, MAX_STORED_REPLY),
    tools_json: JSON.stringify(input.tools ?? []),
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO agent_turns (id, project_id, message, reply, tools_json, created_at)
     VALUES (@id, @project_id, @message, @reply, @tools_json, @created_at)`,
  ).run(row);
  return toTurn(row);
}

/** Most recent first. Always scoped to one project -- memory must never leak across them. */
export function listRecentTurns(db: Database.Database, projectId: string, limit = 4): AgentTurn[] {
  const rows = db
    .prepare(`SELECT * FROM agent_turns WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .all(projectId, limit) as Row[];
  return rows.map(toTurn);
}

export function clearTurns(db: Database.Database, projectId: string): number {
  return db.prepare(`DELETE FROM agent_turns WHERE project_id = ?`).run(projectId).changes;
}
