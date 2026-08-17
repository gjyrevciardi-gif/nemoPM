import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueType, Priority } from "@ai-pm/shared";
import { api } from "../lib/api.js";
import { Button, Modal, PriorityMark, StatusBadge, TypeIcon, inputClass } from "./ui.js";
import { ActivityFeed } from "./ActivityFeed.js";
import { formatRelativeTime } from "../lib/format.js";

const TYPES: IssueType[] = ["epic", "story", "task", "bug", "subtask"];
const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

export function IssueDetailModal({
  issueId,
  projectId,
  onClose,
}: {
  issueId: string | null;
  projectId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const open = !!issueId;

  const issueQuery = useQuery({
    queryKey: ["issue", issueId],
    queryFn: () => api.getIssue(issueId!),
    enabled: open,
  });
  const depsQuery = useQuery({
    queryKey: ["dependencies", issueId],
    queryFn: () => api.listDependencies(issueId!),
    enabled: open,
  });
  const allIssuesQuery = useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => api.listIssues(projectId),
    enabled: open,
  });
  const codeLinksQuery = useQuery({
    queryKey: ["code-links", issueId],
    queryFn: () => api.listCodeLinks(issueId!),
    enabled: open,
  });
  const activityQuery = useQuery({
    queryKey: ["issue-activity", issueId],
    queryFn: () => api.listIssueActivity(projectId, issueId!, 50),
    enabled: open,
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<IssueType>("task");
  const [priority, setPriority] = useState<Priority>("medium");
  const [storyPoints, setStoryPoints] = useState("");
  const [depTarget, setDepTarget] = useState("");

  useEffect(() => {
    if (issueQuery.data) {
      setTitle(issueQuery.data.title);
      setDescription(issueQuery.data.description ?? "");
      setType(issueQuery.data.type);
      setPriority(issueQuery.data.priority);
      setStoryPoints(issueQuery.data.storyPoints?.toString() ?? "");
    }
  }, [issueQuery.data]);

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
    queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
    queryClient.invalidateQueries({ queryKey: ["state", projectId] });
    queryClient.invalidateQueries({ queryKey: ["issue-activity", issueId] });
    queryClient.invalidateQueries({ queryKey: ["activity", projectId] });
    queryClient.invalidateQueries({ queryKey: ["burndown"] });
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateIssue(issueId!, {
        title,
        description: description || null,
        type,
        priority,
        storyPoints: storyPoints ? Number(storyPoints) : null,
      }),
    onSuccess: invalidateAll,
  });

  const startMutation = useMutation({ mutationFn: () => api.startIssue(issueId!), onSuccess: invalidateAll });
  const reviewMutation = useMutation({ mutationFn: () => api.reviewIssue(issueId!), onSuccess: invalidateAll });
  const completeMutation = useMutation({
    mutationFn: () => api.completeIssue(issueId!),
    onSuccess: invalidateAll,
  });
  const deleteMutation = useMutation({
    mutationFn: () => api.deleteIssue(issueId!),
    onSuccess: () => {
      invalidateAll();
      onClose();
    },
  });
  const addDepMutation = useMutation({
    mutationFn: () => api.addDependency(issueId!, { dependsOnIssueId: depTarget }),
    onSuccess: () => {
      setDepTarget("");
      queryClient.invalidateQueries({ queryKey: ["dependencies", issueId] });
      queryClient.invalidateQueries({ queryKey: ["state", projectId] });
    },
  });
  const removeDepMutation = useMutation({
    mutationFn: (depId: string) => api.removeDependency(issueId!, depId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dependencies", issueId] });
      queryClient.invalidateQueries({ queryKey: ["state", projectId] });
    },
  });

  const issue = issueQuery.data;
  const issuesById = new Map((allIssuesQuery.data ?? []).map((i) => [i.id, i]));
  const eligibleDepTargets = (allIssuesQuery.data ?? []).filter(
    (i) => i.id !== issueId && !depsQuery.data?.some((d) => d.dependsOnIssueId === i.id),
  );

  return (
    <Modal open={open} onClose={onClose} title={issue ? `${issue.key}` : "Issue"} wide>
      {!issue ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={issue.status} />
            <TypeIcon type={issue.type} />
            <PriorityMark priority={issue.priority} />
            <div className="ml-auto flex gap-2">
              {issue.status !== "in_progress" && issue.status !== "done" && (
                <Button variant="default" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                  Start
                </Button>
              )}
              {issue.status === "in_progress" && (
                <Button variant="default" onClick={() => reviewMutation.mutate()} disabled={reviewMutation.isPending}>
                  Move to review
                </Button>
              )}
              {issue.status !== "done" && (
                <Button
                  variant="primary"
                  onClick={() => completeMutation.mutate()}
                  disabled={completeMutation.isPending}
                >
                  Complete
                </Button>
              )}
              <Button
                variant="danger"
                onClick={() => {
                  if (confirm(`Delete ${issue.key}? This cannot be undone.`)) deleteMutation.mutate();
                }}
              >
                Delete
              </Button>
            </div>
          </div>

          {/* Editable fields */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <input className={`${inputClass} font-display text-base`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <textarea
                className={inputClass}
                rows={3}
                placeholder="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as IssueType)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              type="number"
              min={0}
              max={100}
              placeholder="Story points"
              value={storyPoints}
              onChange={(e) => setStoryPoints(e.target.value)}
            />
            <div className="flex items-center">
              <Button
                variant="default"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="w-full"
              >
                {saveMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>

          {/* Dependencies */}
          <div>
            <h4 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Dependencies
            </h4>
            <ul className="mb-2 flex flex-col gap-1.5">
              {(depsQuery.data ?? []).map((dep) => {
                const target = issuesById.get(dep.dependsOnIssueId);
                return (
                  <li key={dep.id} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-ink-faint">{target?.key ?? "?"}</span>
                    <span className="flex-1 text-ink-muted">{target?.title ?? "Unknown issue"}</span>
                    {target && <StatusBadge status={target.status} />}
                    <button
                      className="text-ink-faint hover:text-risk-high"
                      onClick={() => removeDepMutation.mutate(dep.id)}
                    >
                      remove
                    </button>
                  </li>
                );
              })}
              {(depsQuery.data ?? []).length === 0 && (
                <li className="text-sm text-ink-faint">No dependencies.</li>
              )}
            </ul>
            <div className="flex gap-2">
              <select className={inputClass} value={depTarget} onChange={(e) => setDepTarget(e.target.value)}>
                <option value="">Depends on…</option>
                {eligibleDepTargets.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.key} — {i.title}
                  </option>
                ))}
              </select>
              <Button
                variant="default"
                onClick={() => addDepMutation.mutate()}
                disabled={!depTarget || addDepMutation.isPending}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Git activity */}
          <div>
            <h4 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Git activity
            </h4>
            {(codeLinksQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-faint">No linked commits yet. Run a Git scan once you've committed.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {(codeLinksQuery.data ?? []).map((link) => (
                  <li key={link.id} className="flex items-baseline gap-2 text-xs">
                    <span className="font-mono text-ink-faint">{link.commitHash.slice(0, 7)}</span>
                    <span className="flex-1 truncate text-ink-muted">{link.subject}</span>
                    <span className="text-ink-faint">
                      {link.committedAt ? formatRelativeTime(link.committedAt) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Activity history */}
          <div>
            <h4 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-ink-muted">
              History
            </h4>
            <ActivityFeed activities={activityQuery.data ?? []} />
          </div>
        </div>
      )}
    </Modal>
  );
}
