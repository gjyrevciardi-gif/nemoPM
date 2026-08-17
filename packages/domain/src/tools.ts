import type Database from "better-sqlite3";
import { z } from "zod";
import { IssueStatusSchema, IssueTypeSchema, PrioritySchema } from "@ai-pm/shared";
import type { PermissionTier } from "@ai-pm/shared";
import * as issuesDomain from "./issues.js";
import * as sprintsDomain from "./sprints.js";
import * as dependenciesDomain from "./dependencies.js";

interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
}
interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

export interface AgentToolDefinition<Args = any> {
  name: string;
  description: string;
  tier: PermissionTier;
  parameters: JsonSchema;
  schema: z.ZodType<Args, z.ZodTypeDef, any>;
  /** Read-only: describes what execute() would do, without mutating anything. Used for previews. */
  describe(db: Database.Database, projectId: string, args: Args): string;
  /** Performs the mutation via other domain functions; returns a human-readable summary. */
  execute(db: Database.Database, projectId: string, args: Args): { summary: string };
}

function findIssueByKey(db: Database.Database, projectId: string, key: string) {
  const issue = issuesDomain
    .listIssuesByProject(db, projectId)
    .find((i) => i.key.toLowerCase() === key.trim().toLowerCase());
  if (!issue) throw new Error(`No issue with key "${key}" in this project.`);
  return issue;
}

function findOpenSprintByName(db: Database.Database, projectId: string, name: string) {
  const sprint = sprintsDomain
    .listSprintsByProject(db, projectId)
    .find((s) => s.status !== "completed" && s.name.toLowerCase() === name.trim().toLowerCase());
  if (!sprint) throw new Error(`No open sprint named "${name}" in this project. Use planSprint to create one.`);
  return sprint;
}

const ISSUE_TYPES = IssueTypeSchema.options;
const PRIORITIES = PrioritySchema.options;
const STATUSES = IssueStatusSchema.options;

// -- createIssue -------------------------------------------------------

const createIssueSchema = z.object({
  title: z.string().min(1).max(300),
  type: IssueTypeSchema.optional(),
  description: z.string().max(10000).optional(),
  priority: PrioritySchema.optional(),
  storyPoints: z.number().min(0).max(100).optional(),
});

const createIssueTool: AgentToolDefinition<z.infer<typeof createIssueSchema>> = {
  name: "createIssue",
  description: "Create a new issue (task/story/bug/epic/subtask) in the project backlog.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short issue title" },
      type: { type: "string", enum: [...ISSUE_TYPES], description: "Defaults to task" },
      description: { type: "string", description: "Longer description, optional" },
      priority: { type: "string", enum: [...PRIORITIES], description: "Defaults to medium" },
      storyPoints: { type: "number", description: "Estimate, optional" },
    },
    required: ["title"],
  },
  schema: createIssueSchema,
  describe: (_db, _projectId, args) => `Create ${args.type ?? "task"} "${args.title}"`,
  execute: (db, projectId, args) => {
    const issue = issuesDomain.createIssue(db, {
      projectId,
      type: args.type ?? "task",
      title: args.title,
      description: args.description,
      status: "backlog",
      priority: args.priority ?? "medium",
      storyPoints: args.storyPoints ?? null,
    });
    return { summary: `Created ${issue.key}: ${issue.title}` };
  },
};

// -- updateIssue ---------------------------------------------------------

const updateIssueSchema = z.object({
  issueKey: z.string().min(1),
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(10000).optional(),
  priority: PrioritySchema.optional(),
  storyPoints: z.number().min(0).max(100).optional(),
  type: IssueTypeSchema.optional(),
});

const updateIssueTool: AgentToolDefinition<z.infer<typeof updateIssueSchema>> = {
  name: "updateIssue",
  description: "Edit an existing issue's title, description, priority, story points, or type.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: {
      issueKey: { type: "string", description: 'Issue key, e.g. "ACME-7"' },
      title: { type: "string" },
      description: { type: "string" },
      priority: { type: "string", enum: [...PRIORITIES] },
      storyPoints: { type: "number" },
      type: { type: "string", enum: [...ISSUE_TYPES] },
    },
    required: ["issueKey"],
  },
  schema: updateIssueSchema,
  describe: (_db, _projectId, args) => `Update ${args.issueKey}`,
  execute: (db, projectId, args) => {
    const issue = findIssueByKey(db, projectId, args.issueKey);
    const updated = issuesDomain.updateIssue(db, issue.id, {
      title: args.title,
      description: args.description,
      priority: args.priority,
      storyPoints: args.storyPoints,
      type: args.type,
    });
    if (!updated) throw new Error(`Issue not found: ${args.issueKey}`);
    return { summary: `Updated ${updated.key}` };
  },
};

// -- changeIssueStatus -----------------------------------------------------

