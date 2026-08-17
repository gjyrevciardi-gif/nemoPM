import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { Button, Spinner } from "./ui.js";

export function AiStatusPanel({ projectId }: { projectId: string }) {
  const [question, setQuestion] = useState("");
  const mutation = useMutation({
    mutationFn: () => api.getAiStatus(projectId, question || undefined),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-sm border border-border bg-surface2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          placeholder="Optional: ask something specific…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") mutation.mutate();
          }}
        />
        <Button variant="primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? <Spinner className="h-4 w-4" /> : "Ask AI PM"}
        </Button>
      </div>

      {mutation.isPending && (
        <p className="text-sm text-ink-faint">Reading project state…</p>
      )}

      {mutation.isError && <p className="text-sm text-risk-high">{(mutation.error as Error).message}</p>}

      {mutation.data && (
        <div className="rounded-sm border border-border-subtle bg-surface2/60 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                mutation.data.source === "ai"
                  ? "bg-status-done/15 text-status-done"
                  : "bg-surface3 text-ink-faint"
              }`}
            >
              {mutation.data.source === "ai" ? mutation.data.model ?? "AI" : "offline summary"}
            </span>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
            {mutation.data.text}
          </pre>
        </div>
      )}
    </div>
  );
}
