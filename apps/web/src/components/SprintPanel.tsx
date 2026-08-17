import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button, Field, inputClass } from "./ui.js";
import { BurndownChart } from "./BurndownChart.js";

export function SprintPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const sprintsQuery = useQuery({ queryKey: ["sprints", projectId], queryFn: () => api.listSprints(projectId) });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");

  const createMutation = useMutation({
    mutationFn: () => api.createSprint({ projectId, name, goal: goal || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sprints", projectId] });
      setName("");
      setGoal("");
      setCreating(false);
    },
  });
  const startMutation = useMutation({
    mutationFn: (id: string) => api.startSprint(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sprints", projectId] });
      queryClient.invalidateQueries({ queryKey: ["state", projectId] });
      queryClient.invalidateQueries({ queryKey: ["burndown"] });
    },
  });
  const completeMutation = useMutation({
    mutationFn: (id: string) => api.completeSprint(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sprints", projectId] });
      queryClient.invalidateQueries({ queryKey: ["state", projectId] });
      queryClient.invalidateQueries({ queryKey: ["burndown"] });
    },
  });

  const active = sprintsQuery.data?.find((s) => s.status === "active");
  const planned = sprintsQuery.data?.filter((s) => s.status === "planned") ?? [];

  const burndownQuery = useQuery({
    queryKey: ["burndown", active?.id],
    queryFn: () => api.getSprintBurndown(active!.id),
    enabled: !!active,
  });

  return (
    <div className="flex flex-col gap-3">
      {active && (
        <div className="rounded-sm border border-accent/30 bg-accent-soft p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display text-sm font-semibold text-ink">{active.name}</p>
              {active.goal && <p className="text-xs text-ink-muted">{active.goal}</p>}
            </div>
            <Button variant="default" onClick={() => completeMutation.mutate(active.id)}>
              Complete sprint
            </Button>
          </div>
          {burndownQuery.data && (
            <div className="mt-3 border-t border-accent/20 pt-3">
              <BurndownChart burndown={burndownQuery.data} />
            </div>
          )}
        </div>
      )}

      {planned.map((s) => (
        <div key={s.id} className="flex items-center justify-between rounded-sm border border-border-subtle p-3">
          <span className="text-sm text-ink">{s.name}</span>
          <Button variant="default" onClick={() => startMutation.mutate(s.id)}>
            Start
          </Button>
        </div>
      ))}

      {!active && !creating && (
        <Button variant="default" onClick={() => setCreating(true)}>
          + New sprint
        </Button>
      )}

      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createMutation.mutate();
          }}
          className="rounded-sm border border-border-subtle p-3"
        >
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Goal (optional)">
            <input className={inputClass} value={goal} onChange={(e) => setGoal(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