const changeStatusSchema = z.object({
  issueKey: z.string().min(1),
  status: IssueStatusSchema,
});

const changeIssueStatusTool: AgentToolDefinition<z.infer<typeof changeStatusSchema>> = {
  name: "changeIssueStatus",
  description: "Move an issue to a different workflow status (backlog, todo, in_progress, in_review, done).",
  tier: "auto",
  parameters: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
      status: { type: "string", enum: [...STATUSES] },
    },
    required: ["issueKey", "status"],
  },
  schema: changeStatusSchema,
  describe: (_db, _projectId, args) => `Move ${args.issueKey} to ${args.status}`,
  execute: (db, projectId, args) => {
    const issue = findIssueByKey(db, projectId, args.issueKey);
    const updated = issuesDomain.moveIssue(db, issue.id, { status: args.status });
    return { summary: `${updated.key} is now ${updated.status}` };
  },
};

// -- dependencies ----------------------------------------------------------

const dependencySchema = z.object({
  issueKey: z.string().min(1),
  dependsOnKey: z.string().min(1),
});

const addDependencyTool: AgentToolDefinition<z.infer<typeof dependencySchema>> = {
  name: "addDependency",
  description: "Mark one issue as depending on another (the dependent issue is blocked until the target is done).",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" }, dependsOnKey: { type: "string" } },
    required: ["issueKey", "dependsOnKey"],
  },
  schema: dependencySchema,
  describe: (_db, _projectId, args) => `Make ${args.issueKey} depend on ${args.dependsOnKey}`,
  execute: (db, projectId, args) => {
    const issue = findIssueByKey(db, projectId, args.issueKey);
    const dependsOn = findIssueByKey(db, projectId, args.dependsOnKey);
    dependenciesDomain.addDependency(db, issue.id, dependsOn.id);
    return { summary: `${issue.key} now depends on ${dependsOn.key}` };
  },
};

const removeDependencyTool: AgentToolDefinition<z.infer<typeof dependencySchema>> = {
  name: "removeDependency",
  description: "Remove a dependency between two issues.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" }, dependsOnKey: { type: "string" } },
    required: ["issueKey", "dependsOnKey"],
  },
  schema: dependencySchema,
  describe: (_db, _projectId, args) => `Remove dependency: ${args.issueKey} on ${args.dependsOnKey}`,
  execute: (db, projectId, args) => {
    const issue = findIssueByKey(db, projectId, args.issueKey);
    const dependsOn = findIssueByKey(db, projectId, args.dependsOnKey);
    const existing = dependenciesDomain
      .listDependencies(db, issue.id)
      .find((d) => d.dependsOnIssueId === dependsOn.id);
    if (!existing) throw new Error(`${issue.key} does not depend on ${dependsOn.key}.`);
    dependenciesDomain.removeDependency(db, issue.id, existing.id);
    return { summary: `Removed dependency: ${issue.key} no longer depends on ${dependsOn.key}` };
  },
};

// -- deleteIssue (ASK -- irreversible) --------------------------------------

const deleteIssueSchema = z.object({ issueKey: z.string().min(1) });

const deleteIssueTool: AgentToolDefinition<z.infer<typeof deleteIssueSchema>> = {
  name: "deleteIssue",
  description: "Permanently delete an issue. Irreversible.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" } },
    required: ["issueKey"],
  },
  schema: deleteIssueSchema,
  describe: (db, projectId, args) => {
    const issue = findIssueByKey(db, projectId, args.issueKey);
    return `Delete ${issue.key}: "${issue.title}" (cannot be undone)`;
  },
  execute: (db, projectId, args) => {
    const issue = findIssueByKey(db, projectId, args.issueKey);
    issuesDomain.deleteIssue(db, issue.id);
    return { summary: `Deleted ${issue.key}` };
  },
};

// -- addIssueToSprint (ASK -- changes sprint scope) -------------------------

const addToSprintSchema = z.object({
  issueKey: z.string().min(1),
  sprintName: z.string().min(1),
});

const addIssueToSprintTool: AgentToolDefinition<z.infer<typeof addToSprintSchema>> = {
  name: "addIssueToSprint",
  description: "Move an issue into an existing (non-completed) sprint by name.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" }, sprintName: { type: "string" } },
    required: ["issueKey", "sprintName"],
  },
  schema: addToSprintSchema,
  describe: (db, projectId, args) => {
    const issue = findIssueByKey(db, projectId, args.issueKey);
    const sprint = findOpenSprintByName(db, projectId, args.sprintName);
    return `Move ${issue.key} into sprint "${sprint.name}"`;
  },
  execute: (db, projectId, args) => {
    const issue = findIssueByKey(db, projectId, args.issueKey);
    const sprint = findOpenSprintByName(db, projectId, args.sprintName);
    sprintsDomain.addIssueToSprint(db, issue.id, sprint.id);
    return { summary: `Moved ${issue.key} into "${sprint.name}"` };
  },
};

