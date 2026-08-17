import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import type { Project, RiskThresholds } from "@ai-pm/shared";
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
  return (
    <div className="flex max-w-lg flex-col gap-6">
      <ProjectSection />
      <RiskThresholdsSection />
    </div>
  );
}

function ProjectSection() {
  const { id: projectId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId!),
    enabled: !!projectId,
  });

  const [form, setForm] = useState<{ name: string; description: string; repositoryPath: string } | null>(null);

  useEffect(() => {
    if (projectQuery.data) {
      setForm({
        name: projectQuery.data.name,
        description: projectQuery.data.description ?? "",
        repositoryPath: projectQuery.data.repositoryPath ?? "",
      });
    }
  }, [projectQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.updateProject(projectId!, {
        name: form!.name,
        description: form!.description || null,
        repositoryPath: form!.repositoryPath || null,
      }),
    onSuccess: (data: Project) => {
      queryClient.setQueryData(["project", projectId], data);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteProject(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate("/");
    },
  });

  if (projectQuery.isLoading || !form) {
    return (
      <div className="flex justify-center py-8 text-ink-faint">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <section className="card p-5">
      <h3 className="mb-1 font-display text-sm font-semibold uppercase tracking-wide text-ink-muted">Project</h3>
      <p className="mb-4 text-sm text-ink-muted">Rename this project, update its description, or change the
        connected repository path.</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) saveMutation.mutate();
        }}
      >
        <Field label="Name">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Description">
          <textarea
            className={inputClass}
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <Field label="Repository path">
          <input
            className={`${inputClass} font-mono`}
            placeholder="/Users/you/code/acme-saas"
            value={form.repositoryPath}
            onChange={(e) => setForm({ ...form, repositoryPath: e.target.value })}
          />
        </Field>

        {saveMutation.isError && (
          <p className="mb-3 text-sm text-risk-high">{(saveMutation.error as Error).message}</p>
        )}

        <div className="mt-1 flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={!form.name.trim() || saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => projectQuery.data && setForm({
              name: projectQuery.data.name,
              description: projectQuery.data.description ?? "",
              repositoryPath: projectQuery.data.repositoryPath ?? "",
            })}
            disabled={saveMutation.isPending}
          >
            Reset
          </Button>
          {saveMutation.isSuccess && <span className="text-xs text-status-done">Saved.</span>}
        </div>
      </form>

      <div className="mt-6 border-t border-border-subtle pt-4">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-risk-high">Danger zone</h4>
        <p className="mb-3 text-sm text-ink-muted">
          Deletes this project and everything in it — issues, sprints, activity, and risks. This cannot be undone.
        </p>
        {deleteMutation.isError && (
          <p className="mb-3 text-sm text-risk-high">{(deleteMutation.error as Error).message}</p>
        )}
        <Button
          type="button"
          variant="danger"
          disabled={deleteMutation.isPending}
          onClick={() => {
            if (confirm(`Delete "${form.name}"? This cannot be undone.`)) deleteMutation.mutate();
          }}
        >
          {deleteMutation.isPending ? "Deleting…" : "Delete project"}
        </Button>
      </div>
    </section>
  );
}

function RiskThresholdsSection() {
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
      <div className="flex justify-center py-8 text-ink-faint">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
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
  );
}
