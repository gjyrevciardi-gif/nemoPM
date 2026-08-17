import { DEFAULT_RISK_THRESHOLDS } from "@ai-pm/shared";
import type { ComputedRisk, Issue, IssueDependency, RiskThresholds, Sprint } from "@ai-pm/shared";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Re-exported for backward compatibility; prefer DEFAULT_RISK_THRESHOLDS for new code.
export const STALE_MEDIUM_DAYS = DEFAULT_RISK_THRESHOLDS.staleMediumDays;
export const STALE_HIGH_DAYS = DEFAULT_RISK_THRESHOLDS.staleHighDays;
export const SPRINT_MIN_DAYS_BEFORE_FLAG = DEFAULT_RISK_THRESHOLDS.sprintMinDaysBeforeFlag;
export const SPRINT_PACE_RATIO_THRESHOLD = DEFAULT_RISK_THRESHOLDS.sprintPaceRatioThreshold;

export interface RiskEngineInput {
  issues: Issue[];
  dependencies: IssueDependency[];
  activeSprint: Sprint | null;
  /** issueId -> ISO timestamp of the most recent activity for that issue, if any. */
  lastActivityAtByIssue: Record<string, string | null>;
  now: Date;
  /** Defaults to DEFAULT_RISK_THRESHOLDS when omitted. */
  thresholds?: RiskThresholds;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getTime() - from.getTime()) / MS_PER_DAY);
}

function issueLastActivity(issue: Issue, lastActivityAtByIssue: Record<string, string | null>): Date {
  const fromActivity = lastActivityAtByIssue[issue.id];
  const candidate = fromActivity ?? issue.startedAt ?? issue.updatedAt;
  return new Date(candidate);
}

/**
 * STALE TASK RULE
 * IF issue.status == in_progress AND no relevant activity for > STALE_MEDIUM_DAYS
 * THEN create a stale_task risk. Severity escalates to "high" past STALE_HIGH_DAYS.
 */
function computeStaleTaskRisks(input: RiskEngineInput): ComputedRisk[] {
  const thresholds = input.thresholds ?? DEFAULT_RISK_THRESHOLDS;
  const risks: ComputedRisk[] = [];
  for (const issue of input.issues) {
    if (issue.status !== "in_progress") continue;
    const lastActivity = issueLastActivity(issue, input.lastActivityAtByIssue);
    const daysSince = daysBetween(lastActivity, input.now);
    if (daysSince <= thresholds.staleMediumDays) continue;

    const severity = daysSince > thresholds.staleHighDays ? "high" : "medium";
    risks.push({
      type: "stale_task",
      severity,
      issueId: issue.id,
      message: `${issue.key} has been in progress with no activity for ${Math.floor(daysSince)} day(s).`,
      evidence: [
        `${issue.key} status: in_progress`,
        `Last activity: ${lastActivity.toISOString()} (${Math.floor(daysSince)} day(s) ago)`,
      ],
      dedupeKey: `stale_task:${issue.id}`,
    });
  }
  return risks;
}

/**
 * BLOCKED DEPENDENCY RULE
 * IF issue A depends on issue B AND B != done AND A is in the current sprint
 * THEN create a dependency risk.
 */
function computeDependencyRisks(input: RiskEngineInput): ComputedRisk[] {
  if (!input.activeSprint) return [];
  const risks: ComputedRisk[] = [];
  const issuesById = new Map(input.issues.map((i) => [i.id, i]));

  for (const dep of input.dependencies) {
    const issue = issuesById.get(dep.issueId);
    const dependsOn = issuesById.get(dep.dependsOnIssueId);
    if (!issue || !dependsOn) continue;
    if (issue.sprintId !== input.activeSprint.id) continue;
    if (dependsOn.status === "done") continue;

    const severity = issue.status === "in_progress" ? "high" : "medium";
    risks.push({
      type: "dependency",
      severity,
      issueId: issue.id,
      message: `${issue.key} depends on unfinished ${dependsOn.key}.`,
      evidence: [`${dependsOn.key} status: ${dependsOn.status}`, `${issue.key} status: ${issue.status}`],
      dedupeKey: `dependency:${issue.id}:${dependsOn.id}`,
    });
  }
  return risks;
}

/**
 * SPRINT OVERLOAD RULE
 * Compares remaining story points in the active sprint against the pace at
 * which points have been completed so far. If, at the observed pace,
 * finishing the remaining work would take significantly longer than the
 * time already spent in the sprint, flag a sprint_delivery risk.
 */
function computeSprintDeliveryRisk(input: RiskEngineInput): ComputedRisk[] {
  const thresholds = input.thresholds ?? DEFAULT_RISK_THRESHOLDS;
  const sprint = input.activeSprint;
  if (!sprint || !sprint.startedAt) return [];

  const sprintIssues = input.issues.filter((i) => i.sprintId === sprint.id);
  if (sprintIssues.length === 0) return [];

  const completedPoints = sprintIssues
    .filter((i) => i.status === "done")
    .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const remainingPoints = sprintIssues
    .filter((i) => i.status !== "done")
    .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  if (remainingPoints <= 0) return [];

  const daysSinceStart = Math.max(1, daysBetween(new Date(sprint.startedAt), input.now));
  if (daysSinceStart < thresholds.sprintMinDaysBeforeFlag) return [];

  const pace = completedPoints / daysSinceStart;

  if (pace === 0) {
    return [
      {
        type: "sprint_delivery",
        severity: "high",
        issueId: null,
        message: `${sprint.name} has ${remainingPoints} point(s) remaining with no completed points after ${Math.floor(daysSinceStart)} day(s).`,
        evidence: [
          `Sprint started: ${sprint.startedAt}`,
          `Completed points: ${completedPoints}`,
          `Remaining points: ${remainingPoints}`,
        ],
        dedupeKey: `sprint_delivery:${sprint.id}`,
      },
    ];
  }

  const projectedRemainingDays = remainingPoints / pace;
  if (projectedRemainingDays > daysSinceStart * thresholds.sprintPaceRatioThreshold) {
    const severity =
      projectedRemainingDays > daysSinceStart * thresholds.sprintPaceRatioThreshold * 1.5 ? "high" : "medium";
    return [
      {
        type: "sprint_delivery",
        severity,
        issueId: null,
        message: `${sprint.name} is tracking behind pace: ${remainingPoints} point(s) remain at a completion rate of ${pace.toFixed(2)} pts/day.`,
        evidence: [
          `Sprint started: ${sprint.startedAt} (${Math.floor(daysSinceStart)} day(s) ago)`,
          `Completed points: ${completedPoints}`,
          `Remaining points: ${remainingPoints}`,
          `Observed pace: ${pace.toFixed(2)} pts/day`,
        ],
        dedupeKey: `sprint_delivery:${sprint.id}`,
      },
    ];
  }

  return [];
}

export function computeRisks(input: RiskEngineInput): ComputedRisk[] {
  return [
    ...computeStaleTaskRisks(input),
    ...computeDependencyRisks(input),
    ...computeSprintDeliveryRisk(input),
  ];
}