// -- planSprint (ASK -- the flagship "plan my next sprint" action) ----------

const planSprintSchema = z.object({
  name: z.string().min(1).max(200),
  goal: z.string().max(2000).optional(),
  issueKeys: z.array(z.string()).max(50).default([]),
  carryOverFromActiveSprint: z.boolean().optional(),
});

const planSprintTool: AgentToolDefinition<z.infer<typeof planSprintSchema>> = {
  name: "planSprint",
  description:
    "Create and start a new sprint, assign the given existing issues to it, and optionally carry over " +
    "unfinished issues from the currently active sprint. Use this for any 'plan/create the next sprint' request.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: 'Sprint name, e.g. "Sprint 12"' },
      goal: { type: "string" },
      issueKeys: { type: "array", items: { type: "string" }, description: "Existing issue keys to include" },
      carryOverFromActiveSprint: {
        type: "boolean",
        description: "Also move unfinished issues from the current active sprint into this one",
      },
    },
    required: ["name"],
  },
  schema: planSprintSchema,
  describe: (db, projectId, args) => {
    const issues = args.issueKeys.map((k) => findIssueByKey(db, projectId, k));
    const points = issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
    const lines = [`Create sprint "${args.name}"${args.goal ? ` — ${args.goal}` : ""}`];
    for (const i of issues) lines.push(`  ${i.key} — ${i.title} (${i.storyPoints ?? 0} pts)`);
    if (issues.length > 0) lines.push(`  Total: ${points} pts`);
    if (args.carryOverFromActiveSprint) {
      const active = sprintsDomain.getActiveSprint(db, projectId);
      if (active) {
        const unfinished = issuesDomain.listIssuesBySprint(db, active.id).filter((i) => i.status !== "done");
        lines.push(`  Carry over ${unfinished.length} unfinished issue(s) from "${active.name}"`);
      }
    }
    return lines.join("\n");
  },
  execute: (db, projectId, args) => {
    // Capture the currently active sprint before creating/starting the new
    // one, since starting a sprint doesn't automatically deactivate others.
    const previousActive = args.carryOverFromActiveSprint ? sprintsDomain.getActiveSprint(db, projectId) : null;

    const sprint = sprintsDomain.createSprint(db, { projectId, name: args.name, goal: args.goal });
    sprintsDomain.startSprint(db, sprint.id);

    for (const key of args.issueKeys) {
      const issue = findIssueByKey(db, projectId, key);
      sprintsDomain.addIssueToSprint(db, issue.id, sprint.id);
    }

    let carried = 0;
    if (previousActive) {
      carried = sprintsDomain.carryOverUnfinishedIssues(db, previousActive.id, sprint.id).length;
    }

    return {
      summary:
        `Created and started "${sprint.name}" with ${args.issueKeys.length} issue(s)` +
        (carried > 0 ? `, carried over ${carried} unfinished issue(s)` : ""),
    };
  },
};

// -- completeSprint (ASK) ---------------------------------------------------

const completeSprintSchema = z.object({ sprintName: z.string().min(1).optional() });

const completeSprintTool: AgentToolDefinition<z.infer<typeof completeSprintSchema>> = {
  name: "completeSprint",
  description: "Mark a sprint complete. Defaults to the currently active sprint if no name is given.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { sprintName: { type: "string", description: "Optional; defaults to the active sprint" } },
    required: [],
  },
  schema: completeSprintSchema,
  describe: (db, projectId, args) => {
    const sprint = args.sprintName
      ? findOpenSprintByName(db, projectId, args.sprintName)
      : sprintsDomain.getActiveSprint(db, projectId);
    if (!sprint) throw new Error("No active sprint to complete.");
    return `Complete sprint "${sprint.name}"`;
  },
  execute: (db, projectId, args) => {
    const sprint = args.sprintName
      ? findOpenSprintByName(db, projectId, args.sprintName)
      : sprintsDomain.getActiveSprint(db, projectId);
    if (!sprint) throw new Error("No active sprint to complete.");
    sprintsDomain.completeSprint(db, sprint.id);
    return { summary: `Completed sprint "${sprint.name}"` };
  },
};

// ---------------------------------------------------------------------------

/**
 * The agent's full tool surface. Deliberately does not include project
 * deletion or any bulk-delete operation -- those stay reachable only from
 * the web app's explicit, human-driven Settings UI, never from the agent.
 */
export const AGENT_TOOLS: AgentToolDefinition<any>[] = [
  createIssueTool,
  updateIssueTool,
  changeIssueStatusTool,
  addDependencyTool,
  removeDependencyTool,
  deleteIssueTool,
  addIssueToSprintTool,
  planSprintTool,
  completeSprintTool,
];

export function getAgentTool(name: string): AgentToolDefinition<any> | undefined {
  return AGENT_TOOLS.find((t) => t.name === name);
}
