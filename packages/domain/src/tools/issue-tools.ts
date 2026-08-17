import { z } from "zod";
import { dependenciesRepo, issuesRepo } from "@ai-pm/database";
import { IssueStatusSchema, IssueTypeSchema, PrioritySchema } from "@ai-pm/shared";
import * as issuesDomain from "../issues.js";
import * as dependenciesDomain from "../dependencies.js";
import * as backlogDomain from "../backlog.js";
import type { WriteTool } from "./types.js";
import { findIssueByKey, findIssuesByKeys, issueLine, pointsOf, requireProjectId } from "./helpers.js";

const ISSUE_TYPES = IssueTypeSchema.options;
const PRIORITIES = PrioritySchema.options;
const STATUSES = IssueStatusSchema.options;

const issueKey = z.string().min(1).max(50);

// -- createIssue -------------------------------------------------------------

const createIssueSchema = z.object({
  title: z.string().min(1).max(300),
  type: IssueTypeSchema.optional(),
  description: z.string().max(10000).optional(),
  priority: PrioritySchema.optional(),
  storyPoints: z.number().min(0).max(100).optional(),
});

const createIssueTool: WriteTool<z.infer<typeof createIssueSchema>> = {
  name: "createIssue",
  kind: "write",
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
  describe: (_ctx, args) => `Create ${args.type ?? "task"} "${args.title}"`,
  execute: (ctx, args) => {
    const issue = issuesDomain.createIssue(ctx.db, {
      projectId: requireProjectId(ctx),
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

// -- updateIssue -------------------------------------------------------------

const updateIssueSchema = z.object({
  issueKey,
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(10000).optional(),
  priority: PrioritySchema.optional(),
  storyPoints: z.number().min(0).max(100).optional(),
  type: IssueTypeSchema.optional(),
});

const updateIssueTool: WriteTool<z.infer<typeof updateIssueSchema>> = {
  name: "updateIssue",
  kind: "write",
  description: "Edit an existing issue's title, description, priority, story points, or type.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: {
      issueKey: { type: "string", description: 'Exact existing issue key, e.g. "ACME-7"' },
      title: { type: "string" },
      description: { type: "string" },
      priority: { type: "string", enum: [...PRIORITIES] },
      storyPoints: { type: "number" },
      type: { type: "string", enum: [...ISSUE_TYPES] },
    },
    required: ["issueKey"],
  },
  schema: updateIssueSchema,
  describe: (ctx, args) => `Update ${findIssueByKey(ctx, args.issueKey).key}`,
  execute: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    const updated = issuesDomain.updateIssue(ctx.db, issue.id, {
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

// -- changeIssueStatus -------------------------------------------------------

const changeStatusSchema = z.object({ issueKey, status: IssueStatusSchema });

const changeIssueStatusTool: WriteTool<z.infer<typeof changeStatusSchema>> = {
  name: "changeIssueStatus",
  kind: "write",
  description: "Move an issue to a different workflow status (backlog, todo, in_progress, in_review, done).",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" }, status: { type: "string", enum: [...STATUSES] } },
    required: ["issueKey", "status"],
  },
  schema: changeStatusSchema,
  describe: (ctx, args) => `Move ${findIssueByKey(ctx, args.issueKey).key} to ${args.status}`,
  execute: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    const updated = issuesDomain.moveIssue(ctx.db, issue.id, { status: args.status });
    return { summary: `${updated.key} is now ${updated.status}` };
  },
};

// -- setPriority / setStoryPoints -------------------------------------------

const setPrioritySchema = z.object({ issueKey, priority: PrioritySchema });

const setPriorityTool: WriteTool<z.infer<typeof setPrioritySchema>> = {
  name: "setPriority",
  kind: "write",
  description: "Set an issue's priority.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" }, priority: { type: "string", enum: [...PRIORITIES] } },
    required: ["issueKey", "priority"],
  },
  schema: setPrioritySchema,
  describe: (ctx, args) => `Set ${findIssueByKey(ctx, args.issueKey).key} priority to ${args.priority}`,
  execute: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    const updated = issuesDomain.updateIssue(ctx.db, issue.id, { priority: args.priority });
    if (!updated) throw new Error(`Issue not found: ${args.issueKey}`);
    return { summary: `${updated.key} priority is now ${args.priority}` };
  },
};

