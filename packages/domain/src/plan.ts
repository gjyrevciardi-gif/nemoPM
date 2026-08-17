import type Database from "better-sqlite3";
import { decisionsRepo, issuesRepo, sprintsRepo } from "@ai-pm/database";
import type { ConfirmPlanInput, Issue } from "@ai-pm/shared";

export interface ConfirmPlanResult {
  issues: Issue[];
  sprintId: string | null;
}

/**
 * Single place that decides what happens to a confirmed AI task plan's
 * sprint assignment, so every caller (the legacy REST route, the web app,
 * VS Code, and later the agent) behaves identically instead of each
 * re-deciding it -- previously VS Code auto-created+started a sprint
 * client-side while the web app never did, which could silently diverge.
 *
 * - `sprintId` is a string: add every created issue to that sprint.
 * - `sprintId` is null: leave every created issue in the backlog (explicit choice).
 * - `sprintId` is omitted and `autoSprint` is true: use the active sprint if
 *   one exists, otherwise create and start a new sprint named after the feature.
 * - `sprintId` is omitted and `autoSprint` is not set: leave issues in the backlog.
 */
export function confirmPlanTask(
  db: Database.Database,
  projectId: string,
  input: ConfirmPlanInput,
): ConfirmPlanResult {
  let sprintId: string | null = input.sprintId ?? null;

  if (input.sprintId === undefined && input.autoSprint) {
    const active = sprintsRepo.getActiveSprint(db, projectId);
    if (active) {
      sprintId = active.id;
    } else {
      const sprint = sprintsRepo.createSprint(db, { projectId, name: input.feature ?? "New sprint" });
      sprintsRepo.startSprint(db, sprint.id);
      sprintId = sprint.id;
    }
  }

  const created = input.tasks.map((task) =>
    issuesRepo.createIssue(db, {
      projectId,
      type: task.type,
      title: task.title,
      description: task.description,
      status: "backlog",
      priority: task.priority,
      storyPoints: task.storyPoints,
      sprintId,
    }),
  );

  decisionsRepo.createDecision(db, {
    projectId,
    title: `Confirmed AI plan: ${input.feature ?? "Untitled feature"}`,
    description: `Created ${created.length} issue(s): ${created.map((i) => i.key).join(", ")}`,
  });

  return { issues: created, sprintId };
}
