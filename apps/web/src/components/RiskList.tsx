import { useState } from "react";
import type { Risk } from "@ai-pm/shared";
import { RiskSeverityBadge } from "./ui.js";

const SEVERITY_ORDER: Record<Risk["severity"], number> = { high: 0, medium: 1, low: 2 };

export function RiskList({ risks }: { risks: Risk[] }) {
  const sorted = [...risks].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  if (sorted.length === 0) {
    return <p className="text-sm text-ink-muted">No open risks detected.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((risk) => (
        <RiskRow key={risk.id} risk={risk} />
      ))}
    </ul>
  );
}

function RiskRow({ risk }: { risk: Risk }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-sm border border-border-subtle bg-surface2/60 p-3">
      <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen((o) => !o)}>
        <RiskSeverityBadge severity={risk.severity} />
        <span className="flex-1 text-sm text-ink">{risk.message}</span>
        <span className="text-ink-faint">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 border-t border-border-subtle pt-2 font-mono text-xs text-ink-muted">
          {risk.evidence.map((e, i) => (
            <li key={i}>· {e}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
