import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Decision } from "@ai-pm/shared";
import { api } from "../lib/api.js";
import { Button, EmptyState, Field, Modal, Spinner, inputClass } from "../components/ui.js";
import { formatRelativeTime } from "../lib/format.js";

/**
 * Project memory, made readable and editable by a human.
 *
 * A decision the agent records is only useful if someone can check it, correct
 * it, or delete it when it turns out to be wrong -- otherwise "why did we
 * choose X" gets answered from text nobody has ever reviewed.
 */
export default function DecisionsPage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [editing, setEditing] = useState<Decision | null>(null);
  const [creating, setCreating] = useState(false);

  const decisionsQuery = useQuery({
    queryKey: ["decisions", projectId],
    queryFn: () => api.listDecisions(projectId!),
    enabled: !!projectId,
  });

  const issuesQuery = useQuery({
    queryKey: ["issues", projectId],
    queryFn: () => api.listIssues(projectId!),
    enabled: !!projectId,
  });

  if (!projectId) return null;

  const issueKeyById = new Map((issuesQuery.data ?? []).map((issue) => [issue.id, issue.key]));

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-lg font-semibold text-ink">Decisions</h1>
          <p className="text-sm text-ink-muted">
            Why this project is built the way it is. NEMO answers from these records, or says it was never
            written down.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Record decision
        </Button>
      </div>

      {decisionsQuery.isLoading ? (
        <div className="flex justify-center py-16 text-ink-faint">
          <Spinner className="h-5 w-5" />
        </div>
      ) : !decisionsQuery.data || decisionsQuery.data.length === 0 ? (
        <EmptyState
          title="No decisions recorded"
          description="Record the choices that would otherwise have to be reconstructed from guesswork later, or tell NEMO in the AI tab and it will record one for you."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Record the first one
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {decisionsQuery.data.map((decision) => (
            <li key={decision.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-medium text-ink">{decision.title}</h2>
                  <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                    {formatRelativeTime(decision.decidedAt)}
                    {decision.issueId && issueKeyById.has(decision.issueId) && (
                      <span className="ml-2 text-accent">{issueKeyById.get(decision.issueId)}</span>
                    )}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => setEditing(decision)}>
                  Edit
                </Button>
              </div>

              <dl className="mt-3 space-y-2 text-sm">
                {decision.context && <DetailRow label="Context" value={decision.context} />}
                {decision.decision && <DetailRow label="Decision" value={decision.decision} />}
                {decision.rationale && <DetailRow label="Rationale" value={decision.rationale} />}
              </dl>
            </li>
          ))}
        </ul>
      )}

      <DecisionModal
        projectId={projectId}
        decision={editing}
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink-faint">{label}</dt>
      <dd className="whitespace-pre-wrap text-ink-muted">{value}</dd>
    </div>
  );
}

function DecisionModal({
  projectId,
  decision,
  open,
  onClose,
}: {
  projectId: string;
  decision: Decision | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [choice, setChoice] = useState("");
  const [rationale, setRationale] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);

  // Re-seed the form whenever a different decision is opened for editing.
  const editingId = decision?.id ?? null;
  if (open && editingId !== loadedId) {
    setLoadedId(editingId);
    setTitle(decision?.title ?? "");
    setContext(decision?.context ?? "");
    setChoice(decision?.decision ?? "");
    setRationale(decision?.rationale ?? "");
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["decisions", projectId] });
  };

  const save = useMutation({
    mutationFn: () => {
      const input = {
        title: title.trim(),
        context: context.trim() || undefined,
        decision: choice.trim() || undefined,
        rationale: rationale.trim() || undefined,
      };
      return decision ? api.updateDecision(projectId, decision.id, input) : api.createDecision(projectId, input);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteDecision(projectId, decision!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={decision ? "Edit decision" : "Record a decision"} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) save.mutate();
        }}
      >
        <Field label="Title">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Use Redis for token revocation"
            autoFocus
          />
        </Field>
        <Field label="Context — what forced a choice">
          <textarea className={inputClass} rows={2} value={context} onChange={(e) => setContext(e.target.value)} />
        </Field>
        <Field label="Decision — what was chosen">
          <textarea className={inputClass} rows={2} value={choice} onChange={(e) => setChoice(e.target.value)} />
        </Field>
        <Field label="Rationale — why this option won">
          <textarea
            className={inputClass}
            rows={2}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </Field>

        {save.isError && <p className="mb-3 text-sm text-risk-high">{(save.error as Error).message}</p>}

        <div className="mt-4 flex justify-end gap-2">
          {decision && (
            <Button type="button" variant="danger" className="mr-auto" onClick={() => remove.mutate()}>
              Delete
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!title.trim() || save.isPending}>
            {save.isPending ? "Saving…" : decision ? "Save" : "Record"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
