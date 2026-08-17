import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Spinner, StatusBadge } from "../components/ui.js";
import { RiskList } from "../components/RiskList.js";
import { GitStatusCard } from "../components/GitStatusCard.js";
import { AiStatusPanel } from "../components/AiStatusPanel.js";
import { ActivityFeed } from "../components/ActivityFeed.js";

function Panel({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>();
  const stateQuery = useQuery({
    queryKey: ["state", id],
    queryFn: () => api.getProjectState(id!),
    enabled: !!id,
    refetchInterval: 15_000,
  });
  const activityQuery = useQuery({
    queryKey: ["activity", id, 8],
    queryFn: () => api.listActivity(id!, 8),
    enabled: !!id,
  });

  if (stateQuery.isLoading || !stateQuery.data) {
    return (
      <div className="flex justify-center py-24 text-ink-faint">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const state = stateQuery.data;
  const pct =
    state.metrics.totalPoints > 0
      ? Math.round((state.metrics.completedPoints / state.metrics.totalPoints) * 100)
      : 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Panel title={state.sprint ? `Sprint · ${state.sprint.name}` : "Progress · No active sprint"}>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="font-display text-2xl font-semibold text-ink">
              {state.metrics.completedPoints}
              <span className="text-ink-faint"> / {state.metrics.totalPoints} pts</span>
            </span>
            <span className="text-sm text-ink-muted">
              {state.metrics.completedIssues}/{state.metrics.totalIssues} issues done
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface3">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
        </Panel>

        <Panel title="Active task">
          {state.activeIssue ? (
            <div className="flex items-start gap-3">
              <span className="signal-dot mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-ink-faint">{state.activeIssue.key}</span>
                  <StatusBadge status={state.activeIssue.status} />
                </div>
                <p className="mt-1 font-display text-base font-medium text-ink">{state.activeIssue.title}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">No issue is currently in progress.</p>
          )}
        </Panel>

        <Panel title="Ask AI PM">
          <AiStatusPanel projectId={id!} />
        </Panel>
      </div>

      <div className="flex flex-col gap-6">
        <Panel
          title="Risks"
          right={
            state.risks.length > 0 ? (
              <span className="rounded-sm bg-risk-high/15 px-1.5 py-0.5 text-[11px] font-medium text-risk-high">
                {state.risks.length}
              </span>
            ) : null
          }
        >
          <RiskList risks={state.risks} />
        </Panel>

        <Panel title="Git">
          <GitStatusCard git={state.git} />
        </Panel>

        <Panel
          title="Recent activity"
          right={
            <Link to={`/projects/${id}/activity`} className="text-xs text-accent hover:underline">
              View all
            </Link>
          }
        >
          <ActivityFeed activities={activityQuery.data ?? []} />
        </Panel>
      </div>
    </div>
  );
}
