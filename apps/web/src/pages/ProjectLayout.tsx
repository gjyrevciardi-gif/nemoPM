import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Spinner } from "../components/ui.js";

const TABS = [
  { to: "", label: "Dashboard", end: true },
  { to: "board", label: "Board", end: false },
  { to: "backlog", label: "Backlog", end: false },
  { to: "activity", label: "Activity", end: false },
  { to: "decisions", label: "Decisions", end: false },
  { to: "history", label: "History", end: false },
  { to: "ai", label: "AI", end: false },
  { to: "settings", label: "Settings", end: false },
];

export default function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const {
    data: project,
    isLoading,
    isError,
    error,
  } = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id!), enabled: !!id });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-ink-faint">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 text-center">
        <p className="text-ink">Couldn't load this project.</p>
        <p className="text-sm text-ink-muted">{(error as Error)?.message}</p>
        <Link to="/" className="mt-2 text-sm text-accent hover:underline">
          ← Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border-subtle bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-8 py-4">
          <Link to="/" className="font-mono text-xs text-ink-faint hover:text-ink-muted">
            AI PM
          </Link>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs text-accent">{project.key}</span>
            <h1 className="font-display text-base font-semibold text-ink">{project.name}</h1>
          </div>
          <nav className="ml-auto flex gap-1">
            {TABS.map((tab) => (
              <NavLink
                key={tab.label}
                to={`/projects/${id}/${tab.to}`}
                end={tab.end}
                className={({ isActive }) =>
                  `rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? "bg-surface2 text-ink" : "text-ink-muted hover:text-ink"
                  }`
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
