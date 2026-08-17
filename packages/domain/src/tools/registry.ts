import type { PermissionTier } from "@ai-pm/shared";
import { ISSUE_TOOLS } from "./issue-tools.js";
import { SPRINT_TOOLS } from "./sprint-tools.js";
import { READ_TOOLS } from "./read-tools.js";
import { MEMORY_TOOLS, PROJECT_TOOLS } from "./memory-tools.js";
import type { AgentTool, ReadTool, WriteTool } from "./types.js";

/**
 * Every tool NEMO knows about, including the blocked ones. Blocked tools are
 * registered on purpose: the permission engine refuses them by name, so a
 * model that invents `deleteProject` gets a refusal instead of an unknown-tool
 * error that a future registration might quietly turn into a real deletion.
 */
export const AGENT_TOOLS: AgentTool[] = [
  ...READ_TOOLS,
  ...ISSUE_TOOLS,
  ...SPRINT_TOOLS,
  ...MEMORY_TOOLS,
  ...PROJECT_TOOLS,
];

export function getAgentTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}

/** The tools a model is actually offered: everything except the blocked ones. */
export function callableTools(): AgentTool[] {
  return AGENT_TOOLS.filter((tool) => tool.tier !== "blocked");
}

export function getTier(name: string): PermissionTier | null {
  return getAgentTool(name)?.tier ?? null;
}

export function isReadTool(tool: AgentTool): tool is ReadTool {
  return tool.kind === "read";
}

export function isWriteTool(tool: AgentTool): tool is WriteTool {
  return tool.kind === "write";
}
