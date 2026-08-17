import type Database from "better-sqlite3";
import type { Issue, Sprint } from "@ai-pm/shared";
import { issuesRepo, sprintsRepo } from "@ai-pm/database";
import type { ToolContext } from "./types.js";

/**
 * Every write in a project turn is anchored to the turn's project, never to
 * an id the model produced. This is the single function that turns "the
 * project this conversation is about" into an id -- so a tool physically
 * cannot address another project.
 */
export function requireProjectId(ctx: ToolContext): string {
  if (!ctx.projectId) {
    throw new Error("This tool needs a project. Ask the user which project they mean.");
  }
  return ctx.projectId;
}

/**
 * Resolves an issue key within the turn's project only. A key from another
 * project reads as "not found" here, which is the behavior we want: the agent
 * must not be able to reach across projects even when handed a valid key.
 */
export function findIssueByKey(ctx: ToolContext, key: string): Issue {
  const projectId = requireProjectId(ctx);
  const issue = issuesRepo.getIssueByKey(ctx.db, projectId, key);
  if (!issue) {
    throw new Error(
      `No issue with key "${key.trim()}" exists in this project. Do not invent issue keys -- ` +
        "list the project's issues and use an exact existing key, or say the issue doesn't exist.",
    );
  }
  return issue;
}

export function findIssuesByKeys(ctx: ToolContext, keys: string[]): Issue[] {
  return keys.map((key) => findIssueByKey(ctx, key));
}

/** Belt and braces for ids that arrive from anywhere other than a key lookup. */
export function assertIssueInProject(db: Database.Database, projectId: string, issueId: string): Issue {
  const issue = issuesRepo.getIssue(db, issueId);
  if (!issue || issue.projectId !== projectId) {
    throw new Error(`Issue ${issueId} does not belong to this project.`);
  }
  return issue;
}

export function assertSprintInProject(db: Database.Database, projectId: string, sprintId: string): Sprint {
  const sprint = sprintsRepo.getSprint(db, sprintId);
  if (!sprint || sprint.projectId !== projectId) {
    throw new Error(`Sprint ${sprintId} does not belong to this project.`);
  }
  return sprint;
}

export function findSprintByName(
  ctx: ToolContext,
  name: string,
  options: { includeCompleted?: boolean } = {},
): Sprint {
  const projectId = requireProjectId(ctx);
  const wanted = name.trim().toLowerCase();
  const matches = sprintsRepo
    .listSprintsByProject(ctx.db, projectId)
    .filter((s) => s.name.toLowerCase() === wanted)
    .filter((s) => options.includeCompleted || s.status !== "completed");

  const sprint = matches[0];
  if (!sprint) {
    throw new Error(
      `No ${options.includeCompleted ? "" : "open "}sprint named "${name.trim()}" exists in this project. ` +
        "Use listSprints to see the real sprint names.",
    );
  }
  return sprint;
}

/** The sprint an unqualified request means: the active one. */
export function requireActiveSprint(ctx: ToolContext): Sprint {
  const projectId = requireProjectId(ctx);
  const active = sprintsRepo.getActiveSprint(ctx.db, projectId);
  if (!active) throw new Error("This project has no active sprint.");
  return active;
}

export function pointsOf(issues: Issue[]): number {
  return issues.reduce((sum, issue) => sum + (issue.storyPoints ?? 0), 0);
}

/** Compact one-line issue rendering, used in both previews and read results. */
export function issueLine(issue: Issue): string {
  return `${issue.key} [${issue.type}] "${issue.title}" ${issue.status}/${issue.priority}, ${
    issue.storyPoints ?? "?"
  } pts`;
}
