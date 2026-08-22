import type Database from "better-sqlite3";
import { agentRunsRepo, dependenciesRepo, issuesRepo, sprintsRepo } from "@ai-pm/database";
import {
  callableTools,
  decideToolCall,
  resolveApplicableAction,
  type ToolContext,
  type WriteTool,
} from "@ai-pm/domain";
import type { ToolCall, ToolSpec } from "@ai-pm/ai";
import type {
  AgentAction,
  AgentActionResult,
  AgentApplyResponse,
  AgentPlan,
  AgentResponse,
  AgentToolCallRecord,
  CodeContext,
  Issue,
} from "@ai-pm/shared";
import { ApiError } from "./errors.js";
import { buildProjectState } from "./state.js";
import { getGitStatus } from "./git.js";
import { getAIProvider, AGENT_SYSTEM_PROMPT } from "./ai.js";
import { describeCodeContext, sanitizeCodeContext } from "./code-context.js";
import { buildPortfolioState } from "./portfolio.js";
import { repositoriesRepo, projectsRepo } from "@ai-pm/database";

/** How much of the project goes into the prompt before the agent must look things up itself. */
const MAX_CONTEXT_ISSUES = 40;
/** A proposal computed against a project an hour ago is evidence about a project that has moved. */
const RUN_TTL_MS = 60 * 60 * 1000;
/**
 * Tool-calling round trips per turn. Each one re-sends the growing
 * conversation to the model, so on CPU-only local hardware this is the single
 * biggest lever on how long a turn takes -- hence the env override, which the
 * evaluation harness uses to keep a scenario bounded.
 */
