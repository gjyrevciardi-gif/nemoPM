import type { GitStatus } from "@ai-pm/shared";
import { formatRelativeTime } from "../lib/format.js";

export function GitStatusCard({ git }: { git: GitStatus }) {
  if (!git.connected) {
    return (
      <div className="text-sm text-ink-muted">
        <p>Not connected.</p>
        {git.error && <p className="mt-1 font-mono text-xs text-ink-faint">{git.error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 font-mono text-sm">
        <span className="text-ink-faint">⎇</span>
        <span className="text-ink">{git.branch ?? "detached HEAD"}</span>
        <span className={`ml-auto text-xs ${git.isClean ? "text-status-done" : "text-accent"}`}>
          {git.isClean ? "clean" : "uncommitted changes"}
        </span>
      </div>
      {git.recentCommits.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {git.recentCommits.slice(0, 5).map((c) => (
            <li key={c.hash} className="flex items-baseline gap-2 text-xs">
              <span className="font-mono text-ink-faint">{c.shortHash}</span>
              <span className="truncate text-ink-muted">{c.subject}</span>
              <span className="ml-auto shrink-0 text-ink-faint">{formatRelativeTime(c.timestamp)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-ink-faint">No commits found.</p>
      )}
    </div>
  );
}
