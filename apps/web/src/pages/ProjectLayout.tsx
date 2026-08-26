import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Spinner } from "../components/ui.js";

const TABS = [
  { to: "", label: "Dashboard", icon: "M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z", end: true },
  { to: "board", label: "Board", icon: "M4 5h16M4 12h16M4 19h10", end: false },
  { to: "backlog", label: "Backlog", icon: "M6 4h12v16H6zM9 8h6M9 12h6M9 16h4", end: false },
  { to: "activity", label: "Activity", icon: "M4 14h4l2-7 4 12 2-5h4", end: false },
  { to: "decisions", label: "Decisions", icon: "M12 3a7 7 0 0 0-4 12.7V20h8v-4.3A7 7 0 0 0 12 3Z", end: false },
  { to: "history", label: "History", icon: "M4 12a8 8 0 1 0 2.3-5.7L4 8M4 4v4h4M12 8v5l3 2", end: false },
  { to: "intelligence", label: "Understanding", icon: "M12 3a6 6 0 0 0-3 11.2V18h6v-3.8A6 6 0 0 0 12 3ZM9 21h6", end: false },
  { to: "evaluation", label: "Evaluation", icon: "M5 4h14v16H5zM8 8h8M8 12h5M8 16h3", end: false },
  { to: "ai", label: "AI agent", icon: "M12 3v3M5.6 5.6l2.1 2.1M3 12h3m12 0h3m-2.6-6.4-2.1 2.1M8 17h8M9 21h6", end: false },
  { to: "settings", label: "Settings", icon: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19 12l2-1-2-3-2 .5-1.5-1.5.5-2h-4l-.5 2L7 8.5 5 8l-2 3 2 1v2l-2 1 2 3 2-.5L8.5 19l.5 2h4l.5-2 1.5-1.5 2 .5 2-3-2-1v-2Z", end: false },
];

export default function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { data: project, isLoading, isError, error } = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id!), enabled: !!id });
  const { data: aiHealth, isFetching: aiChecking } = useQuery({ queryKey:["ai-health"], queryFn:api.getAiHealth, refetchInterval:30_000, retry:false });
  if (isLoading) return <div className="flex min-h-screen items-center justify-center text-ink-faint"><Spinner className="h-6 w-6" /></div>;
  if (isError || !project) return <div className="flex min-h-screen flex-col items-center justify-center gap-2 text-center"><p>Couldn't load this project.</p><p className="text-sm text-ink-muted">{(error as Error)?.message}</p><Link to="/" className="text-sm text-accent">Back to projects</Link></div>;
  const isBoard = location.pathname.endsWith("/board");
  return <div className="flex h-screen overflow-hidden">
    <aside className="project-sidebar tide-glass relative z-20 flex w-[220px] flex-none flex-col border-r border-border px-3 py-5 max-md:w-[76px] max-md:items-center max-md:px-0">
      <Link to="/" aria-label="Projects" className="mb-6 flex h-11 items-center gap-3 px-2 text-ink max-md:grid max-md:w-11 max-md:place-items-center max-md:px-0"><span className="grid h-10 w-10 flex-none place-items-center rounded-[13px] bg-gradient-to-br from-[#FFC29C] to-[#E5793F] shadow-[0_10px_22px_-10px_rgba(229,121,63,.9)]"><svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M3 15c3-5 6 5 9 0s6-5 9 0M3 9.5c3-5 6 5 9 0s6-5 9 0" stroke="#00243F" strokeWidth="2.1" strokeLinecap="round" /></svg></span><span className="font-display text-sm font-bold max-md:hidden">NEMO PM</span></Link>
      <nav className="flex w-full flex-col gap-1.5 max-md:items-center">{TABS.map(tab => <NavLink key={tab.label} to={`/projects/${id}/${tab.to}`} end={tab.end} title={tab.label} className={({isActive}) => `flex h-11 w-full items-center gap-3 rounded-[13px] px-3 text-sm font-semibold transition max-md:w-11 max-md:justify-center max-md:px-0 ${isActive ? "bg-accent text-[#0E1015] shadow-lg" : "text-ink hover:bg-white/10"}`}><svg className="flex-none" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={tab.icon} /></svg><span className="max-md:hidden">{tab.label}</span></NavLink>)}</nav>
    </aside>
    <div className="relative z-10 flex min-w-0 flex-1 flex-col">
      <header className="project-header tide-glass flex h-[70px] flex-none items-center gap-5 border-b border-border-subtle px-6">
        <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate font-display text-xl font-bold tracking-tight">{project.name}</h1><span className="rounded-md border border-accent/30 bg-accent/15 px-2 py-0.5 font-mono text-[10px] text-[#F0B392]">{project.key}</span></div><p className="mt-0.5 text-[11px] text-ink-faint">local-first agent PM</p></div>
        <div title={aiHealth?.error ?? aiHealth?.model ?? "Checking Ollama"} className={`ml-auto hidden items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold md:flex ${aiHealth?.state==="ready"?"border-status-done/30 bg-status-done/10 text-[#6FD3A6]":aiHealth?.state==="loading"||aiHealth?.state==="running"||aiChecking?"border-accent/25 bg-accent/10 text-[#F0B392]":"border-risk-high/30 bg-risk-high/10 text-[#F58A8D]"}`}><span className={`h-2 w-2 rounded-full ${aiHealth?.state==="ready"?"bg-status-done":aiHealth?.state==="loading"||aiHealth?.state==="running"||aiChecking?"animate-pulse bg-accent":"bg-risk-high"}`} />{aiChecking&&!aiHealth?"AI checking":aiHealth?.state==="ready"?`AI ready · ${aiHealth.model}`:aiHealth?.state==="running"?"AI request running":aiHealth?.state==="loading"?"AI loading":"AI offline"}</div>
      </header>
      <main className={`min-h-0 flex-1 ${isBoard ? "overflow-hidden" : "overflow-auto p-8"}`}><Outlet /></main>
    </div>
  </div>;
}
