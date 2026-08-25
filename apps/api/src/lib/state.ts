import type Database from "better-sqlite3";
import {
  activitiesRepo,
  dependenciesRepo,
  issuesRepo,
  projectsRepo,
  repositoriesRepo,
  risksRepo,
  settingsRepo,
  sprintsRepo,
} from "@ai-pm/database";
import { computeGitRisks, computeProjectState, computeRisks } from "@ai-pm/project-state";
import type { ProjectState } from "@ai-pm/shared";
import { getGitStatus } from "./git.js";
import { collectGitSignals } from "./git-signals.js";
import { notFound } from "./errors.js";

export async function buildProjectState(db: Database.Database, projectId: string): Promise<ProjectState> {
  const project = projectsRepo.getProject(db, projectId);
  if (!project) throw notFound("Project", projectId);

  const issues = issuesRepo.listIssuesByProject(db, projectId);
  const activeSprint = sprintsRepo.getActiveSprint(db, projectId);
  const dependencies = dependenciesRepo.listDependenciesForProject(db, projectId);

  const repo = repositoriesRepo.getRepositoryByProject(db, projectId);
  const git = await getGitStatus(repo?.path ?? project.repositoryPath ?? null);

  const lastActivityAtByIssue: Record<string, string | null> = {};
  for (const issue of issues) {
    if (issue.status !== "in_progress") continue;
    lastActivityAtByIssue[issue.id] = activitiesRepo.lastActivityAtForIssue(db, issue.id);
  }

  const now = new Date();
  const thresholds = settingsRepo.getRiskThresholds(db);
  // Two independent sources of truth, deliberately combined rather than merged:
  // the board says what someone claimed, the repository says what was written.
  const signals = await collectGitSignals(db, projectId, repo?.path ?? project.repositoryPath ?? null);
  const computed = [
    ...computeRisks({ issues, dependencies, activeSprint, lastActivityAtByIssue, now, thresholds }),
    ...computeGitRisks({
      issues,
      lastCommitAtByIssue: signals.lastCommitAtByIssue,
      branches: signals.branches,
      now,
      thresholds,
    }),
  ];
  const risks = risksRepo.reconcileRisks(db, projectId, computed);

  return computeProjectState({
    project,
    issues,
    activeSprint,
    dependencies,
    git,
    lastActivityAtByIssue,
    risks,
    now,
    thresholds,
  });
}
