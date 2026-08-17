import { AIUnavailableError, OllamaProvider } from "@ai-pm/ai";
import type { AIProvider } from "@ai-pm/ai";
import { PlanTaskResponseSchema } from "@ai-pm/shared";
import type { PlanTaskResponse, ProjectState } from "@ai-pm/shared";

let provider: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (!provider) provider = new OllamaProvider();
  return provider;
}

const SYSTEM_PROMPT = [
  "You are a pragmatic, no-nonsense software engineering project manager assistant.",
  "You are given a deterministic, factual snapshot of a project's state. Use ONLY the facts provided --",
  "never invent tasks, commits, dates, or people that aren't in the context.",
  "Never estimate or comment on individual developer productivity, speed, or effort from commit counts,",
  "lines of code, or activity volume. Git activity indicates project state only, not performance.",
  "Be concise. No motivational filler, no exclamation points, no fake certainty.",
  "If information is missing or a risk has no clear fix, say so plainly instead of guessing.",
].join(" ");

function summarizeStateForPrompt(state: ProjectState): string {
  const lines: string[] = [];
  lines.push(`Project: ${state.project.name} (${state.project.key})`);
  lines.push(
    `Scope: ${state.metrics.scope === "sprint" && state.sprint ? `Sprint "${state.sprint.name}"` : "Whole project (no active sprint)"}`,
  );
  lines.push(
    `Issues: ${state.metrics.completedIssues}/${state.metrics.totalIssues} complete. ` +
      `Points: ${state.metrics.completedPoints}/${state.metrics.totalPoints} complete, ${state.metrics.remainingPoints} remaining.`,
  );
  lines.push(
    state.activeIssue
      ? `Active issue: ${state.activeIssue.key} "${state.activeIssue.title}" (status: ${state.activeIssue.status}, priority: ${state.activeIssue.priority})`
      : "Active issue: none currently in_progress.",
  );

  if (state.git.connected) {
    lines.push(
      `Git: branch "${state.git.branch ?? "unknown"}", ${state.git.recentCommits.length} recent commit(s), ` +
        `working tree ${state.git.isClean ? "clean" : "has uncommitted changes"}.`,
    );
    if (state.git.recentCommits.length > 0) {
      lines.push(
        "Recent commits: " +
          state.git.recentCommits
            .slice(0, 5)
            .map((c) => `${c.shortHash} "${c.subject}"`)
            .join("; "),
      );
    }
  } else {
    lines.push(`Git: not connected (${state.git.error ?? "no repository"}).`);
  }

  if (state.risks.length > 0) {
    lines.push("Open risks:");
    for (const risk of state.risks) {
      lines.push(`- [${risk.severity}] ${risk.message} Evidence: ${risk.evidence.join("; ")}`);
    }
  } else {
    lines.push("Open risks: none.");
  }

  if (state.staleIssues.length > 0) {
    lines.push(
      "Stale in-progress issues: " +
        state.staleIssues.map((s) => `${s.issueKey} (${s.daysSinceActivity}d no activity)`).join(", "),
    );
  }

  return lines.join("\n");
}

export interface AiStatusResult {
  text: string;
  source: "ai" | "fallback";
  model: string | null;
}

export async function generateAiStatus(state: ProjectState, question?: string): Promise<AiStatusResult> {
  try {
    const context = summarizeStateForPrompt(state);
    const userContent = [
      "Project state snapshot:",
      context,
      "",
      "Write a concise status update with these sections, in this order: Progress, Current work,",
      "Recent activity, Risk (or Risks), Recommendation. Keep each section to 1-3 short lines.",
      question ? `\nAlso specifically address this question: ${question}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await getAIProvider().chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
    });

    return { text: result.text, source: "ai", model: result.model };
  } catch (err) {
    if (!(err instanceof AIUnavailableError)) throw err;
    return { text: formatDeterministicStatus(state), source: "fallback", model: null };
  }
}

/**
 * Deterministic, no-AI project status. Used whenever Ollama is unreachable,
 * times out, or returns something unusable -- the app must never crash or
 * go silent just because the local model isn't available.
 */
export function formatDeterministicStatus(state: ProjectState): string {
  const lines: string[] = ["AI unavailable.", "", "Project Status", ""];

  lines.push(
    `${state.metrics.completedIssues}/${state.metrics.totalIssues} issues completed` +
      (state.metrics.totalPoints > 0
        ? ` (${state.metrics.completedPoints}/${state.metrics.totalPoints} points).`
        : "."),
  );
  lines.push(
    state.activeIssue ? `Active: ${state.activeIssue.key} ${state.activeIssue.title}.` : "Active: none.",
  );

  const high = state.risks.filter((r) => r.severity === "high");
  const rest = state.risks.filter((r) => r.severity !== "high");
  if (high.length > 0) {
    lines.push("", "High risk:");
    for (const r of high) lines.push(r.message);
  }
  if (rest.length > 0) {
    lines.push("", "Other risks:");
    for (const r of rest) lines.push(`[${r.severity}] ${r.message}`);
  }
  if (state.risks.length === 0) {
    lines.push("", "No risks detected.");
  }

  lines.push("", "Recent Git activity:");
  if (state.git.connected) {
    lines.push(
      state.git.recentCommits.length > 0
        ? `${state.git.recentCommits.length} commit(s) detected on ${state.git.branch ?? "current branch"}.`
        : `No new commits detected on ${state.git.branch ?? "current branch"}.`,
    );
  } else {
    lines.push(state.git.error ?? "No repository connected.");
  }

  lines.push("", "Recommendation:");
  if (high.length > 0) {
    lines.push(`Resolve: ${high[0]!.message}`);
  } else if (rest.length > 0) {
    lines.push(`Address: ${rest[0]!.message}`);
  } else if (state.activeIssue) {
    lines.push(`Continue ${state.activeIssue.key}.`);
  } else if (state.metrics.remainingIssues > 0) {
    lines.push("Start the next planned issue.");
  } else {
    lines.push("No open work remaining.");
  }

  return lines.join("\n");
}

export async function generatePlanTask(state: ProjectState, request: string): Promise<PlanTaskResponse> {
  const context = summarizeStateForPrompt(state);
  const userContent = [
    `Feature or change request: "${request}"`,
    "",
    "Project context for reference (do not restate it, just use it to keep scope/priority sensible):",
    context,
    "",
    "Break the request into a short list of concrete engineering tasks (2-8 tasks).",
    'Return ONLY JSON with this shape: { "feature": string, "summary": string, ' +
      '"tasks": [{ "title": string, "type": "epic"|"story"|"task"|"bug"|"subtask", "description": string, ' +
      '"storyPoints": number, "priority": "low"|"medium"|"high"|"critical" }], ' +
      '"risks": string[], "dependencies": string[] }.',
  ].join("\n");

  // AIUnavailableError propagates to the caller -- unlike status, a plan is
  // inherently generative and there is no safe deterministic substitute, so
  // callers should surface a clear "AI unavailable" error rather than fabricate tasks.
  return getAIProvider().structured({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    schema: PlanTaskResponseSchema,
    schemaName: "PlanTaskResponse",
    temperature: 0.3,
  });
}
