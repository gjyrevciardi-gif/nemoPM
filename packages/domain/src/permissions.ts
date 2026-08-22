import type { AgentAction } from "@ai-pm/shared";
import { getAgentTool } from "./tools/registry.js";
import type { ReadTool, WriteTool } from "./tools/types.js";

/**
 * The permission engine. Every tool call -- during a turn or at apply time --
 * goes through here, on the server, using the registry's own tier. The model
 * supplies a name and arguments; it never supplies a tier, so nothing it says
 * (including text copied out of an issue description) can promote a tool.
 */
export type ToolDecision =
  | { outcome: "read"; tool: ReadTool; args: unknown }
  | { outcome: "execute"; tool: WriteTool; args: unknown }
  | { outcome: "propose"; tool: WriteTool; args: unknown }
  | { outcome: "refused"; reason: string };

export function decideToolCall(name: string, rawArgs: unknown): ToolDecision {
  const tool = getAgentTool(name);
  if (!tool) {
    return { outcome: "refused", reason: `Unknown tool "${name}". Use only the tools you were given.` };
  }
  if (tool.tier === "blocked") {
    return {
      outcome: "refused",
      reason: `"${name}" is blocked and can never be run by the agent. Tell the user this must be done by a human in the web app.`,
    };
  }

  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { outcome: "refused", reason: `Invalid arguments for ${name}: ${parsed.error.message}` };
  }

  if (tool.kind === "read") return { outcome: "read", tool, args: parsed.data };
  return tool.tier === "auto"
    ? { outcome: "execute", tool, args: parsed.data }
    : { outcome: "propose", tool, args: parsed.data };
}

/**
 * Re-checks a stored action at apply time. A proposal may have been sitting in
 * the database while the registry changed underneath it, and a run must never
 * be a way to smuggle a tool past the tier it has today.
 *
 * Only ASK-tier writes are applicable: AUTO tools already ran during the turn,
 * so finding one in a proposal would mean applying it twice.
 */
export function resolveApplicableAction(
  action: AgentAction,
): { ok: true; tool: WriteTool; args: unknown } | { ok: false; reason: string } {
  const tool = getAgentTool(action.tool);
  if (!tool) return { ok: false, reason: `Unknown tool "${action.tool}".` };
  if (tool.kind !== "write") return { ok: false, reason: `"${action.tool}" is a read-only tool.` };
  if (tool.tier === "blocked") return { ok: false, reason: `"${action.tool}" is blocked.` };
  if (tool.tier !== "ask") {
    return { ok: false, reason: `"${action.tool}" does not require approval and cannot be applied from a run.` };
  }

  const parsed = tool.schema.safeParse(action.args);
  if (!parsed.success) return { ok: false, reason: `Invalid arguments: ${parsed.error.message}` };

  return { ok: true, tool, args: parsed.data };
}
