import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button, EmptyState, Field, Modal, Spinner, inputClass } from "../components/ui.js";

export default function HomePage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data: projects, isLoading } = useQuery({ queryKey: ["projects"], queryFn: api.listProjects });

  return (
    <div className="min-h-screen">
      <header className="border-b border-border-subtle px-8 py-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent">Local-first</p>
            <h1 className="font-display text-2xl font-semibold text-ink">AI PM</h1>
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
        ) : !projects || projects.length === 0 ? (
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                to={`/projects/${p.id}`}
                className="card group flex flex-col gap-2 p-5 transition-colors hover:border-accent/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-ink-faint">{p.key}</span>
                  {p.repositoryPath && (
                    <span className="rounded-sm bg-surface3 px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      repo linked
                    </span>
                  )}
                </div>
                <h2 className="font-display text-lg font-semibold text-ink group-hover:text-accent">
                  {p.name}
                </h2>
                {p.description && <p className="line-clamp-2 text-sm text-ink-muted">{p.description}</p>}
              </Link>
            ))}
          </div>
        )}
      </main>

      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
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
