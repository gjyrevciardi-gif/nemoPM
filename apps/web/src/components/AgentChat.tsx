import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentAction, AgentActionResult, AgentPlan, AgentResponse } from "@ai-pm/shared";
import { api, ApiRequestError } from "../lib/api.js";
import { Button, Spinner } from "./ui.js";

/**
 * The project agent, in the web app.
 *
 * Deliberately thin: it renders what POST /projects/:id/agent returns and
 * posts approvals back. Tiers, evidence, point totals and transactional apply
 * are all decided server-side, so this UI and the VS Code panel cannot drift
 * into disagreeing about what a request will do.
 */
type Entry =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "error"; text: string }
  | { kind: "applied"; results: AgentActionResult[] }
  | {
      kind: "proposal";
      runId: string;
      actions: AgentAction[];
      plan: AgentPlan | null;
      status: "pending" | "applying" | "applied" | "failed" | "rejected";
      results?: AgentActionResult[];
      error?: string;
    };

const SUGGESTIONS = [
  "What's blocking this sprint?",
  "Create a high priority bug for expired login tokens",
  "Plan the next sprint with max 24 points, carry unfinished work",
  "Break the checkout story into subtasks",
];

export function AgentChat({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [entries, thinking]);

  // A run belongs to the project it was proposed in; switching projects has to
  // clear the transcript rather than leave approvable cards from elsewhere.
  useEffect(() => {
    setEntries([]);
  }, [projectId]);

  const refreshProject = () => {
    void queryClient.invalidateQueries();
  };

  async function send(message: string) {
    const text = message.trim();
    if (!text || thinking) return;

    setEntries((prev) => [...prev, { kind: "user", text }]);
    setInput("");
    setThinking(true);

    try {
      const result: AgentResponse = await api.runAgent(projectId, text);
      setEntries((prev) => {
        const next: Entry[] = [...prev, { kind: "assistant", text: result.reply }];
        if (result.appliedResults.length > 0) next.push({ kind: "applied", results: result.appliedResults });
        if (result.status === "proposed" && result.runId) {
          next.push({
            kind: "proposal",
            runId: result.runId,
            actions: result.actions,
            plan: result.plan,
            status: "pending",
          });
        }
        return next;
      });
      if (result.appliedResults.length > 0) refreshProject();
    } catch (err) {
      const text = err instanceof ApiRequestError ? err.message : (err as Error).message;
      setEntries((prev) => [...prev, { kind: "error", text }]);
    } finally {
      setThinking(false);
    }
  }

  function updateProposal(runId: string, patch: Partial<Extract<Entry, { kind: "proposal" }>>) {
    setEntries((prev) =>
      prev.map((entry) => (entry.kind === "proposal" && entry.runId === runId ? { ...entry, ...patch } : entry)),
    );
  }

  async function apply(runId: string) {
    updateProposal(runId, { status: "applying" });
    try {
      const result = await api.applyAgentRun(projectId, runId);
      updateProposal(runId, { status: result.status, results: result.results });
      refreshProject();
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : (err as Error).message;
      updateProposal(runId, { status: "failed", error: message });
    }
  }

  async function reject(runId: string) {
    updateProposal(runId, { status: "applying" });
    try {
      await api.rejectAgentRun(projectId, runId);
      updateProposal(runId, { status: "rejected" });
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : (err as Error).message;
      updateProposal(runId, { status: "pending", error: message });
    }
  }

  return (
    <div className="flex h-[calc(100vh-13rem)] flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto pr-1">
        {entries.length === 0 && (
          <div className="card p-6">
            <h2 className="font-display text-base font-semibold text-ink">Ask NEMO about this project</h2>
            <p className="mt-1 text-sm text-ink-muted">
              NEMO reads this project's real state. Small edits happen immediately; anything that changes sprint
              scope or deletes work is proposed here for your approval first.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                  className="rounded-sm border border-border bg-surface2 px-3 py-2 text-left text-sm text-ink-muted hover:border-accent/40 hover:text-ink"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {entries.map((entry, index) => (
          <EntryView
            key={index}
            entry={entry}
            onApply={apply}
            onReject={reject}
          />
        ))}

        {thinking && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner className="h-4 w-4" /> NEMO is working — local models take a moment.
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="mt-4 flex items-end gap-2 border-t border-border-subtle pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="min-h-[44px] flex-1 resize-none rounded-sm border border-border bg-surface2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          rows={1}
          placeholder="Ask NEMO to do something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <Button type="submit" variant="primary" disabled={!input.trim() || thinking}>
          Send
        </Button>
      </form>
    </div>
  );
}

function EntryView({
  entry,
  onApply,
  onReject,
}: {
  entry: Entry;
  onApply: (runId: string) => void;
  onReject: (runId: string) => void;
}) {
  if (entry.kind === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] rounded-md bg-accent px-3 py-2 text-sm text-canvas">{entry.text}</p>
      </div>
    );
  }

  if (entry.kind === "assistant") {
    return (
      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">NEMO</p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{entry.text}</p>
      </div>
    );
  }

  if (entry.kind === "error") {
    return (
      <div className="rounded-md border border-risk-high/30 bg-risk-high/10 px-3 py-2 text-sm text-risk-high">
        {entry.text}
      </div>
    );
  }

  if (entry.kind === "applied") {
    return <ResultList title="Changes made" results={entry.results} />;
  }

  return <ProposalCard entry={entry} onApply={onApply} onReject={onReject} />;
}

function ResultList({ title, results }: { title: string; results: AgentActionResult[] }) {
  return (
    <div className="card overflow-hidden">
      <p className="border-b border-border bg-surface2 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
        {title}
      </p>
      <ul className="space-y-1.5 px-4 py-3">
        {results.map((result, index) => (
          <li key={index} className="flex gap-2 text-sm">
            <span className={result.ok ? "text-status-done" : "text-risk-high"}>{result.ok ? "✓" : "✕"}</span>
            <span className="text-ink">
              {result.description}
              {result.error && <span className="block text-xs text-ink-muted">{result.error}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProposalCard({
  entry,
  onApply,
  onReject,
}: {
  entry: Extract<Entry, { kind: "proposal" }>;
  onApply: (runId: string) => void;
  onReject: (runId: string) => void;
}) {
  const { plan, actions, status, results, error } = entry;

  const heading =
    status === "applied"
      ? "Applied"
      : status === "failed"
        ? "Failed — nothing was applied"
        : status === "rejected"
          ? "Cancelled — nothing was changed"
          : "NEMO proposal — waiting for your approval";

  const borderClass =
    status === "applied"
      ? "border-status-done/40"
      : status === "failed"
        ? "border-risk-high/40"
        : status === "rejected"
          ? "border-border"
          : "border-risk-medium/50";

  return (
    <div className={`card overflow-hidden border ${borderClass}`}>
      <p className="border-b border-border bg-surface2 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted">
        {heading}
      </p>

      <div className="space-y-4 px-4 py-4">
        {plan && (
          <div>
            <p className="text-sm font-medium text-ink">{plan.goal}</p>
            {plan.points !== null && (
              <p className="mt-0.5 font-mono text-xs text-ink-muted">{plan.points} points</p>
            )}
          </div>
        )}

        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">Actions</p>
          <ul className="space-y-1">
            {(results ?? actions).map((item, index) => {
              const isResult = "ok" in item;
              const ok = isResult ? (item as AgentActionResult).ok : null;
              return (
                <li key={index} className="flex gap-2 text-sm">
                  <span className={ok === null ? "text-ink-faint" : ok ? "text-status-done" : "text-risk-high"}>
                    {ok === null ? "→" : ok ? "✓" : "✕"}
                  </span>
                  <span className="whitespace-pre-wrap text-ink">
                    {item.description}
                    {isResult && (item as AgentActionResult).error && (
                      <span className="block text-xs text-ink-muted">{(item as AgentActionResult).error}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {plan && plan.evidence.length > 0 && (
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">Evidence</p>
            <ul className="space-y-1 text-sm text-ink-muted">
              {plan.evidence.map((fact, index) => (
                <li key={index}>• {fact}</li>
              ))}
            </ul>
          </div>
        )}

        {plan && plan.risks.length > 0 && (
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-risk-medium">Risks</p>
            <ul className="space-y-1 text-sm text-risk-medium">
              {plan.risks.map((risk, index) => (
                <li key={index}>• {risk}</li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-sm text-risk-high">{error}</p>}
      </div>

      {(status === "pending" || status === "applying") && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <span className="mr-auto text-xs text-ink-muted">
            {status === "applying" ? "Working…" : "Nothing has changed yet."}
          </span>
          <Button variant="ghost" disabled={status === "applying"} onClick={() => onReject(entry.runId)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={status === "applying"} onClick={() => onApply(entry.runId)}>
            Apply
          </Button>
        </div>
      )}

      {status === "failed" && (
        <p className="border-t border-border px-4 py-3 text-xs text-ink-muted">
          The whole plan was rolled back — the project is exactly as it was before you clicked Apply.
        </p>
      )}
    </div>
  );
}