const setPointsSchema = z.object({ issueKey, storyPoints: z.number().min(0).max(100) });

const setStoryPointsTool: WriteTool<z.infer<typeof setPointsSchema>> = {
  name: "setStoryPoints",
  kind: "write",
  description: "Set an issue's story point estimate.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" }, storyPoints: { type: "number" } },
    required: ["issueKey", "storyPoints"],
  },
  schema: setPointsSchema,
  describe: (ctx, args) => `Set ${findIssueByKey(ctx, args.issueKey).key} to ${args.storyPoints} points`,
  execute: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    const updated = issuesDomain.updateIssue(ctx.db, issue.id, { storyPoints: args.storyPoints });
    if (!updated) throw new Error(`Issue not found: ${args.issueKey}`);
    return { summary: `${updated.key} is now ${args.storyPoints} points` };
  },
};

// -- hierarchy ---------------------------------------------------------------

const setParentSchema = z.object({ issueKey, parentKey: z.string().max(50).nullable() });

const setParentTool: WriteTool<z.infer<typeof setParentSchema>> = {
  name: "setParent",
  kind: "write",
  description: "Set (or clear, with parentKey null) an issue's parent issue.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
      parentKey: { type: "string", description: "Parent issue key, or null to detach" },
    },
    required: ["issueKey", "parentKey"],
  },
  schema: setParentSchema,
  describe: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    if (!args.parentKey) return `Detach ${issue.key} from its parent`;
    return `Make ${issue.key} a child of ${findIssueByKey(ctx, args.parentKey).key}`;
  },
  execute: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    const parent = args.parentKey ? findIssueByKey(ctx, args.parentKey) : null;
    const updated = issuesDomain.setParent(ctx.db, issue.id, parent?.id ?? null);
    return { summary: parent ? `${updated.key} is now a child of ${parent.key}` : `${updated.key} detached` };
  },
};

const subtaskItemSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  storyPoints: z.number().min(0).max(100).optional(),
  priority: PrioritySchema.optional(),
});

const createSubtasksSchema = z.object({
  parentKey: issueKey,
  subtasks: z.array(subtaskItemSchema).min(1).max(20),
});

const createSubtasksTool: WriteTool<z.infer<typeof createSubtasksSchema>> = {
  name: "createSubtasks",
  kind: "write",
  description:
    "Break an existing issue into subtasks. Subtasks inherit the parent's sprint and priority unless overridden.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: {
      parentKey: { type: "string", description: "Existing issue key to break down" },
      subtasks: {
        type: "array",
        description: "The subtasks to create",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            storyPoints: { type: "number" },
            priority: { type: "string", enum: [...PRIORITIES] },
          },
          required: ["title"],
        },
      },
    },
    required: ["parentKey", "subtasks"],
  },
  schema: createSubtasksSchema,
  describe: (ctx, args) => {
    const parent = findIssueByKey(ctx, args.parentKey);
    const lines = [`Break ${parent.key} "${parent.title}" into ${args.subtasks.length} subtask(s):`];
    for (const sub of args.subtasks) lines.push(`  ${sub.title} (${sub.storyPoints ?? 0} pts)`);
    return lines.join("\n");
  },
  points: (_ctx, args) => args.subtasks.reduce((sum, sub) => sum + (sub.storyPoints ?? 0), 0),
  execute: (ctx, args) => {
    const parent = findIssueByKey(ctx, args.parentKey);
    const created = issuesDomain.createSubtasks(ctx.db, parent.id, args.subtasks);
    return { summary: `Created ${created.length} subtask(s) under ${parent.key}: ${created.map((i) => i.key).join(", ")}` };
  },
};

// -- bulkUpdateIssues --------------------------------------------------------

