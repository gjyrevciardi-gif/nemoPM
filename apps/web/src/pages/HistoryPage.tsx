import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Activity, Decision, Milestone } from "@ai-pm/shared";
import { api } from "../lib/api.js";
import { Badge, Button, EmptyState, Field, Modal, Spinner, inputClass } from "../components/ui.js";
import { formatActivity, formatRelativeTime } from "../lib/format.js";

/**
 * How the project got here: milestones and decisions a human stands behind,
 * interleaved with the sprint events that actually happened.
 *
 * Nothing on this page is inferred. Git activity is not turned into history --
 * an inferred milestone stays a suggestion until someone confirms it, so the
 * timeline can be trusted as a record rather than a guess.
 */
type TimelineItem = {
  at: string;
  kind: "milestone" | "decision" | "sprint";
  title: string;
  detail?: string | null;
  badge?: string;
};

const SPRINT_EVENTS = new Set(["sprint.created", "sprint.started", "sprint.completed"]);

export default function HistoryPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const milestonesQuery = useQuery({
    queryKey: ["milestones", projectId],
    queryFn: () => api.listMilestones(projectId!, true),
    enabled: !!projectId,
  });
  const decisionsQuery = useQuery({
    queryKey: ["decisions", projectId],
    queryFn: () => api.listDecisions(projectId!),
    enabled: !!projectId,
  });
  const activityQuery = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () => api.listActivity(projectId!, 200),
    enabled: !!projectId,
  });

  const confirm = useMutation({
    mutationFn: (milestoneId: string) => api.confirmMilestone(projectId!, milestoneId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["milestones", projectId] }),
  });
  const complete = useMutation({
    mutationFn: (milestoneId: string) => api.completeMilestone(projectId!, milestoneId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["milestones", projectId] }),
  });

  if (!projectId) return null;

  const milestones = milestonesQuery.data ?? [];
  const suggested = milestones.filter((m) => !m.confirmed);
  const timeline = buildTimeline(
    milestones.filter((m) => m.confirmed),
    decisionsQuery.data ?? [],
    activityQuery.data ?? [],
  );

  const loading = milestonesQuery.isLoading || decisionsQuery.isLoading || activityQuery.isLoading;

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-semibold text-ink">History</h1>
          <p className="text-sm text-ink-muted">
            Milestones, decisions and sprint events, newest first. Only confirmed items appear here.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Add milestone
        </Button>
      </div>

      {suggested.length > 0 && (
        <div className="card mb-5 border-risk-medium/40 p-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-risk-medium">
            Suggested — not part of history until you confirm
          </p>
          <ul className="space-y-2">
            {suggested.map((milestone) => (
              <li key={milestone.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1 text-ink">{milestone.title}</span>
                <Button variant="ghost" onClick={() => confirm.mutate(milestone.id)}>
                  Confirm
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16 text-ink-faint">
          <Spinner className="h-5 w-5" />
        </div>
      ) : timeline.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          description="Milestones you add, decisions you record, and sprint starts and completions will appear here as the project moves."
        />
      ) : (
        <ol className="relative space-y-4 border-l border-border-subtle pl-5">
          {timeline.map((item, index) => (
            <li key={index} className="relative">
              <span
                className={`absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full ${dotColor(item.kind)}`}
                aria-hidden
              />
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-ink">{item.title}</span>
                {item.badge && <Badge className="bg-surface3 text-ink-muted">{item.badge}</Badge>}
                <span className="font-mono text-[11px] text-ink-faint">{formatRelativeTime(item.at)}</span>
              </div>
              {item.detail && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-muted">{item.detail}</p>}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-6">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">Planned milestones</p>
        <ul className="space-y-2">
          {milestones
            .filter((m) => m.confirmed && m.status === "planned")
            .map((milestone) => (
              <li key={milestone.id} className="card flex items-center gap-3 p-3 text-sm">
                <span className="flex-1 text-ink">{milestone.title}</span>
                {milestone.targetDate && (
                  <span className="font-mono text-[11px] text-ink-faint">target {milestone.targetDate.slice(0, 10)}</span>
                )}
                <Button variant="ghost" onClick={() => complete.mutate(milestone.id)}>
                  Mark reached
                </Button>
              </li>
            ))}
        </ul>
      </div>

      <MilestoneModal projectId={projectId} open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function buildTimeline(milestones: Milestone[], decisions: Decision[], activities: Activity[]): TimelineItem[] {
  const items: TimelineItem[] = [];

  for (const milestone of milestones) {
    items.push({
      at: milestone.completedAt ?? milestone.occurredAt,
      kind: "milestone",
      title: milestone.title,
      detail: milestone.description,
      badge: milestone.status === "reached" ? "milestone reached" : "milestone planned",
    });
  }

  for (const decision of decisions) {
    items.push({
      at: decision.decidedAt,
      kind: "decision",
      title: decision.title,
      detail: decision.rationale ?? decision.decision ?? decision.context,
      badge: "decision",
    });
  }

  for (const activity of activities) {
    if (!SPRINT_EVENTS.has(activity.type)) continue;
    items.push({ at: activity.createdAt, kind: "sprint", title: formatActivity(activity), badge: "sprint" });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at));
}

function dotColor(kind: TimelineItem["kind"]): string {
  if (kind === "milestone") return "bg-accent";
  if (kind === "decision") return "bg-status-review";
  return "bg-ink-faint";
}

function MilestoneModal({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [reached, setReached] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api.createMilestone(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
        targetDate: targetDate || undefined,
        status: reached ? "reached" : "planned",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["milestones", projectId] });
      setTitle("");
      setDescription("");
      setTargetDate("");
      setReached(false);
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Add milestone">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) create.mutate();
        }}
      >
        <Field label="Title">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Beta launch"
            autoFocus
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            className={inputClass}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Target date (optional)">
          <input
            type="date"
            className={inputClass}
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </Field>
        <label className="mb-3 flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={reached} onChange={(e) => setReached(e.target.checked)} />
          Already reached
        </label>

        {create.isError && <p className="mb-3 text-sm text-risk-high">{(create.error as Error).message}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!title.trim() || create.isPending}>
            {create.isPending ? "Adding…" : "Add milestone"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
