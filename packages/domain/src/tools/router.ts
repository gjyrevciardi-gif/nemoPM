import { callableTools } from "./registry.js";
import type { AgentTool } from "./types.js";

export type AgentCapability =
  | "common_read" | "issue_create" | "issue_update" | "issue_structure"
  | "sprint_management" | "dependencies" | "memory" | "code_context" | "safe_fallback"
  | "product_planning" | "architecture" | "backlog_read" | "project_status" | "risk_read" | "portfolio_read";

export interface ToolRoute {
  primary: AgentCapability;
  capabilities: AgentCapability[];
  confidence: number;
  tools: AgentTool[];
  reason: string;
}

export type ContextDataRequirement = "project" | "decisions" | "milestones";

/** Loaded is explicit: an empty loaded dataset is sufficient; an absent dataset is not. */
export interface ContextSufficiency {
  loaded: Record<ContextDataRequirement, boolean>;
}

const READ_REQUIREMENTS: Partial<Record<string, ContextDataRequirement>> = {
  getProject: "project",
  listDecisions: "decisions",
  listMilestones: "milestones",
};

const GROUPS: Record<AgentCapability, readonly string[]> = {
  common_read: ["getProjectState", "findIssues", "getIssue", "getBacklog", "getCurrentSprint", "getRisks"],
  issue_create: ["createIssue", "findIssues", "getIssue", "getCodeContext"],
  issue_update: ["findIssues", "getIssue", "updateIssue", "changeIssueStatus", "setPriority", "setStoryPoints"],
  issue_structure: ["findIssues", "getIssue", "setParent", "createSubtasks"],
  sprint_management: ["getCurrentSprint", "listSprints", "getBacklog", "getVelocity", "getRisks", "planSprint", "createSprint", "addIssueToSprint", "removeIssueFromSprint", "carryOverUnfinishedIssues", "completeSprint"],
  dependencies: ["findIssues", "getIssue", "getDependencies", "addDependency", "removeDependency", "getRisks"],
  memory: ["listDecisions", "listMilestones", "createDecision", "createMilestone", "addProjectNote"],
  code_context: ["getCodeContext", "findIssues", "getIssue", "createIssue", "createSubtasks"],
  // Low confidence never broadens into writes. This is deliberately useful,
  // but incapable of mutating an unrelated part of a project.
  safe_fallback: ["getProject", "getProjectState", "findIssues", "getIssue", "getBacklog", "getCurrentSprint", "getRisks", "getRecentActivity", "listDecisions", "listMilestones"],
  product_planning:["getProject","listDecisions","listMilestones","createDecision","createMilestone","createIssue"],
  architecture:["getProject","listDecisions","createDecision","addProjectNote"],
  backlog_read:["getBacklog","findIssues","getIssue"],
  project_status:["getProjectState","getCurrentSprint","getBacklog","getRisks","getRecentActivity"],
  risk_read:["getRisks","getDependencies","getCurrentSprint"],
  portfolio_read:[],
};

const SIGNALS: Partial<Record<AgentCapability, RegExp[]>> = {
  issue_create: [/\b(create|add|open|file|log|report|new)\b.*\b(issue|bug|task|story|epic|ticket)\b/i, /\b(issue|bug|task|story|epic|ticket)\b.*\b(for this|from this|new)\b/i],
  issue_update: [/\b(priority|story points?|estimate|status|move|mark|rename|update|change|complete|done|review)\b/i, /\b(high|critical|medium|low)\s+priority\b/i],
  issue_structure: [/\b(subtasks?|break (?:it|this|feature).*(?:down|into)|parent|child issue)\b/i],
  sprint_management: [/\b(sprints?|velocity|carry over|carry unfinished|capacity|max(?:imum)? points?|iteration|scope)\b/i],
  dependencies: [/\b(depends? on|dependency|dependencies|blocked by|blocking|blocker|unblock)\b/i],
  memory: [/\b(decision|decided|rationale|why did we|milestone|project note|remember|recall)\b/i],
  code_context: [/\b(this (?:code|function|selection|change|diff)|selected code|my changes|current change|active file|diagnostic|refactor)\b/i],
};

function score(message: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(message) ? 1 : 0), 0);
}

/**
 * Lightweight capability routing. It classifies by multiple semantic signals,
 * not exact commands. Permission enforcement remains in decideToolCall; this
 * function only reduces what the model sees.
 */
export function routeAgentTools(message: string, options: { hasCodeContext?: boolean; capabilities?:string[]; projectMode?:string; contextSufficiency?:ContextSufficiency } = {}): ToolRoute {
  const requested=(options.capabilities??[]).filter((c):c is AgentCapability=>c in GROUPS);
  if(requested.length){const names=new Set(requested.flatMap(c=>GROUPS[c]));const tools=removeSatisfiedReads(callableTools().filter(t=>names.has(t.name)),options.contextSufficiency);return{primary:requested[0]!,capabilities:[...new Set(requested)],confidence:.98,tools,reason:`mode ${options.projectMode??"unknown"}; intent-selected capabilities`};}
  const ranked = (Object.keys(SIGNALS) as AgentCapability[])
    .map((capability) => ({ capability, score: score(message, SIGNALS[capability]!) + (capability === "code_context" && options.hasCodeContext ? 1 : 0) }))
    .filter((entry) => entry.score > 0)
    .sort((a,b) => b.score-a.score);

  const primary = ranked[0]?.capability;
  const top = ranked[0]?.score ?? 0;
  const tied = ranked.filter((entry) => entry.score === top).length;
  // Multiple matched capabilities are often intentional ("create a high
  // priority bug" is both create + priority), not low confidence.
  const confidence = top === 0 ? 0.25 : Math.min(0.95, 0.68 + top * 0.13 - (tied > 2 ? 0.08 : 0));
  const capabilities: AgentCapability[] = confidence < 0.6 ? ["safe_fallback"] : ranked.slice(0,2).map(r=>r.capability);

  // Informational wording adds compact reads without exposing more writes.
  if (confidence >= 0.6 && /\b(what|which|why|show|find|tell|explain|list|risk|about)\b/i.test(message)) capabilities.push("common_read");
  const names = new Set(capabilities.flatMap(capability => GROUPS[capability]));
  const tools = removeSatisfiedReads(callableTools().filter(tool => names.has(tool.name)), options.contextSufficiency);
  return { primary: primary ?? "safe_fallback", capabilities:[...new Set(capabilities)], confidence, tools, reason: primary ? `matched ${ranked.slice(0,2).map(r=>r.capability).join(", ")}` : "no strong capability signal; safe read-only fallback" };
}

function removeSatisfiedReads(tools: AgentTool[], sufficiency?: ContextSufficiency): AgentTool[] {
  if (!sufficiency) return tools;
  return tools.filter((tool) => {
    if (tool.kind !== "read") return true;
    const requirement = READ_REQUIREMENTS[tool.name];
    return !requirement || !sufficiency.loaded[requirement];
  });
}

export function toolSurfaceMetrics(tools: AgentTool[]) {
  const schemaCharacters = JSON.stringify(tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters}))).length;
  return { toolCount:tools.length, schemaCharacters, approximateTokens:Math.ceil(schemaCharacters/4) };
}