const bulkUpdateSchema = z.object({
  issueKeys: z.array(issueKey).min(1).max(50),
  priority: PrioritySchema.optional(),
  status: IssueStatusSchema.optional(),
  storyPoints: z.number().min(0).max(100).optional(),
});

const bulkUpdateIssuesTool: WriteTool<z.infer<typeof bulkUpdateSchema>> = {
  name: "bulkUpdateIssues",
  kind: "write",
  description: "Apply the same priority, status, or estimate to several issues at once.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: {
      issueKeys: { type: "array", items: { type: "string" } },
      priority: { type: "string", enum: [...PRIORITIES] },
      status: { type: "string", enum: [...STATUSES] },
      storyPoints: { type: "number" },
    },
    required: ["issueKeys"],
  },
  schema: bulkUpdateSchema,
  describe: (ctx, args) => {
    const issues = findIssuesByKeys(ctx, args.issueKeys);
    const changes = [
      args.priority ? `priority=${args.priority}` : null,
      args.status ? `status=${args.status}` : null,
      args.storyPoints !== undefined ? `points=${args.storyPoints}` : null,
    ].filter(Boolean);
    if (changes.length === 0) throw new Error("bulkUpdateIssues needs at least one field to change.");
    return `Set ${changes.join(", ")} on ${issues.length} issue(s): ${issues.map((i) => i.key).join(", ")}`;
  },
  execute: (ctx, args) => {
    const issues = findIssuesByKeys(ctx, args.issueKeys);
    if (args.priority === undefined && args.status === undefined && args.storyPoints === undefined) {
      throw new Error("bulkUpdateIssues needs at least one field to change.");
    }
    issuesDomain.bulkUpdateIssues(
      ctx.db,
      issues.map((issue) => ({
        issueId: issue.id,
        changes: { priority: args.priority, status: args.status, storyPoints: args.storyPoints },
      })),
    );
    return { summary: `Updated ${issues.length} issue(s): ${issues.map((i) => i.key).join(", ")}` };
  },
};

// -- deleteIssue -------------------------------------------------------------

const deleteIssueSchema = z.object({ issueKey });

const deleteIssueTool: WriteTool<z.infer<typeof deleteIssueSchema>> = {
  name: "deleteIssue",
  kind: "write",
  description: "Permanently delete an issue. Irreversible.",
  tier: "ask",
  parameters: { type: "object", properties: { issueKey: { type: "string" } }, required: ["issueKey"] },
  schema: deleteIssueSchema,
  describe: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    return `Delete ${issue.key}: "${issue.title}" (cannot be undone)`;
  },
  execute: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    issuesDomain.deleteIssue(ctx.db, issue.id);
    return { summary: `Deleted ${issue.key}` };
  },
};

/**
 * Registered but never exposed: the permission engine refuses blocked tools by
 * name, so a model that hallucinates this call gets a refusal rather than a
 * mass deletion.
 */
const bulkDeleteIssuesSchema = z.object({ issueKeys: z.array(issueKey).min(1) });

const bulkDeleteIssuesTool: WriteTool<z.infer<typeof bulkDeleteIssuesSchema>> = {
  name: "bulkDeleteIssues",
  kind: "write",
  description: "Blocked: bulk deletion is never available to the agent.",
  tier: "blocked",
  parameters: { type: "object", properties: { issueKeys: { type: "array", items: { type: "string" } } }, required: ["issueKeys"] },
  schema: bulkDeleteIssuesSchema,
  describe: () => "Bulk deletion is blocked.",
  execute: () => {
    throw new Error("Bulk deletion is blocked and cannot be performed by the agent.");
  },
};

// -- dependencies ------------------------------------------------------------

const dependencySchema = z.object({ issueKey, dependsOnKey: z.string().min(1).max(50) });

