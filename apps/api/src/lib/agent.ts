import type Database from "better-sqlite3";
import { agentRunsRepo } from "@ai-pm/database";
import { AGENT_TOOLS, getAgentTool, issuesDomain, sprintsDomain } from "@ai-pm/domain";
import type { ToolCall, ToolSpec } from "@ai-pm/ai";
import type { AgentAction, AgentActionResult, AgentApplyResponse, AgentResponse } from "@ai-pm/shared";
import { ApiError } from "./errors.js";
import { buildProjectState } from "./state.js";
import { AGENT_SYSTEM_PROMPT, getAIProvider, summarizeIssuesForPrompt, summarizeStateForPrompt } from "./ai.js";

const TOOL_SPECS: ToolSpec[] = AGENT_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
}));

/**
 * Runs one project-agent turn: grounds the model in the real project state
 * and full issue list, lets it call tools, executes AUTO-tier tools
 * immediately, and holds ASK-tier tools as a proposed action list (backed
 * by an agent_runs row) that only /agent/:runId/apply can execute. AI never
 * touches the database directly -- every tool call goes through
 * packages/domain the same way REST routes do.
 */
export async function runProjectAgent(
  db: Database.Database,
  projectId: string,
  message: string,
): Promise<AgentResponse> {
  const state = await buildProjectState(db, projectId);
  const issues = issuesDomain.listIssuesByProject(db, projectId);
  const sprints = sprintsDomain.listSprintsByProject(db, projectId);
  const context = [summarizeStateForPrompt(state), "", summarizeIssuesForPrompt(issues, sprints)].join("\n");

  const proposedActions: AgentAction[] = [];
  const appliedResults: AgentActionResult[] = [];

  const executeTool = async (call: ToolCall): Promise<unknown> => {
    const tool = getAgentTool(call.name);
    if (!tool) return { ok: false, error: `Unknown tool "${call.name}".` };

    const parsed = tool.schema.safeParse(call.arguments);
    if (!parsed.success) {
      return { ok: false, error: `Invalid arguments for ${call.name}: ${parsed.error.message}` };
    }

    if (tool.tier === "auto") {
      try {
        const result = tool.execute(db, projectId, parsed.data);
        appliedResults.push({ tool: call.name, description: result.summary, ok: true, error: null });
        return { ok: true, summary: result.summary };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        appliedResults.push({ tool: call.name, description: call.name, ok: false, error: errorMessage });
        return { ok: false, error: errorMessage };
      }
    }

    // ask tier: only describe (read-only) and queue -- never mutate here.
    try {
      const description = tool.describe(db, projectId, parsed.data);
      proposedActions.push({ tool: call.name, args: parsed.data, description });
      return { ok: true, queued: true, summary: `Queued for your approval: ${description}` };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return { ok: false, error: errorMessage };
    }
  };

  const result = await getAIProvider().runAgent({
    messages: [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      { role: "user", content: `Project context:\n${context}\n\nRequest: ${message}` },
    ],
    tools: TOOL_SPECS,
    executeTool,
    temperature: 0.2,
  });

  if (proposedActions.length > 0) {
    const run = agentRunsRepo.createRun(db, { projectId, requestText: message, actions: proposedActions });
    return { runId: run.id, reply: result.text, actions: proposedActions, appliedResults, status: "proposed" };
  }

  return { runId: null, reply: result.text, actions: [], appliedResults, status: "done" };
}

/** Executes a previously-proposed run's actions in order, stopping at the first failure. */
export function applyAgentRun(db: Database.Database, projectId: string, runId: string): AgentApplyResponse {
  const run = agentRunsRepo.getRun(db, runId);
  if (!run || run.projectId !== projectId) {
    throw new ApiError(404, "NOT_FOUND", `Agent run not found: ${runId}`);
  }
  if (run.status !== "proposed") {
    throw new ApiError(400, "ALREADY_RESOLVED", `Agent run ${runId} was already ${run.status}.`);
  }

  const results: AgentActionResult[] = [];
  let failed = false;

  for (const action of run.actions) {
    if (failed) break;

    const tool = getAgentTool(action.tool);
    if (!tool) {
      results.push({ tool: action.tool, description: action.description, ok: false, error: `Unknown tool "${action.tool}".` });
      failed = true;
      break;
    }

    const parsed = tool.schema.safeParse(action.args);
    if (!parsed.success) {
      results.push({
        tool: action.tool,
        description: action.description,
        ok: false,
        error: `Invalid arguments: ${parsed.error.message}`,
      });
      failed = true;
      break;
    }

    try {
      const outcome = tool.execute(db, projectId, parsed.data);
      results.push({ tool: action.tool, description: outcome.summary, ok: true, error: null });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      results.push({ tool: action.tool, description: action.description, ok: false, error: errorMessage });
      failed = true;
    }
  }

  const status = failed ? "failed" : "applied";
  agentRunsRepo.completeRun(db, runId, { status, results });
  return { runId, status, results };
}
