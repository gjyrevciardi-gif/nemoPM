import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger" }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const variants: Record<string, string> = {
    default: "bg-surface3 text-ink hover:bg-surface3/80 border border-border",
    primary: "bg-accent text-canvas hover:bg-accent-hover font-semibold",
    ghost: "text-ink-muted hover:text-ink hover:bg-surface2",
    danger: "bg-risk-high/10 text-risk-high hover:bg-risk-high/20 border border-risk-high/30",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Badge({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${className}`}
    >
      {children}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};
const STATUS_COLORS: Record<string, string> = {
  backlog: "bg-status-backlog/15 text-status-backlog",
  todo: "bg-status-todo/15 text-status-todo",
  in_progress: "bg-status-progress/15 text-status-progress",
  in_review: "bg-status-review/15 text-status-review",
  done: "bg-status-done/15 text-status-done",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge className={STATUS_COLORS[status] ?? "bg-surface3 text-ink-muted"}>{STATUS_LABELS[status] ?? status}</Badge>;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "text-ink-faint",
  medium: "text-status-todo",
  high: "text-accent",
  critical: "text-risk-high",
};

export function PriorityMark({ priority }: { priority: string }) {
  return (
    <span className={`text-[11px] font-semibold uppercase tracking-wide ${PRIORITY_COLORS[priority] ?? "text-ink-muted"}`}>
      {priority}
    </span>
  );
}

const TYPE_ICONS: Record<string, string> = {
  epic: "◆",
  story: "▲",
  task: "●",
  bug: "✕",
  subtask: "‣",
};

export function TypeIcon({ type }: { type: string }) {
  return <span className="font-mono text-xs text-ink-faint">{TYPE_ICONS[type] ?? "●"}</span>;
}

const RISK_COLORS: Record<string, string> = {
  high: "bg-risk-high/15 text-risk-high border-risk-high/30",
  medium: "bg-risk-medium/15 text-risk-medium border-risk-medium/30",
  low: "bg-risk-low/15 text-risk-low border-risk-low/30",
};

export function RiskSeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge className={`border ${RISK_COLORS[severity] ?? "border-border text-ink-muted"}`}>{severity}</Badge>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border py-16 text-center">
      <p className="font-display text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: PropsWithChildren<{ open: boolean; onClose: () => void; title: string; wide?: boolean }>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm">
      <div
        className={`card w-full ${wide ? "max-w-2xl" : "max-w-md"} shadow-popover animate-[fadeIn_120ms_ease-out]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-sm p-1 text-ink-faint hover:bg-surface2 hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, children }: PropsWithChildren<{ label: string }>) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-sm border border-border bg-surface2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none";
