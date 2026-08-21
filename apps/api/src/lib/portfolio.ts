import type Database from "better-sqlite3";
import {
  activitiesRepo,
  dependenciesRepo,
  issuesRepo,
  projectsRepo,
  settingsRepo,
  sprintsRepo,
} from "@ai-pm/database";
import { computeRisks } from "@ai-pm/project-state";
import { issuesDomain, sprintsDomain } from "@ai-pm/domain";
import type { PortfolioState, ProjectSummary } from "@ai-pm/shared";

/**
 * A deterministic, AI-free view of every project.
 *
 * This is the portfolio's source of truth: the home page renders it directly,
 * and the portfolio agent reasons over it instead of over ten backlogs. That
 * is deliberate -- a cross-project answer has to be checkable by a human
 * reading the same numbers, and no prompt should ever carry every issue in
 * every project.
 *
 * Git is not consulted here. Ten repositories' worth of shell-outs would make
 * a page load slow and flaky; whether a repo is linked at all is enough.
 */
export function buildProjectSummary(db: Database.Database, projectId: string): ProjectSummary {
  const project = projectsRepo.getProjectOrThrow(db, projectId);
  const issues = issuesRepo.listIssuesByProject(db, projectId);
  const dependencies = dependenciesRepo.listDependenciesForProject(db, projectId);
  const activeSprint = sprintsRepo.getActiveSprint(db, projectId);

  const lastActivityAtByIssue: Record<string, string | null> = {};
  for (const issue of issues) {
    if (issue.status !== "in_progress") continue;
    lastActivityAtByIssue[issue.id] = activitiesRepo.lastActivityAtForIssue(db, issue.id);
  }

  const risks = computeRisks({
    issues,
    dependencies,
    activeSprint,
    lastActivityAtByIssue,
    now: new Date(),
    thresholds: settingsRepo.getRiskThresholds(db),
  });

  const doneIssues = issues.filter((i) => i.status === "done");
  const totalPoints = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const donePoints = doneIssues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  // Points are the better measure, but a project that estimates nothing still
  // deserves a progress number rather than a permanent 0%.
  const progressPercent =
    totalPoints > 0
      ? Math.round((donePoints / totalPoints) * 100)
      : issues.length > 0
        ? Math.round((doneIssues.length / issues.length) * 100)
        : 0;

  const blocked = issuesDomain.findBlockedIssues(db, issues, dependencies);
  const staleIssueIds = new Set(risks.filter((r) => r.type === "stale_task").map((r) => r.issueId));
  const lastActivity = activitiesRepo.listActivityByProject(db, projectId, 1)[0] ?? null;

  return {
    projectId: project.id,
    key: project.key,
    name: project.name,
    activeSprint: activeSprint
      ? {
          id: activeSprint.id,
          name: activeSprint.name,
          ...(({ total, completed, remaining }) => ({
            totalPoints: total,
            completedPoints: completed,
            remainingPoints: remaining,
          }))(sprintsDomain.sprintPoints(db, activeSprint.id)),
          startedAt: activeSprint.startedAt,
        }
      : null,
    totalIssues: issues.length,
    openIssues: issues.length - doneIssues.length,
    doneIssues: doneIssues.length,
    inProgressIssues: issues.filter((i) => i.status === "in_progress").length,
    progressPercent,
    repositoryConnected: Boolean(project.repositoryPath),
    blockedIssues: blocked.length,
    risks: {
      high: risks.filter((r) => r.severity === "high").length,
      medium: risks.filter((r) => r.severity === "medium").length,
      low: risks.filter((r) => r.severity === "low").length,
    },
    velocity: sprintsDomain.getVelocity(db, projectId).average,
    staleInProgressIssues: staleIssueIds.size,
    lastActivityAt: lastActivity?.createdAt ?? null,
  };
}

export function buildPortfolioState(db: Database.Database): PortfolioState {
  return {
    generatedAt: new Date().toISOString(),
    projects: projectsRepo.listProjects(db).map((project) => buildProjectSummary(db, project.id)),
  };
}

/** Compact prompt rendering: one line of facts per project, no backlogs. */
export function summarizePortfolioForPrompt(state: PortfolioState): string {
  if (state.projects.length === 0) return "No projects exist yet.";

  return state.projects
    .map((p) => {
      const sprint = p.activeSprint
        ? `sprint "${p.activeSprint.name}" ${p.activeSprint.completedPoints}/${p.activeSprint.totalPoints} pts`
        : "no active sprint";
      return [
        `- ${p.key} (${p.name}): ${sprint}`,
        `progress ${p.progressPercent}%`,
        `${p.openIssues} open / ${p.doneIssues} done`,
        `${p.inProgressIssues} in progress`,
        `${p.blockedIssues} blocked`,
        `risks ${p.risks.high}H/${p.risks.medium}M/${p.risks.low}L`,
        `${p.staleInProgressIssues} stale`,
        p.velocity === null ? "no velocity yet" : `velocity ${p.velocity}`,
        `last activity ${p.lastActivityAt ?? "never"}`,
        p.repositoryConnected ? "repo linked" : "no repo",
      ].join(", ");
    })
    .join("\n");
}
