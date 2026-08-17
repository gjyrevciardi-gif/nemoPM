import type { Activity } from "@ai-pm/shared";

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatActivity(activity: Activity): string {
  const p = activity.payload as Record<string, any>;
  switch (activity.type) {
    case "issue.created":
      return `${p.key ?? "Issue"} created: "${p.title ?? ""}"`;
    case "issue.started":
      return `${p.key ?? "Issue"} started`;
    case "issue.completed":
      return `${p.key ?? "Issue"} completed`;
    case "issue.status_changed":
      return `Status changed: ${p.from ?? "?"} → ${p.to ?? "?"}`;
    case "issue.updated":
      return `Issue updated`;
    case "sprint.created":
      return `Sprint "${p.name ?? ""}" created`;
    case "sprint.started":
      return `Sprint "${p.name ?? ""}" started`;
    case "sprint.completed":
      return `Sprint "${p.name ?? ""}" completed`;
    case "git.scan":
      return p.ok === false
        ? `Git scan failed: ${p.error ?? "unknown error"}`
        : `Git scan: ${p.newCommits ?? 0} new commit(s) on ${p.branch ?? "branch"}${p.linkedIssue ? ` → linked to ${p.linkedIssue}` : ""}`;
    case "git.branch_detected":
      return `Branch changed to ${p.branch ?? "?"}`;
    case "git.commit_detected":
      return `Commit ${p.hash ?? ""}: "${p.subject ?? ""}"`;
    case "git.files_changed":
      return `${(p.files?.length as number) ?? 0} file(s) changed in ${p.hash ?? "commit"}`;
    case "ai.status_requested":
      return `AI PM status requested (${p.source === "fallback" ? "offline summary" : p.model ?? "AI"})`;
    case "ai.plan_generated":
      return `AI plan generated: "${p.feature ?? ""}" (${p.taskCount ?? 0} tasks)`;
    case "risk.detected":
      return `Risk detected: ${p.message ?? p.type ?? ""}`;
    case "risk.resolved":
      return `Risk resolved: ${p.message ?? p.type ?? ""}`;
    case "dependency.added":
      return `Dependency added`;
    case "dependency.removed":
      return `Dependency removed`;
    default:
      return activity.type;
  }
}

export function activityIcon(activity: Activity): string {
  if (activity.type.startsWith("git.")) return "⎇";
  if (activity.type.startsWith("risk.")) return "▲";
  if (activity.type.startsWith("ai.")) return "✦";
  if (activity.type.startsWith("sprint.")) return "◷";
  if (activity.type.startsWith("dependency.")) return "⇢";
  return "•";
}
