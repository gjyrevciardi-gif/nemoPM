import { useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button, PriorityMark, Spinner, StatusBadge, TypeIcon } from "../components/ui.js";
import { SprintPanel } from "../components/SprintPanel.js";
import { AiPlanPanel } from "../components/AiPlanPanel.js";
import { CreateIssueModal } from "../components/CreateIssueModal.js";
import { IssueDetailModal } from "../components/IssueDetailModal.js";

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <h3 className="mb-4 font-display text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

export default function BacklogPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [createOpen, setCreateOpen] = useState(false);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);

  const issuesQuery = useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => api.listIssues(projectId!),
    enabled: !!projectId,
  });
  const sprintsQuery = useQuery({
    queryKey: ["sprints", projectId],
    queryFn: () => api.listSprints(projectId!),
    enabled: !!projectId,
  });

  if (!projectId) return null;

  const activeSprintId = sprintsQuery.data?.find((s) => s.status === "active")?.id;
  const backlogIssues = (issuesQuery.data ?? []).filter((i) => i.sprintId !== activeSprintId);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-6 lg:col-span-2">
        <Panel title="Backlog">
          <div className="mb-3 flex justify-end">
            <Button variant="default" onClick={() => setCreateOpen(true)}>
              + New issue
            </Button>
          </div>
          {issuesQuery.isLoading ? (
            <div className="flex justify-center py-10 text-ink-faint">
              <Spinner className="h-5 w-5" />
            </div>
          ) : backlogIssues.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing in the backlog.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {backlogIssues.map((issue) => (
                <li key={issue.id}>
                  <button
                    onClick={() => setOpenIssueId(issue.id)}
                    className="flex w-full items-center gap-3 rounded-sm border border-transparent px-2 py-2 text-left hover:border-border-subtle hover:bg-surface2/50"
                  >
                    <span className="font-mono text-xs text-ink-faint">{issue.key}</span>
                    <TypeIcon type={issue.type} />
                    <span className="flex-1 truncate text-sm text-ink">{issue.title}</span>
                    <PriorityMark priority={issue.priority} />
                    {issue.storyPoints != null && (
                      <span className="font-mono text-xs text-ink-faint">{issue.storyPoints}pt</span>
                    )}
                    <StatusBadge status={issue.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="AI: plan a feature">
          <AiPlanPanel projectId={projectId} />
        </Panel>
      </div>

      <div className="flex flex-col gap-6">
        <Panel title="Sprint">
          <SprintPanel projectId={projectId} />
        </Panel>
      </div>

      <CreateIssueModal open={createOpen} onClose={() => setCreateOpen(false)} projectId={projectId} />
      <IssueDetailModal issueId={openIssueId} projectId={projectId} onClose={() => setOpenIssueId(null)} />
    </div>
  );
}