const MAX_TOOL_STEPS = Number(process.env.AGENT_MAX_STEPS) || 8;

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function toolSpecs(): ToolSpec[] {
  return callableTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function buildToolContext(db: Database.Database, projectId: string | null, codeContext: CodeContext | null): ToolContext {
  return {
    db,
    projectId,
    codeContext,
    services: {
      projectState: (id) => buildProjectState(db, id),
      gitStatus: async (id) => {
        const project = projectsRepo.getProject(db, id);
        const repo = repositoriesRepo.getRepositoryByProject(db, id);
        return getGitStatus(repo?.path ?? project?.repositoryPath ?? null);
      },
      // Available to the context, unused by project tools: a project turn has
      // no business reading other projects, and no project tool asks for it.
      portfolioState: async () => buildPortfolioState(db),
    },
  };
}

/**
 * The issue index the model starts with: enough to name real keys without
 * inventing any, capped so a 500-issue project doesn't produce a prompt that
 * costs a minute to process. Everything past the cap is reachable through the
 * read tools, which is what they're for.
 */
function buildIssueIndex(db: Database.Database, projectId: string): string {
  const issues = issuesRepo.listIssuesByProject(db, projectId);
  const activeSprint = sprintsRepo.getActiveSprint(db, projectId);

  const ranked = [...issues].sort((a, b) => {
    const aActive = activeSprint && a.sprintId === activeSprint.id ? 0 : 1;
    const bActive = activeSprint && b.sprintId === activeSprint.id ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aDone = a.status === "done" ? 1 : 0;
    const bDone = b.status === "done" ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  });

  const shown = ranked.slice(0, MAX_CONTEXT_ISSUES);
  const lines = shown.map((issue) => {
    const sprint = issue.sprintId === activeSprint?.id ? "active sprint" : issue.sprintId ? "other sprint" : "backlog";
    return `- ${issue.key} [${issue.type}] "${issue.title}" ${issue.status}/${issue.priority}, ${
      issue.storyPoints ?? "?"
    } pts, ${sprint}`;
  });

  if (issues.length > shown.length) {
    lines.push(
      `- (${issues.length - shown.length} more issues not listed -- use findIssues or getBacklog to see them)`,
    );
  }
  return [`Issues (${issues.length} total, showing ${shown.length}):`, ...lines].join("\n");
}

/**
 * Project text is data, not instruction. It is fenced, stripped of anything
 * that could close the fence early, and the model is told -- in the system
 * prompt, which project text can never reach -- to treat it as inert.
 */
function fenceProjectData(text: string): string {
  return ["<project_data>", text.replaceAll("</project_data>", "[/project_data]"), "</project_data>"].join("\n");
}

async function buildContext(
  db: Database.Database,
  projectId: string,
  codeContext: CodeContext | null,
): Promise<string> {
  const state = await buildProjectState(db, projectId);
  const sprints = sprintsRepo.listSprintsByProject(db, projectId);
  const openSprints = sprints.filter((s) => s.status !== "completed");

  const parts = [
    `Project: ${state.project.name} (${state.project.key})`,
    `Progress: ${state.metrics.completedIssues}/${state.metrics.totalIssues} issues, ` +
      `${state.metrics.completedPoints}/${state.metrics.totalPoints} pts, ${state.metrics.remainingPoints} pts remaining`,
    state.sprint ? `Active sprint: "${state.sprint.name}"` : "Active sprint: none",
    openSprints.length > 0
      ? `Open sprints: ${openSprints.map((s) => `"${s.name}" (${s.status})`).join(", ")}`
      : "Open sprints: none",
    state.risks.length > 0
      ? `Open risks:\n${state.risks.map((r) => `- [${r.severity}] ${r.message}`).join("\n")}`
      : "Open risks: none",
    "",
    buildIssueIndex(db, projectId),
  ];

  if (codeContext) parts.push("", describeCodeContext(codeContext));

  return fenceProjectData(parts.join("\n"));
}

/** Issue keys named anywhere in an action's arguments, for evidence and risk checks. */
function keysInAction(action: AgentAction): string[] {
  const keys: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") keys.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(action.args);
  return keys;
}

/**
 * Risks stated on the approval card. Computed from stored dependencies, not
 * from anything the model said, so the card can't be talked out of a warning.
 */
function computeRisks(db: Database.Database, projectId: string, actions: AgentAction[]): string[] {
  const issues = issuesRepo.listIssuesByProject(db, projectId);
  const byKey = new Map(issues.map((i) => [i.key.toLowerCase(), i]));
  const byId = new Map(issues.map((i) => [i.id, i]));

  const mentioned = new Set<string>();
  for (const action of actions) {
    for (const key of keysInAction(action)) {
      const issue = byKey.get(key.trim().toLowerCase());
      if (issue) mentioned.add(issue.id);
    }
    // Carried-over work lands in the new sprint without being named by key, so
    // pulling it in by hand is the only way its blockers get checked.
    if (action.args.carryOverFromActiveSprint === true) {
      const active = sprintsRepo.getActiveSprint(db, projectId);
      if (active) {
        for (const issue of issuesRepo.listIssuesBySprint(db, active.id)) {
          if (issue.status !== "done") mentioned.add(issue.id);
        }
      }
    }
  }

  const risks: string[] = [];
  for (const dep of dependenciesRepo.listDependenciesForProject(db, projectId)) {
    if (!mentioned.has(dep.issueId)) continue;
    const blocked = byId.get(dep.issueId);
    const blocker = byId.get(dep.dependsOnIssueId);
    if (!blocked || !blocker || blocker.status === "done") continue;
    risks.push(`${blocked.key} is blocked by ${blocker.key} ("${blocker.title}", ${blocker.status})`);
  }
  return risks;
}

function buildPlan(
  ctx: ToolContext,
  projectId: string,
  actions: AgentAction[],
  replyText: string,
): AgentPlan {
  const evidence: string[] = [];
  let points = 0;
  let sawPoints = false;

  for (const action of actions) {
    const resolved = resolveApplicableAction(action);
    if (!resolved.ok) continue;
    const tool: WriteTool = resolved.tool;
    try {
      if (tool.points) {
        points += tool.points(ctx, resolved.args);
        sawPoints = true;
      }
      if (tool.evidence) evidence.push(...tool.evidence(ctx, resolved.args));
    } catch {
      // Evidence is best-effort: a describe-time lookup failing must not stop
      // the proposal from being shown, since the action itself still validates.
    }
  }

  const goal = replyText.trim().split("\n")[0]?.slice(0, 200) || "Proposed changes";
  return {
    goal,
    points: sawPoints ? points : null,
    evidence: [...new Set(evidence)],
    risks: computeRisks(ctx.db, projectId, actions),
  };
}

export interface AgentTurnOptions {
  codeContext?: CodeContext | null;
}

/**
 * One project-agent turn.
 *
 * The model is grounded in a bounded project snapshot and given read tools to
 * look up the rest. Every tool call is decided server-side by the permission
 * engine: reads run, AUTO writes run, ASK writes are only described and queued
 * into an agent run that a human must approve. The model never sees a tier and
 * cannot change one.
 */
export async function runProjectAgent(
  db: Database.Database,
  projectId: string,
  message: string,
  options: AgentTurnOptions = {},
): Promise<AgentResponse> {
  const codeContext = sanitizeCodeContext(options.codeContext ?? null);
  const ctx = buildToolContext(db, projectId, codeContext);
  const context = await buildContext(db, projectId, codeContext);

  const proposedActions: AgentAction[] = [];
  const appliedResults: AgentActionResult[] = [];
  const toolCalls: AgentToolCallRecord[] = [];

  const record = (
    name: string,
    args: Record<string, unknown>,
    kind: "read" | "write",
    tier: AgentToolCallRecord["tier"],
    ok: boolean,
    summary: string,
  ) => {
    toolCalls.push({ name, args, kind, tier, ok, summary });
  };

  const executeTool = async (call: ToolCall): Promise<unknown> => {
    const decision = decideToolCall(call.name, call.arguments);

    if (decision.outcome === "refused") {
      record(call.name, call.arguments, "write", "blocked", false, decision.reason);
      return { ok: false, error: decision.reason };
    }

    if (decision.outcome === "read") {
      try {
        const data = await decision.tool.read(ctx, decision.args);
        record(call.name, call.arguments, "read", decision.tool.tier, true, "read");
        return { ok: true, data };
      } catch (err) {
        const error = errorMessage(err);
        record(call.name, call.arguments, "read", decision.tool.tier, false, error);
        return { ok: false, error };
      }
    }

    if (decision.outcome === "execute") {
      try {
        const result = decision.tool.execute(ctx, decision.args);
        appliedResults.push({ tool: call.name, description: result.summary, ok: true, error: null });
        record(call.name, call.arguments, "write", "auto", true, result.summary);
        return { ok: true, summary: result.summary };
      } catch (err) {
        const error = errorMessage(err);
        appliedResults.push({ tool: call.name, description: call.name, ok: false, error });
        record(call.name, call.arguments, "write", "auto", false, error);
        return { ok: false, error };
      }
    }

    // ask tier: describe only. describe() is read-only by contract, so nothing
    // has changed in the database when this returns.
    try {
      const description = decision.tool.describe(ctx, decision.args);
      proposedActions.push({
        tool: call.name,
        args: decision.args as Record<string, unknown>,
        description,
        projectId,
      });
      record(call.name, call.arguments, "write", "ask", true, `queued: ${description}`);
      return { ok: true, queued: true, summary: `Queued for the user's approval: ${description}` };
    } catch (err) {
      const error = errorMessage(err);
      record(call.name, call.arguments, "write", "ask", false, error);
      return { ok: false, error };
    }
  };

  const result = await getAIProvider().runAgent({
    messages: [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      { role: "user", content: `${context}\n\nRequest: ${message}` },
    ],
    tools: toolSpecs(),
    executeTool,
    temperature: 0.2,
    maxSteps: MAX_TOOL_STEPS,
  });

  if (proposedActions.length > 0) {
    const plan = buildPlan(ctx, projectId, proposedActions, result.text);
    const run = agentRunsRepo.createRun(db, {
      projectId,
      scope: "project",
      requestText: message,
      actions: proposedActions,
      toolCalls,
      plan,
      model: result.model ?? null,
      provider: "ollama",
    });
    return {
      runId: run.id,
      reply: result.text,
      actions: proposedActions,
      appliedResults,
      plan,
      toolCalls,
      status: "proposed",
    };
  }

  return {
    runId: null,
    reply: result.text,
    actions: [],
    appliedResults,
    plan: null,
    toolCalls,
    status: "done",
  };
}

function loadRunForDecision(db: Database.Database, projectId: string, runId: string) {
  agentRunsRepo.expireStaleRuns(db, new Date(Date.now() - RUN_TTL_MS).toISOString());

  const run = agentRunsRepo.getRun(db, runId);
  if (!run || run.projectId !== projectId) {
    throw new ApiError(404, "NOT_FOUND", `Agent run not found: ${runId}`);
  }
  if (run.status === "expired") {
    throw new ApiError(
      409,
      "RUN_EXPIRED",
      "This proposal is older than an hour and was computed against a project that may have changed. Ask again to get a fresh plan.",
    );
  }
  if (run.status !== "proposed") {
    throw new ApiError(409, "ALREADY_RESOLVED", `Agent run ${runId} was already ${run.status}.`);
  }
  return run;
}

/**
 * Applies an approved plan atomically: all of it, or none of it.
 *
 * Every action runs inside one SQLite transaction. A failure at action 5
 * throws out of the transaction, so actions 1-4 are rolled back by the
 * database itself rather than by compensating writes we'd have to get right.
 * The run's outcome is recorded *after* the rollback, in its own statement, so
 * the audit trail survives the failure it is describing.
 */
export function applyAgentRun(db: Database.Database, projectId: string, runId: string): AgentApplyResponse {
  const run = loadRunForDecision(db, projectId, runId);
  const ctx = buildToolContext(db, projectId, null);

  const results: AgentActionResult[] = [];
  let failure: { index: number; description: string; error: string } | null = null;

  try {
    db.transaction(() => {
      run.actions.forEach((action, index) => {
        // Actions are re-validated against today's registry: a run is not a
        // way to replay a tool that has since been blocked or changed.
        const resolved = resolveApplicableAction(action);
        if (!resolved.ok) {
          failure = { index, description: action.description, error: resolved.reason };
          throw new Error(resolved.reason);
        }
        if (action.projectId && action.projectId !== projectId) {
          const reason = "This action targets a different project than the run.";
          failure = { index, description: action.description, error: reason };
          throw new Error(reason);
        }

        try {
          const outcome = resolved.tool.execute(ctx, resolved.args);
          results.push({ tool: action.tool, description: outcome.summary, ok: true, error: null });
        } catch (err) {
          failure = { index, description: action.description, error: errorMessage(err) };
          throw err;
        }
      });
    })();
  } catch {
    // Swallowed: `failure` carries the detail, and the transaction has already
    // rolled every earlier action back.
  }

  if (failure) {
    const failed: { index: number; description: string; error: string } = failure;
    const rolledBack: AgentActionResult[] = run.actions.map((action, index) => {
      if (index === failed.index) {
        return { tool: action.tool, description: action.description, ok: false, error: failed.error };
      }
      return {
        tool: action.tool,
        description: action.description,
        ok: false,
        error:
          index < failed.index
            ? "Rolled back: a later action in this plan failed, so nothing was applied."
            : "Not attempted: an earlier action in this plan failed.",
      };
    });
    agentRunsRepo.resolveRun(db, runId, { status: "failed", results: rolledBack });
    return { runId, status: "failed", results: rolledBack };
  }

  agentRunsRepo.resolveRun(db, runId, { status: "applied", results });
  return { runId, status: "applied", results };
}

/** Declining a proposal is a recorded outcome, not a silent discard. */
export function rejectAgentRun(db: Database.Database, projectId: string, runId: string) {
  const run = loadRunForDecision(db, projectId, runId);
  const results: AgentActionResult[] = run.actions.map((action) => ({
    tool: action.tool,
    description: action.description,
    ok: false,
    error: "Rejected by the user. Nothing was applied.",
  }));
  const rejected = agentRunsRepo.resolveRun(db, runId, { status: "rejected", results });
  return { runId: rejected.id, status: rejected.status, results };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type { Issue };
