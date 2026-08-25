import type Database from "better-sqlite3";
import { agentRunsRepo, issuesRepo, runActionsRepo } from "@ai-pm/database";
import type { RunActionRecord } from "@ai-pm/database";
import type { Issue } from "@ai-pm/shared";
import { ApiError } from "./errors.js";

/**
 * Tools whose effect is a single issue row, and are therefore reversible by
 * restoring that row.
 *
 * Everything absent from this list has no defined reversal and is rejected
 * before anything is touched. planSprint is the clearest example: it creates a
 * sprint, moves issues into it, completes another sprint and starts the new
 * one, and "put all that back" is not a single row restore. Guessing at a
 * reversal for it would be worse than admitting there isn't one.
 */
const REVERSIBLE_TOOLS = new Set([
  "createIssue",
  "changeIssueStatus",
  "advanceIssueFromCommit",
  "setPriority",
  "setStoryPoints",
  "updateIssue",
  "setParent",
]);

export function isReversibleTool(tool: string): boolean {
  return REVERSIBLE_TOOLS.has(tool);
}

/** The fields a restore puts back. Ids and keys are identity, not state. */
const RESTORED_FIELDS = ["title", "description", "status", "priority", "storyPoints", "parentId", "sprintId"] as const;

function snapshotIssue(issue: Issue | null): Record<string, unknown> | null {
  if (!issue) return null;
  const snapshot: Record<string, unknown> = { id: issue.id, key: issue.key };
  for (const field of RESTORED_FIELDS) snapshot[field] = issue[field];
  return snapshot;
}

export function snapshotTarget(db: Database.Database, issueId: string | null): Record<string, unknown> | null {
  if (!issueId) return null;
  return snapshotIssue(issuesRepo.getIssue(db, issueId));
}

/** Whether two snapshots describe the same state, ignoring fields a restore does not touch. */
function sameState(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  if (a === null || b === null) return a === b;
  return RESTORED_FIELDS.every((field) => a[field] === b[field]);
}

export interface UndoResult {
  runId: string;
  status: "reverted";
  reversed: { tool: string; description: string }[];
}

/**
 * Reverses the most recently applied run for a project.
 *
 * Deliberately narrow: the last run only. Arbitrary point-in-time restore is a
 * different product, and building it here would mean owning a history model
 * nobody has asked for yet.
 *
 * Refuses rather than guesses, in every case where the world has moved on:
 *
 *   - an action whose tool has no defined reversal stops the whole run at
 *     lookup, before anything is touched;
 *   - a target somebody else has edited since is a conflict, because undoing
 *     would silently throw that edit away;
 *   - a target that no longer exists is reported plainly rather than thrown.
 *
 * All or none, in one transaction -- the same rule the apply path follows, and
 * for the same reason: a half-undone run is a state nobody can reason about.
 */
export function undoLastRun(db: Database.Database, projectId: string, runId?: string): UndoResult {
  const targetRunId = runId ?? runActionsRepo.lastAppliedRunId(db, projectId);
  if (!targetRunId) {
    throw new ApiError(404, "NOTHING_TO_UNDO", "This project has no applied run to undo.");
  }

  const run = agentRunsRepo.getRun(db, targetRunId);
  if (!run || run.projectId !== projectId) {
    throw new ApiError(404, "NOT_FOUND", `No run ${targetRunId} in this project.`);
  }
  if (run.status === "reverted") {
    throw new ApiError(409, "ALREADY_REVERTED", "That run has already been undone.");
  }
  if (run.status !== "applied") {
    throw new ApiError(409, "NOT_APPLIED", `A ${run.status} run has nothing to undo.`);
  }

  const actions = runActionsRepo.listRunActions(db, targetRunId);
  if (actions.length === 0) {
    throw new ApiError(409, "NO_AUDIT_TRAIL", "This run was applied before undo was recorded, so it cannot be undone.");
  }

  // Lookup phase: refuse the whole run before touching anything.
  const irreversible = actions.find((action) => !action.reversible);
  if (irreversible) {
    throw new ApiError(
      409,
      "NO_REVERSAL",
      `"${irreversible.tool}" has no defined reversal, so this run cannot be undone.`,
    );
  }

  for (const action of actions) {
    const current = snapshotTarget(db, action.targetId);
    if (action.after !== null && current === null) {
      throw new ApiError(
        409,
        "TARGET_GONE",
        `${describeTarget(action)} no longer exists, so this run cannot be undone.`,
      );
    }
    if (action.after !== null && !sameState(current, action.after)) {
      throw new ApiError(
        409,
        "CONFLICT",
        `${describeTarget(action)} has changed since the run was applied. Undoing would discard that change.`,
      );
    }
  }

  const reversed: UndoResult["reversed"] = [];

  db.transaction(() => {
    // Backwards: a later action may depend on an earlier one.
    for (const action of [...actions].reverse()) {
      reversed.push(reverseOne(db, action));
    }
    agentRunsRepo.resolveRun(db, targetRunId, {
      status: "reverted",
      results: reversed.map((entry) => ({ tool: entry.tool, description: entry.description, ok: true, error: null })),
    });
  })();

  return { runId: targetRunId, status: "reverted", reversed };
}

function describeTarget(action: RunActionRecord): string {
  const key = (action.after?.key ?? action.before?.key) as string | undefined;
  return key ? `Issue ${key}` : `The target of "${action.tool}"`;
}

function reverseOne(db: Database.Database, action: RunActionRecord): { tool: string; description: string } {
  const targetId = action.targetId;
  if (!targetId) return { tool: action.tool, description: `${action.tool}: nothing to reverse` };

  // Created by this run: undoing means it should not exist.
  if (action.before === null) {
    const key = (action.after?.key as string | undefined) ?? targetId;
    issuesRepo.deleteIssue(db, targetId);
    return { tool: action.tool, description: `Deleted ${key}, which this run created` };
  }

  const restore: Record<string, unknown> = {};
  for (const field of RESTORED_FIELDS) restore[field] = action.before[field];
  issuesRepo.updateIssue(db, targetId, restore as never);

  const key = (action.before.key as string | undefined) ?? targetId;
  return { tool: action.tool, description: `Restored ${key} to its state before the run` };
}
