import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { AgentChat } from "../components/AgentChat.js";

/**
 * The project's AI tab. Everything of substance lives in AgentChat, which
 * talks to the same agent endpoint the VS Code panel uses; this page only
 * supplies the project and a run-history sidebar for auditing what NEMO did.
 */
export default function AgentPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const runsQuery = useQuery({
    queryKey: ["agent-runs", projectId],
    queryFn: () => api.listAgentRuns(projectId!, 15),
    enabled: !!projectId,
  });

  if (!projectId) return null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
      <AgentChat projectId={projectId} />

      <aside className="hidden lg:block">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">Recent agent runs</p>
        {runsQuery.data && runsQuery.data.length > 0 ? (
          <ul className="space-y-2">
            {runsQuery.data.map((run) => (
              <li key={run.id} className="card p-3">
                <p className="line-clamp-2 text-xs text-ink">{run.requestText}</p>
                <p className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ink-faint">
                  <span className={statusColor(run.status)}>{run.status}</span>
                  <span>{run.actions.length} action(s)</span>
                  {run.model && <span className="truncate">{run.model}</span>}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-faint">
            Every proposal NEMO makes is recorded here with the tools it called and what you decided.
          </p>
        )}
      </aside>
    </div>
  );
}

function statusColor(status: string): string {
  if (status === "applied") return "text-status-done";
  if (status === "failed") return "text-risk-high";
  if (status === "rejected" || status === "expired") return "text-ink-muted";
  return "text-risk-medium";
}
