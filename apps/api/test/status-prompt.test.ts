import { describe, expect, it } from "vitest";
import { createTestDb, issuesRepo, projectsRepo } from "@ai-pm/database";
import { buildProjectState } from "../src/lib/state.js";
import { summarizeStateForPrompt } from "../src/lib/ai.js";

/**
 * Found in use, not in review. Asked for a status on a project with no issues,
 * qwen2.5:3b answered "Progress: Project scope complete" -- because the snapshot
 * handed it the line "Issues: 0/0 complete", and 0/0 reads as 100%.
 *
 * Empty and finished are opposite states, and a PM acts differently on each. The
 * deterministic fallback already refuses to conflate them; the prompt path did
 * not, so the model was being asked to spot an ambiguity the snapshot created.
 *
 * Fixed in the snapshot rather than in the prompt: a ratio nobody can misread is
 * worth more than an instruction telling a 3B model to be careful with one.
 */
const emptyProject = async () => {
  const db = createTestDb();
  const project = projectsRepo.createProject(db, { name: "Demiri", key: "DEMI" });
  return { db, state: await buildProjectState(db, project.id) };
};

describe("the state snapshot the model is given", () => {
  it("does not describe a project with no issues as complete", async () => {
    const { db, state } = await emptyProject();

    const snapshot = summarizeStateForPrompt(state);

    // "0/0 complete" is the exact string the model read as 100%.
    expect(snapshot).not.toMatch(/0\/0 complete/);
    expect(snapshot).toMatch(/backlog is empty/i);
    expect(snapshot).toMatch(/not the same as the work being complete/i);
    db.close();
  });

  it("still reports real progress as a ratio", async () => {
    const db = createTestDb();
    const project = projectsRepo.createProject(db, { name: "Wallet", key: "WAL" });
    const issue = (title: string) =>
      issuesRepo.createIssue(db, {
        projectId: project.id,
        title,
        type: "task",
        status: "todo",
        priority: "medium",
      });
    const done = issue("Login");
    issue("Payments");
    issuesRepo.completeIssue(db, done.id);

    const snapshot = summarizeStateForPrompt(await buildProjectState(db, project.id));

    expect(snapshot).toMatch(/1\/2 complete/);
    expect(snapshot).not.toMatch(/backlog is empty/i);
    db.close();
  });

  it("does not imply an empty backlog is fully delivered in points either", async () => {
    const { db, state } = await emptyProject();

    const snapshot = summarizeStateForPrompt(state);

    // The same trap one line down: "Points: 0/0 complete".
    expect(snapshot).not.toMatch(/Points: 0\/0/);
    db.close();
  });
});
