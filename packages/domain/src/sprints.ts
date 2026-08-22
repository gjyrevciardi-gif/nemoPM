import type Database from "better-sqlite3";
import { issuesRepo, sprintsRepo } from "@ai-pm/database";
import { ApiError } from "@ai-pm/shared";
import type { Issue, Sprint } from "@ai-pm/shared";

export const { createSprint, listSprintsByProject, getSprint, getActiveSprint, startSprint, completeSprint } =
  sprintsRepo;

/** Assigns an issue to a sprint. Thin, named wrapper over updateIssue for tool-schema clarity. */
export function addIssueToSprint(db: Database.Database, issueId: string, sprintId: string): Issue {
  const updated = issuesRepo.updateIssue(db, issueId, { sprintId });
  if (!updated) throw new Error(`Issue not found: ${issueId}`);
  return updated;
}

/** Removes an issue from whatever sprint it's in, returning it to the backlog. */
export function removeIssueFromSprint(db: Database.Database, issueId: string): Issue {
  const updated = issuesRepo.updateIssue(db, issueId, { sprintId: null });
  if (!updated) throw new Error(`Issue not found: ${issueId}`);
  return updated;
}

export function updateSprint(
  db: Database.Database,
  sprintId: string,
  input: { name?: string; goal?: string | null },
): Sprint {
  const existing = sprintsRepo.getSprint(db, sprintId);
  if (!existing) throw new Error(`Sprint not found: ${sprintId}`);
  db.prepare("UPDATE sprints SET name = ?, goal = ? WHERE id = ?").run(
    input.name ?? existing.name,
    input.goal !== undefined ? input.goal : existing.goal,
    sprintId,
  );
  const updated = sprintsRepo.getSprint(db, sprintId);
  if (!updated) throw new Error(`Sprint not found: ${sprintId}`);
  return updated;
}

/**
 * Moves every not-done issue from one sprint into another -- e.g. rolling
 * unfinished work from a just-completed sprint into a freshly created one.
 */
export function carryOverUnfinishedIssues(
  db: Database.Database,
  fromSprintId: string,
  toSprintId: string,
): Issue[] {
  const unfinished = issuesRepo.listIssuesBySprint(db, fromSprintId).filter((issue) => issue.status !== "done");

  return unfinished.map((issue) => {
    const updated = issuesRepo.updateIssue(db, issue.id, { sprintId: toSprintId });
    if (!updated) throw new Error(`Issue not found: ${issue.id}`);
    return updated;
  });
}

export interface SprintPoints {
  total: number;
  completed: number;
  remaining: number;
  issueCount: number;
  unfinishedCount: number;
}

export function sprintPoints(db: Database.Database, sprintId: string): SprintPoints {
  const issues = issuesRepo.listIssuesBySprint(db, sprintId);
  const total = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const completed = issues
    .filter((i) => i.status === "done")
    .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  return {
    total,
    completed,
    remaining: total - completed,
    issueCount: issues.length,
    unfinishedCount: issues.filter((i) => i.status !== "done").length,
  };
}

export interface Velocity {
  /** Mean completed points across the sampled sprints; null when there is no completed sprint yet. */
  average: number | null;
  sampleSize: number;
  sprints: { id: string; name: string; completedPoints: number }[];
}

/**
 * Velocity from finished sprints only. Deliberately a plain average of
 * completed points -- a number a human can check by hand -- and null rather
 * than a guess when a project has no history to average.
 */
export function getVelocity(db: Database.Database, projectId: string, sampleSize = 3): Velocity {
  const completed = sprintsRepo
    .listSprintsByProject(db, projectId)
    .filter((s) => s.status === "completed")
    .slice(0, sampleSize);

  const sprints = completed.map((sprint) => ({
    id: sprint.id,
    name: sprint.name,
    completedPoints: sprintPoints(db, sprint.id).completed,
  }));

  if (sprints.length === 0) return { average: null, sampleSize: 0, sprints: [] };

  const sum = sprints.reduce((acc, s) => acc + s.completedPoints, 0);
  return {
    average: Math.round((sum / sprints.length) * 10) / 10,
    sampleSize: sprints.length,
    sprints,
  };
}

export interface PlanSprintInput {
  name: string;
  goal?: string | null;
  /** Existing issues to pull into the new sprint. */
  issueIds?: string[];
  /** Carry unfinished work out of the currently active sprint. */
  carryOver?: boolean;
  /** Start the sprint immediately. Requires no other sprint to be active, or completeActive. */
  start?: boolean;
  /** Complete the currently active sprint as part of this plan. */
  completeActive?: boolean;
}

export interface PlanSprintResult {
  sprint: Sprint;
  addedIssues: Issue[];
  carriedIssues: Issue[];
  completedSprint: Sprint | null;
}

/**
 * The composite behind "plan the next sprint": create it, optionally close the
 * one that's running, pull in chosen issues, carry the unfinished work over,
 * and start it.
 *
 * Order matters. The previous sprint is completed *before* the new one starts,
 * so the one-active-sprint invariant holds at every intermediate step rather
 * than only at the end -- there is never a moment with two active sprints,
 * even inside the transaction.
 */
export function planSprint(
  db: Database.Database,
  projectId: string,
  input: PlanSprintInput,
): PlanSprintResult {
  const active = sprintsRepo.getActiveSprint(db, projectId);

  if (input.start && active && !input.completeActive) {
    throw new ApiError(
      409,
      "SPRINT_CONFLICT",
      `Sprint "${active.name}" is still active. Complete it first, or include completing it in the plan.`,
    );
  }

  const carryFrom = input.carryOver ? active : null;
  const sprint = sprintsRepo.createSprint(db, { projectId, name: input.name, goal: input.goal ?? undefined });

  // Carry work out of the old sprint before closing it: completing a sprint
  // must not silently strand unfinished issues in a finished sprint.
  const carriedIssues = carryFrom ? carryOverUnfinishedIssues(db, carryFrom.id, sprint.id) : [];

  const completedSprint = active && input.completeActive ? sprintsRepo.completeSprint(db, active.id) : null;

  const addedIssues = (input.issueIds ?? []).map((issueId) => addIssueToSprint(db, issueId, sprint.id));

  const started = input.start ? sprintsRepo.startSprint(db, sprint.id) : sprint;

  return { sprint: started, addedIssues, carriedIssues, completedSprint };
}
