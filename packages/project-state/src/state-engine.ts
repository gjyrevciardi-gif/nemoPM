import { DEFAULT_RISK_THRESHOLDS } from "@ai-pm/shared";
import type {
  DependencyStatus,
  GitStatus,
  Issue,
  IssueDependency,
  Project,
  ProjectMetrics,
  ProjectState,
  Risk,
  RiskThresholds,
  Sprint,
  StaleIssue,
} from "@ai-pm/shared";

export interface ProjectStateInput {
  project: Project;
  /** All issues belonging to the project. */
  issues: Issue[];
  activeSprint: Sprint | null;
  /** All dependency edges for issues in the project. */
  dependencies: IssueDependency[];
  git: GitStatus;
  /** issueId -> ISO timestamp of the most recent activity for that issue, if any. */
  lastActivityAtByIssue: Record<string, string | null>;
  /** Currently open risks, already reconciled by the risk engine + risk repository. */
  risks: Risk[];
  now: Date;
  /** Defaults to DEFAULT_RISK_THRESHOLDS when omitted. */
  thresholds?: RiskThresholds;
}

function pickActiveIssue(issues: Issue[]): Issue | null {
  const inProgress = issues.filter((i) => i.status === "in_progress");
  if (inProgress.length === 0) return null;
  return [...inProgress].sort((a, b) => {
    const aTime = new Date(a.startedAt ?? a.updatedAt).getTime();
    const bTime = new Date(b.startedAt ?? b.updatedAt).getTime();
    return bTime - aTime;
  })[0]!;
}

function computeMetrics(issues: Issue[], activeSprint: Sprint | null, allIssues: Issue[]): ProjectMetrics {
  const scope: ProjectMetrics["scope"] = activeSprint ? "sprint" : "project";
  const scoped = activeSprint ? allIssues.filter((i) => i.sprintId === activeSprint.id) : issues;

  const totalIssues = scoped.length;
  const completedIssues = scoped.filter((i) => i.status === "done").length;
  const totalPoints = scoped.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const completedPoints = scoped
    .filter((i) => i.status === "done")
    .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  return {
    totalIssues,
    completedIssues,
    remainingIssues: totalIssues - completedIssues,
    totalPoints,
    completedPoints,
    remainingPoints: totalPoints - completedPoints,
    scope,
  };
}

function computeDependencyStatuses(issues: Issue[], dependencies: IssueDependency[]): DependencyStatus[] {
  const issuesById = new Map(issues.map((i) => [i.id, i]));
  const statuses: DependencyStatus[] = [];
  for (const dep of dependencies) {
    const issue = issuesById.get(dep.issueId);
    const dependsOn = issuesById.get(dep.dependsOnIssueId);
    if (!issue || !dependsOn) continue;
    statuses.push({
      issueId: issue.id,
      issueKey: issue.key,
      issueTitle: issue.title,
      dependsOnIssueId: dependsOn.id,
      dependsOnKey: dependsOn.key,
      dependsOnTitle: dependsOn.title,
      dependsOnStatus: dependsOn.status,
      satisfied: dependsOn.status === "done",
    });
  }
  return statuses;
}

function computeStaleIssues(
  issues: Issue[],
  lastActivityAtByIssue: Record<string, string | null>,
  now: Date,
  thresholds: RiskThresholds,
): StaleIssue[] {
  const stale: StaleIssue[] = [];
  for (const issue of issues) {
    if (issue.status !== "in_progress") continue;
    const lastActivityAt = lastActivityAtByIssue[issue.id] ?? issue.startedAt ?? issue.updatedAt;
    const daysSince = Math.max(0, (now.getTime() - new Date(lastActivityAt).getTime()) / (24 * 60 * 60 * 1000));
    if (daysSince <= thresholds.staleMediumDays) continue;
    stale.push({
      issueId: issue.id,
      issueKey: issue.key,
      title: issue.title,
      status: issue.status,
      daysSinceActivity: Math.floor(daysSince),
      lastActivityAt,
    });
  }
  return stale;
}

export function computeProjectState(input: ProjectStateInput): ProjectState {
  const thresholds = input.thresholds ?? DEFAULT_RISK_THRESHOLDS;
  const activeIssue = pickActiveIssue(input.issues);
  const metrics = computeMetrics(input.issues, input.activeSprint, input.issues);
  const dependencies = computeDependencyStatuses(input.issues, input.dependencies);
  const staleIssues = computeStaleIssues(input.issues, input.lastActivityAtByIssue, input.now, thresholds);

  return {
    project: input.project,
    activeIssue,
    sprint: input.activeSprint,
    metrics,
    git: input.git,
    dependencies,
    staleIssues,
    risks: input.risks,
    generatedAt: input.now.toISOString(),
  };
}
