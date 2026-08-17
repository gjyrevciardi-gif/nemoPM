import type { Activity } from "@ai-pm/shared";
import { activityIcon, formatActivity, formatRelativeTime } from "../lib/format.js";

export function ActivityFeed({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return <p className="text-sm text-ink-muted">No activity yet.</p>;
  }

  return (
    <ul className="flex flex-col">
      {activities.map((a) => (
        <li key={a.id} className="flex items-start gap-3 border-b border-border-subtle py-2.5 last:border-0">
          <span className="mt-0.5 w-4 shrink-0 text-center font-mono text-xs text-ink-faint">
            {activityIcon(a)}
          </span>
          <span className="flex-1 text-sm text-ink-muted">{formatActivity(a)}</span>
          <span className="shrink-0 text-xs text-ink-faint">{formatRelativeTime(a.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
