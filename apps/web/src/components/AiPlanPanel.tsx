import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlanTaskResponse } from "@ai-pm/shared";
import { api } from "../lib/api.js";
import { Button, PriorityMark, Spinner, TypeIcon, inputClass } from "./ui.js";

export function AiPlanPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [request, setRequest] = useState("");
  const [plan, setPlan] = useState<PlanTaskResponse | null>(null);
  const [sprintId, setSprintId] = useState<string>("");

  const sprintsQuery = useQuery({ queryKey: ["sprints", projectId], queryFn: () => api.listSprints(projectId) });

  const planMutation = useMutation({
    mutationFn: () => api.planTask(projectId, request),
    onSuccess: (data) => setPlan(data),
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      api.confirmPlan(projectId, {
        tasks: plan!.tasks,
        feature: plan!.feature,
        sprintId: sprintId || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues", projectId] });
      queryClient.invalidateQueries({ queryKey: ["state", projectId] });
      queryClient.invalidateQueries({ queryKey: ["activity", projectId] });
      setPlan(null);
      setRequest("");
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          className={inputClass}
          placeholder='e.g. "Add Google login"'
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && request.trim()) planMutation.mutate();
          }}
        />
        <Button
          variant="primary"
          onClick={() => planMutation.mutate()}
          disabled={!request.trim() || planMutation.isPending}
        >
          {planMutation.isPending ? <Spinner className="h-4 w-4" /> : "Generate plan"}
        </Button>
      </div>

      {planMutation.isError && (
        <p className="text-sm text-risk-high">{(planMutation.error as Error).message}</p>
      )}

      {plan && (
        <div className="rounded-sm border border-border-subtle bg-surface2/60 p-4">
          <p className="font-display text-sm font-semibold text-ink">{plan.feature}</p>
          <p className="mb-3 text-sm text-ink-muted">{plan.summary}</p>

          <ul className="mb-3 flex flex-col gap-2">
            {plan.tasks.map((t, i) => (
              <li key={i} className="flex items-start gap-2 rounded-sm border border-border-subtle p-2 text-sm">
                <TypeIcon type={t.type} />
                <span className="flex-1 text-ink">{t.title}</span>
                <PriorityMark priority={t.priority} />
                <span className="font-mono text-xs text-ink-faint">{t.storyPoints}pt</span>
              </li>
            ))}
          </ul>

          {plan.risks.length > 0 && (
            <div className="mb-2 text-xs text-ink-muted">
              <span className="font-semibold text-ink">Risks: </span>
              {plan.risks.join(", ")}
            </div>
          )}
          {plan.dependencies.length > 0 && (
            <div className="mb-3 text-xs text-ink-muted">
              <span className="font-semibold text-ink">Dependencies: </span>
              {plan.dependencies.join(", ")}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <select className={inputClass} value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
              <option value="">Add to backlog (no sprint)</option>
              {(sprintsQuery.data ?? [])
                .filter((s) => s.status !== "completed")
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => setPlan(null)}>
                Discard
              </Button>
              <Button variant="primary" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                {confirmMutation.isPending ? "Creating…" : `Confirm & create ${plan.tasks.length} issue(s)`}
              </Button>
            </div>
          </div>
          {confirmMutation.isError && (
            <p className="mt-2 text-sm text-risk-high">{(confirmMutation.error as Error).message}</p>
          )}
        </div>
      )}
    </div>
  );
}
