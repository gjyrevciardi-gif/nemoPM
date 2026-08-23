import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectSummary } from "@ai-pm/shared";
import { api, ApiRequestError } from "../lib/api.js";
import { Button, EmptyState, Field, Modal, Spinner, inputClass } from "../components/ui.js";
import { formatRelativeTime } from "../lib/format.js";

/**
 * The portfolio. Every card is rendered from the deterministic
 * /portfolio/state -- the same numbers the portfolio agent reasons over, so a
 * human can always check its answer against what they see here.
 */
export default function HomePage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: portfolio, isLoading } = useQuery({
    queryKey: ["portfolio"],
    queryFn: api.getPortfolioState,
  });
  const { data: today } = useQuery({ queryKey: ["nemo-today"], queryFn: api.getNemoToday });

  const projects = portfolio?.projects ?? [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-border-subtle px-8 py-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Local-first</p>
            <h1 className="font-display text-2xl font-semibold text-ink">NEMO</h1>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            + New project
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-8 py-10">
        {isLoading ? (
          <div className="flex justify-center py-20 text-ink-faint">
            <Spinner className="h-6 w-6" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create a project, connect a repository, and start tracking work from the board or VS Code."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                Create your first project
              </Button>
            }
          />
        ) : (
          <>
            {today && <NemoTodayPanel today={today} />}
            <PortfolioAsk projectCount={projects.length} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((summary) => (
                <ProjectCard key={summary.projectId} summary={summary} />
              ))}
            </div>
          </>
        )}
      </main>

      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

function NemoTodayPanel({ today }: { today: Awaited<ReturnType<typeof api.getNemoToday>> }) {
  const attention = today.projects.filter((project) => project.needsAttention.length > 0);
  return (
    <section className="card mb-6 p-5">
      <div className="flex items-end justify-between">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">Continuous intelligence</p><h2 className="font-display text-lg font-semibold text-ink">NEMO Today</h2></div>
        <p className="font-mono text-[11px] text-ink-faint">{today.automaticUpdates} automatic · {today.needsApproval} need approval</p>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {attention.length === 0 ? <p className="text-sm text-ink-muted">No project-intelligence items need attention.</p> : attention.slice(0,6).map(project => (
          <Link key={project.projectId} to={`/projects/${project.projectId}/activity`} className="rounded-md border border-border-subtle bg-surface2 p-3 hover:border-accent/40">
            <div className="flex justify-between"><span className="font-medium text-ink">{project.name}</span><span className="font-mono text-[10px] text-ink-faint">{project.changes} events</span></div>
            <p className="mt-1 text-xs text-ink-muted">{project.needsAttention.join(" · ")}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ summary }: { summary: ProjectSummary }) {
  const attention = summary.risks.high > 0 || summary.blockedIssues > 0;

  return (
    <Link
      to={`/projects/${summary.projectId}`}
      className="card group flex flex-col gap-3 p-5 transition-colors hover:border-accent/40"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-ink-faint">{summary.key}</span>
        {summary.repositoryConnected && (
          <span className="rounded-sm bg-surface3 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
            repo linked
          </span>
        )}
      </div>

      <div>
        <h2 className="font-display text-lg font-semibold text-ink group-hover:text-accent">{summary.name}</h2>
        <p className="mt-0.5 text-sm text-ink-muted">
          {summary.activeSprint ? summary.activeSprint.name : "No active sprint"}
        </p>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-mono text-xs text-ink-muted">{summary.progressPercent}%</span>
          <span className="font-mono text-[11px] text-ink-faint">
            {summary.doneIssues}/{summary.totalIssues} done
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface3">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.min(summary.progressPercent, 100)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {summary.risks.high > 0 && (
          <span className="rounded-sm bg-risk-high/15 px-1.5 py-0.5 font-medium text-risk-high">
            {summary.risks.high} high risk
          </span>
        )}
        {summary.risks.medium > 0 && (
          <span className="rounded-sm bg-risk-medium/15 px-1.5 py-0.5 font-medium text-risk-medium">
            {summary.risks.medium} medium
          </span>
        )}
        {summary.blockedIssues > 0 && (
          <span className="rounded-sm bg-surface3 px-1.5 py-0.5 font-medium text-ink-muted">
            {summary.blockedIssues} blocked
          </span>
        )}
        {!attention && summary.activeSprint && (
          <span className="rounded-sm bg-status-done/15 px-1.5 py-0.5 font-medium text-status-done">On track</span>
        )}
      </div>

      <p className="mt-auto font-mono text-[11px] text-ink-faint">
        {summary.lastActivityAt ? `Active ${formatRelativeTime(summary.lastActivityAt)}` : "No activity yet"}
      </p>
    </Link>
  );
}

/**
 * Ask across every project. Read-only by construction: the portfolio agent has
 * no write tools, so a vague question can never quietly change several
 * projects at once.
 */
function PortfolioAsk({ projectCount }: { projectCount: number }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = useMutation({
    mutationFn: (message: string) => api.askPortfolio(message),
    onSuccess: (result) => {
      setAnswer(result.reply);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiRequestError ? err.message : (err as Error).message);
      setAnswer(null);
    },
  });

  return (
    <section className="card mb-6 p-4">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ask.mutate(question.trim());
        }}
      >
        <input
          className={inputClass}
          placeholder={`Ask NEMO across all ${projectCount} project${projectCount === 1 ? "" : "s"} — e.g. which project needs my attention most?`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={!question.trim() || ask.isPending}>
          {ask.isPending ? "Thinking…" : "Ask"}
        </Button>
      </form>

      {ask.isPending && (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <Spinner className="h-4 w-4" /> Comparing projects — local models take a moment.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-risk-high">{error}</p>}
      {answer && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink">{answer}</p>}
      {answer && (
        <p className="mt-2 text-xs text-ink-faint">
          NEMO can only read here. To change something, open the project and ask its agent.
        </p>
      )}
    </section>
  );
}

function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.createProject({
        name,
        key: key || undefined,
        description: description || undefined,
        repositoryPath: repositoryPath || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setKey("");
      setDescription("");
      setRepositoryPath("");
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="New project">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) mutation.mutate();
        }}
      >
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Key (optional)">
          <input
            className={inputClass}
            placeholder="e.g. ACME"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
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
        <Field label="Repository path (optional)">
          <input
            className={`${inputClass} font-mono`}
            placeholder="/Users/you/code/acme-saas"
            value={repositoryPath}
            onChange={(e) => setRepositoryPath(e.target.value)}
          />
        </Field>
        {mutation.isError && (
          <p className="mb-3 text-sm text-risk-high">{(mutation.error as Error).message}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create project"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