const addDependencyTool: WriteTool<z.infer<typeof dependencySchema>> = {
  name: "addDependency",
  kind: "write",
  description: "Mark one issue as depending on another (the dependent issue is blocked until the target is done).",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" }, dependsOnKey: { type: "string" } },
    required: ["issueKey", "dependsOnKey"],
  },
  schema: dependencySchema,
  describe: (ctx, args) =>
    `Make ${findIssueByKey(ctx, args.issueKey).key} depend on ${findIssueByKey(ctx, args.dependsOnKey).key}`,
  execute: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    const dependsOn = findIssueByKey(ctx, args.dependsOnKey);
    if (issue.id === dependsOn.id) throw new Error("An issue cannot depend on itself.");
    dependenciesDomain.addDependency(ctx.db, issue.id, dependsOn.id);
    return { summary: `${issue.key} now depends on ${dependsOn.key}` };
  },
};

const removeDependencyTool: WriteTool<z.infer<typeof dependencySchema>> = {
  name: "removeDependency",
  kind: "write",
  description: "Remove a dependency between two issues.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" }, dependsOnKey: { type: "string" } },
    required: ["issueKey", "dependsOnKey"],
  },
  schema: dependencySchema,
  describe: (ctx, args) =>
    `Remove dependency: ${findIssueByKey(ctx, args.issueKey).key} on ${findIssueByKey(ctx, args.dependsOnKey).key}`,
  execute: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    const dependsOn = findIssueByKey(ctx, args.dependsOnKey);
    const existing = dependenciesRepo
      .listDependencies(ctx.db, issue.id)
      .find((d) => d.dependsOnIssueId === dependsOn.id);
    if (!existing) throw new Error(`${issue.key} does not depend on ${dependsOn.key}.`);
    dependenciesDomain.removeDependency(ctx.db, issue.id, existing.id);
    return { summary: `Removed dependency: ${issue.key} no longer depends on ${dependsOn.key}` };
  },
};

// -- reorderBacklog ----------------------------------------------------------

const reorderBacklogSchema = z.object({ orderedIssueKeys: z.array(issueKey).min(1).max(100) });

const reorderBacklogTool: WriteTool<z.infer<typeof reorderBacklogSchema>> = {
  name: "reorderBacklog",
  kind: "write",
  description:
    "Reorder the backlog. The listed issues move to the top in the given order; unlisted issues keep their relative order below.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { orderedIssueKeys: { type: "array", items: { type: "string" } } },
    required: ["orderedIssueKeys"],
  },
  schema: reorderBacklogSchema,
  describe: (ctx, args) => {
    const issues = findIssuesByKeys(ctx, args.orderedIssueKeys);
    return `Reorder backlog, top first: ${issues.map((i) => i.key).join(" > ")}`;
  },
  execute: (ctx, args) => {
    const issues = findIssuesByKeys(ctx, args.orderedIssueKeys);
    const backlogIds = new Set(backlogDomain.getBacklog(ctx.db, requireProjectId(ctx)).map((i) => i.id));
    const notInBacklog = issues.filter((issue) => !backlogIds.has(issue.id));
    if (notInBacklog.length > 0) {
      throw new Error(`These issues are not in the backlog: ${notInBacklog.map((i) => i.key).join(", ")}`);
    }
    backlogDomain.reorderBacklog(
      ctx.db,
      requireProjectId(ctx),
      issues.map((i) => i.id),
    );
    return { summary: `Reordered backlog: ${issues.map((i) => i.key).join(" > ")}` };
  },
};

export const ISSUE_TOOLS = [
  createIssueTool,
  updateIssueTool,
  changeIssueStatusTool,
  setPriorityTool,
  setStoryPointsTool,
  setParentTool,
  createSubtasksTool,
  bulkUpdateIssuesTool,
  deleteIssueTool,
  bulkDeleteIssuesTool,
  addDependencyTool,
  removeDependencyTool,
  reorderBacklogTool,
];

/** Exported for tests: the points a set of issue keys represents. */
export function keyPoints(ctx: Parameters<typeof findIssuesByKeys>[0], keys: string[]): number {
  return pointsOf(findIssuesByKeys(ctx, keys));
}

export { issueLine, issuesRepo };
