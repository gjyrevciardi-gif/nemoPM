import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../src/db.js";
import * as agentTurnsRepo from "../src/repositories/agent-turns.js";
import * as projectsRepo from "../src/repositories/projects.js";

let db: Database.Database;
let alpha: string;
let beta: string;

beforeEach(() => {
  db = createTestDb();
  alpha = projectsRepo.createProject(db, { name: "Alpha", key: "ALPHA" }).id;
  beta = projectsRepo.createProject(db, { name: "Beta", key: "BETA" }).id;
});

describe("conversation memory", () => {
  it("returns the most recent turns, newest first", () => {
    for (const n of [1, 2, 3]) {
      agentTurnsRepo.recordTurn(db, { projectId: alpha, message: `question ${n}`, reply: `answer ${n}` });
    }

    const turns = agentTurnsRepo.listRecentTurns(db, alpha, 2);
    expect(turns.map((t) => t.message)).toEqual(["question 3", "question 2"]);
  });

  // The whole product is project-scoped; a memory that bleeds would leak one
  // client's plans into another's planning session.
  it("never returns another project's conversation", () => {
    agentTurnsRepo.recordTurn(db, { projectId: alpha, message: "alpha secret", reply: "noted" });
    agentTurnsRepo.recordTurn(db, { projectId: beta, message: "beta question", reply: "noted" });

    expect(agentTurnsRepo.listRecentTurns(db, beta).map((t) => t.message)).toEqual(["beta question"]);
    expect(agentTurnsRepo.listRecentTurns(db, alpha).map((t) => t.message)).toEqual(["alpha secret"]);
  });

  it("keeps the tools a turn used", () => {
    agentTurnsRepo.recordTurn(db, { projectId: alpha, message: "m", reply: "r", tools: ["createIssue", "planSprint"] });

    expect(agentTurnsRepo.listRecentTurns(db, alpha)[0]!.tools).toEqual(["createIssue", "planSprint"]);
  });

  it("truncates a very long reply rather than storing a transcript", () => {
    agentTurnsRepo.recordTurn(db, { projectId: alpha, message: "m", reply: "x".repeat(5000) });

    expect(agentTurnsRepo.listRecentTurns(db, alpha)[0]!.reply.length).toBeLessThanOrEqual(1200);
  });

  it("goes away with its project", () => {
    agentTurnsRepo.recordTurn(db, { projectId: alpha, message: "m", reply: "r" });
    projectsRepo.deleteProject(db, alpha);

    expect(agentTurnsRepo.listRecentTurns(db, alpha)).toEqual([]);
  });
});
