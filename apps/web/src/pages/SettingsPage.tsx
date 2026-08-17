import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RiskThresholds } from "@ai-pm/shared";
import { api } from "../lib/api.js";
import { Button, Field, Spinner, inputClass } from "../components/ui.js";

const FIELDS: { key: keyof RiskThresholds; label: string; help: string; step: string }[] = [
  {
    key: "staleMediumDays",
    label: "Stale task (medium) — days",
    help: "An in-progress task with no activity for longer than this is flagged as a medium-severity risk.",
    step: "0.5",
  },
  {
    key: "staleHighDays",
    label: "Stale task (high) — days",
    help: "Past this many days of inactivity, the stale-task risk escalates to high severity.",
    step: "0.5",
  },
  {
    key: "sprintMinDaysBeforeFlag",
    label: "Sprint minimum days before flagging",
    help: "A sprint must have run at least this many days before a delivery-pace risk can fire.",
    step: "0.5",
  },
  {
    key: "sprintPaceRatioThreshold",
    label: "Sprint pace ratio threshold",
    help: "If finishing the remaining points at the observed pace would take more than this multiple of the time already spent, the sprint is flagged as behind pace.",
    step: "0.1",
  },
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const thresholdsQuery = useQuery({
    queryKey: ["settings", "risk-thresholds"],
    queryFn: () => api.getRiskThresholds(),
  });

  const [form, setForm] = useState<RiskThresholds | null>(null);

  useEffect(() => {
    if (thresholdsQuery.data) setForm(thresholdsQuery.data);
  }, [thresholdsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: RiskThresholds) => api.updateRiskThresholds(input),
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "risk-thresholds"], data);
    },
  });

  if (thresholdsQuery.isLoading || !form) {
    return (
      <div className="flex justify-center py-24 text-ink-faint">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <section className="card p-5">
        <h3 className="mb-1 font-display text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Risk thresholds
        </h3>
        <p className="mb-4 text-sm text-ink-muted">
          Tune how sensitive the deterministic risk engine is. Applies to all projects on this machine.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (form) saveMutation.mutate(form);
          }}
        >
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <input
                type="number"
                step={f.step}
                min="0"
                className={inputClass}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
              />
              <span className="mt-1 block text-xs text-ink-faint">{f.help}</span>
            </Field>
          ))}

          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" variant="primary" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => thresholdsQuery.data && setForm(thresholdsQuery.data)}
              disabled={saveMutation.isPending}
            >
              Reset
            </Button>
            {saveMutation.isSuccess && <span className="text-xs text-status-done">Saved.</span>}
          </div>
        </form>
      </section>
    </div>
  );
}
