import type { Issue, Sprint, SprintBurndown } from "@ai-pm/shared";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function startOfDayUtc(iso: string): number {
  return new Date(`${toDateOnly(iso)}T00:00:00.000Z`).getTime();
}

/**
 * Reconstructs remaining-points-per-day for a sprint from each issue's single
 * `completedAt` timestamp. This only reflects the latest completion, so an
 * issue that was completed then reopened will undercount past reopens.
 */
export function computeBurndown(sprint: Sprint, issues: Issue[], now: Date): SprintBurndown {
  const totalPoints = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  if (!sprint.startedAt) {
    return { sprintId: sprint.id, totalPoints, points: [] };
  }

  const startMs = startOfDayUtc(sprint.startedAt);
  const endMs = startOfDayUtc(sprint.completedAt ?? now.toISOString());
  const dayCount = Math.max(0, Math.round((endMs - startMs) / MS_PER_DAY));

  const points: SprintBurndown["points"] = [];
  for (let d = 0; d <= dayCount; d++) {
    const dayStart = startMs + d * MS_PER_DAY;
    const dayEnd = dayStart + MS_PER_DAY - 1;
    const completedPoints = issues
      .filter((i) => i.completedAt && new Date(i.completedAt).getTime() <= dayEnd)
      .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
    points.push({
      date: toDateOnly(new Date(dayStart).toISOString()),
      remainingPoints: totalPoints - completedPoints,
      completedPoints,
    });
  }

  return { sprintId: sprint.id, totalPoints, points };
}
