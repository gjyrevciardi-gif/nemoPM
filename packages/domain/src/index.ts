export * as issuesDomain from "./issues.js";
export * as sprintsDomain from "./sprints.js";
export * as dependenciesDomain from "./dependencies.js";
export * as backlogDomain from "./backlog.js";
export * as projectsDomain from "./projects.js";
export * as planDomain from "./plan.js";
export * as memoryDomain from "./memory.js";

export {
  AGENT_TOOLS,
  getAgentTool,
  callableTools,
  getTier,
  isReadTool,
  isWriteTool,
  PORTFOLIO_AGENT_TOOLS,
  getPortfolioTool,
} from "./tools/registry.js";
export type { AgentTool, ReadTool, WriteTool, ToolContext, ToolServices, JsonSchema } from "./tools/types.js";
export { routeAgentTools, toolSurfaceMetrics } from "./tools/router.js";
export type { ContextDataRequirement, ContextSufficiency } from "./tools/router.js";
export type { AgentCapability, ToolRoute } from "./tools/router.js";
export { decideToolCall, resolveApplicableAction } from "./permissions.js";
export type { ToolDecision } from "./permissions.js";
