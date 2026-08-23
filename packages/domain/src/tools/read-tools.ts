import { z } from "zod";
import { activitiesRepo, dependenciesRepo, issuesRepo, projectsRepo, sprintsRepo } from "@ai-pm/database";
import { IssueStatusSchema, IssueTypeSchema, PrioritySchema } from "@ai-pm/shared";
import type { Issue } from "@ai-pm/shared";
import * as sprintsDomain from "../sprints.js";
import * as backlogDomain from "../backlog.js";
import * as memoryDomain from "../memory.js";
import type { ReadTool } from "./types.js";
import { findIssueByKey, issueLine, requireProjectId } from "./helpers.js";

/**
 * Read tools exist so the agent can look things up instead of being handed the
 * whole database in its prompt. Every one of them is bounded: a hard cap on
 * rows, short strings, no full descriptions unless a single issue was asked
 * for by key.
 */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function compact(issue: Issue) {
  return {
    key: issue.key,
    type: issue.type,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    storyPoints: issue.storyPoints,
    sprintId: issue.sprintId,
    parentId: issue.parentId,
  };
}

// -- project -----------------------------------------------------------------

const getProjectTool: ReadTool<Record<string, never>> = {
  name: "getProject",
  kind: "read",
  description: "Get this project's name, key, and issue/sprint counts.",
  tier: "auto",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  read: (ctx) => {
    const projectId = requireProjectId(ctx);
    const project = projectsRepo.getProject(ctx.db, projectId);
    if (!project) throw new Error("Project not found.");
    const issues = issuesRepo.listIssuesByProject(ctx.db, projectId);
    const sprints = sprintsRepo.listSprintsByProject(ctx.db, projectId);
    return {
      key: project.key,
      name: project.name,
      description: project.description,
      hasRepository: Boolean(project.repositoryPath),
      issueCount: issues.length,
      openIssueCount: issues.filter((i) => i.status !== "done").length,
      sprintCount: sprints.length,
      activeSprint: sprints.find((s) => s.status === "active")?.name ?? null,
    };
  },
};

const getProjectStateTool: ReadTool<Record<string, never>> = {
  name: "getProjectState",
  kind: "read",
  description:
    "Get the deterministic project snapshot: progress metrics, active sprint, open risks, stale work, and Git state.",
  tier: "auto",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  read: async (ctx) => {
    const state = await ctx.services.projectState(requireProjectId(ctx));
    return {
      metrics: state.metrics,
      activeSprint: state.sprint ? { name: state.sprint.name, status: state.sprint.status } : null,
      activeIssue: state.activeIssue ? issueLine(state.activeIssue) : null,
      risks: state.risks.map((r) => ({ severity: r.severity, message: r.message })),
      staleIssues: state.staleIssues.map((s) => `${s.issueKey} (${s.daysSinceActivity}d idle)`),
      git: state.git.connected
        ? { branch: state.git.branch, clean: state.git.isClean, recentCommits: state.git.recentCommits.length }
        : { connected: false, error: state.git.error },
    };
  },
};

// -- issues ------------------------------------------------------------------

const findIssuesSchema = z.object({
  status: IssueStatusSchema.optional(),
  priority: PrioritySchema.optional(),
  type: IssueTypeSchema.optional(),
  inActiveSprint: z.boolean().optional(),
  unfinishedOnly: z.boolean().optional(),
  search: z.string().max(200).optional(),
  limit: z.number().min(1).max(MAX_LIMIT).optional(),
});

const findIssuesTool: ReadTool<z.infer<typeof findIssuesSchema>> = {
  name: "findIssues",
  kind: "read",
  description:
    "Find candidate issues, especially when the user describes work without an exact key. Filters title/status/priority/type/sprint. Use this before getIssue for a descriptive or ambiguous reference.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: {
      status: { type: "string", enum: [...IssueStatusSchema.options] },
      priority: { type: "string", enum: [...PrioritySchema.options] },
      type: { type: "string", enum: [...IssueTypeSchema.options] },
      inActiveSprint: { type: "boolean", description: "Only issues in the active sprint" },
      unfinishedOnly: { type: "boolean", description: "Exclude done issues" },
      search: { type: "string", description: "Case-insensitive match on the title" },
      limit: { type: "number", description: `Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}` },
    },
    required: [],
  },
  schema: findIssuesSchema,
  read: (ctx, args) => {
    const projectId = requireProjectId(ctx);
    const active = sprintsRepo.getActiveSprint(ctx.db, projectId);
    const search = args.search?.trim().toLowerCase();

    const all = issuesRepo.listIssuesByProject(ctx.db, projectId).filter((issue) => {
      if (args.status && issue.status !== args.status) return false;
      if (args.priority && issue.priority !== args.priority) return false;
      if (args.type && issue.type !== args.type) return false;
      if (args.unfinishedOnly && issue.status === "done") return false;
      if (args.inActiveSprint && (!active || issue.sprintId !== active.id)) return false;
      if (search && !issue.title.toLowerCase().includes(search)) return false;
      return true;
    });

    const limit = clampLimit(args.limit);
    return {
      matched: all.length,
      returned: Math.min(all.length, limit),
      issues: all.slice(0, limit).map(compact),
    };
  },
};

const getIssueSchema = z.object({ issueKey: z.string().min(1).max(50) });

const getIssueTool: ReadTool<z.infer<typeof getIssueSchema>> = {
  name: "getIssue",
  kind: "read",
  description: "Get one issue in full by its exact existing issueKey. Do NOT put a title or description in issueKey; use findIssues first when no exact key is known.",
  tier: "auto",
  parameters: { type: "object", properties: { issueKey: { type: "string" } }, required: ["issueKey"] },
  schema: getIssueSchema,
  read: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    const projectId = requireProjectId(ctx);
    const all = issuesRepo.listIssuesByProject(ctx.db, projectId);
    const byId = new Map(all.map((i) => [i.id, i]));
    const dependencies = dependenciesRepo.listDependencies(ctx.db, issue.id);

    return {
      ...compact(issue),
      description: issue.description?.slice(0, 2000) ?? null,
      parent: issue.parentId ? (byId.get(issue.parentId)?.key ?? null) : null,
      children: all.filter((i) => i.parentId === issue.id).map((i) => i.key),
      dependsOn: dependencies
        .map((dep) => byId.get(dep.dependsOnIssueId))
        .filter((i): i is Issue => Boolean(i))
        .map((i) => ({ key: i.key, status: i.status })),
      recentActivity: activitiesRepo
        .listActivityByIssue(ctx.db, issue.id, 5)
        .map((a) => `${a.createdAt} ${a.type}`),
    };
  },
};

const getBacklogSchema = z.object({ limit: z.number().min(1).max(MAX_LIMIT).optional() });

const getBacklogTool: ReadTool<z.infer<typeof getBacklogSchema>> = {
  name: "getBacklog",
  kind: "read",
  description: "List issues not assigned to any sprint, in backlog order, with their points and priority.",
  tier: "auto",
  parameters: { type: "object", properties: { limit: { type: "number" } }, required: [] },
  schema: getBacklogSchema,
  read: (ctx, args) => {
    const backlog = backlogDomain.getBacklog(ctx.db, requireProjectId(ctx));
    const limit = clampLimit(args.limit);
    return {
      total: backlog.length,
      totalPoints: backlog.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
      issues: backlog.slice(0, limit).map(compact),
    };
  },
};

// -- sprints -----------------------------------------------------------------

const getCurrentSprintTool: ReadTool<Record<string, never>> = {
  name: "getCurrentSprint",
  kind: "read",
  description: "Get the active sprint with its issues, point totals, and what is still unfinished.",
  tier: "auto",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  read: (ctx) => {
    const projectId = requireProjectId(ctx);
    const active = sprintsRepo.getActiveSprint(ctx.db, projectId);
    if (!active) return { activeSprint: null, note: "This project has no active sprint." };

    const issues = issuesRepo.listIssuesBySprint(ctx.db, active.id);
    const points = sprintsDomain.sprintPoints(ctx.db, active.id);
    return {
      activeSprint: { name: active.name, goal: active.goal, startedAt: active.startedAt },
      points,
      issues: issues.map(compact),
    };
  },
};

const listSprintsSchema = z.object({ limit: z.number().min(1).max(50).optional() });

const listSprintsTool: ReadTool<z.infer<typeof listSprintsSchema>> = {
  name: "listSprints",
  kind: "read",
  description: "List this project's sprints, newest first, with status and delivered points.",
  tier: "auto",
  parameters: { type: "object", properties: { limit: { type: "number" } }, required: [] },
  schema: listSprintsSchema,
  read: (ctx, args) => {
    const sprints = sprintsRepo.listSprintsByProject(ctx.db, requireProjectId(ctx));
    return {
      total: sprints.length,
      sprints: sprints.slice(0, args.limit ?? 10).map((sprint) => ({
        name: sprint.name,
        status: sprint.status,
        goal: sprint.goal,
        ...sprintsDomain.sprintPoints(ctx.db, sprint.id),
      })),
    };
  },
};

const getVelocityTool: ReadTool<Record<string, never>> = {
  name: "getVelocity",
  kind: "read",
  description:
    "Average completed points across recent completed sprints. Returns null when the project has no completed sprint yet.",
  tier: "auto",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  read: (ctx) => sprintsDomain.getVelocity(ctx.db, requireProjectId(ctx)),
};

// -- intelligence ------------------------------------------------------------

const getRisksTool: ReadTool<Record<string, never>> = {
  name: "getRisks",
  kind: "read",
  description: "Open risks from the deterministic risk engine, with the evidence behind each.",
  tier: "auto",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  read: async (ctx) => {
    const state = await ctx.services.projectState(requireProjectId(ctx));
    return {
      count: state.risks.length,
      risks: state.risks.map((r) => ({
        severity: r.severity,
        type: r.type,
        message: r.message,
        evidence: r.evidence,
      })),
    };
  },
};

const getRecentActivitySchema = z.object({ limit: z.number().min(1).max(50).optional() });

const getRecentActivityTool: ReadTool<z.infer<typeof getRecentActivitySchema>> = {
  name: "getRecentActivity",
  kind: "read",
  description: "Recent project activity (issue changes, sprint events), newest first.",
  tier: "auto",
  parameters: { type: "object", properties: { limit: { type: "number" } }, required: [] },
  schema: getRecentActivitySchema,
  read: (ctx, args) => {
    const activities = activitiesRepo.listActivityByProject(ctx.db, requireProjectId(ctx), args.limit ?? 15);
    return {
      activities: activities.map((a) => ({ at: a.createdAt, type: a.type, payload: a.payload })),
    };
  },
};

const getGitContextTool: ReadTool<Record<string, never>> = {
  name: "getGitContext",
  kind: "read",
  description:
    "Git state of the linked repository: branch, whether the tree is clean, and recent commit subjects. Evidence only -- commits never prove an issue is done.",
  tier: "auto",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  read: async (ctx) => {
    const git = await ctx.services.gitStatus(requireProjectId(ctx));
    if (!git.connected) return { connected: false, error: git.error };
    return {
      connected: true,
      branch: git.branch,
      clean: git.isClean,
      recentCommits: git.recentCommits.slice(0, 10).map((c) => `${c.shortHash} ${c.subject}`),
    };
  },
};

const getCodeContextTool: ReadTool<Record<string, never>> = {
  name: "getCodeContext",
  kind: "read",
  description:
    "What the user has open in their editor right now: active file, selected code, diagnostics, branch. Empty when the request did not come from an editor.",
  tier: "auto",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  read: (ctx) => ctx.codeContext ?? { available: false, note: "No editor context was attached to this request." },
};

// -- memory ------------------------------------------------------------------

const listDecisionsSchema = z.object({ search: z.string().max(200).optional(), limit: z.number().min(1).max(50).optional() });

const listDecisionsTool: ReadTool<z.infer<typeof listDecisionsSchema>> = {
  name: "listDecisions",
  kind: "read",
  description:
    "Recorded project decisions -- the answer to 'why did we choose X'. If nothing here answers the question, say so instead of guessing.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { search: { type: "string" }, limit: { type: "number" } },
    required: [],
  },
  schema: listDecisionsSchema,
  read: (ctx, args) => {
    const search = args.search?.trim().toLowerCase();
    const decisions = memoryDomain
      .listDecisionsByProject(ctx.db, requireProjectId(ctx))
      .filter((decision) =>
        search
          ? [decision.title, decision.context, decision.decision, decision.rationale]
              .filter(Boolean)
              .some((field) => field!.toLowerCase().includes(search))
          : true,
      );
    return {
      total: decisions.length,
      decisions: decisions.slice(0, args.limit ?? 20).map((d) => ({
        title: d.title,
        context: d.context,
        decision: d.decision,
        rationale: d.rationale,
        decidedAt: d.decidedAt,
      })),
    };
  },
};

const listMilestonesTool: ReadTool<Record<string, never>> = {
  name: "listMilestones",
  kind: "read",
  description: "Confirmed project milestones, newest first. Unconfirmed suggestions are not project history.",
  tier: "auto",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  read: (ctx) => ({
    milestones: memoryDomain.listMilestonesByProject(ctx.db, requireProjectId(ctx)).map((m) => ({
      title: m.title,
      description: m.description,
      status: m.status,
      occurredAt: m.occurredAt,
    })),
  }),
};

export const READ_TOOLS = [
  getProjectTool,
  getProjectStateTool,
  findIssuesTool,
  getIssueTool,
  getBacklogTool,
  getCurrentSprintTool,
  listSprintsTool,
  getVelocityTool,
  getRisksTool,
  getRecentActivityTool,
  getGitContextTool,
  getCodeContextTool,
  listDecisionsTool,
  listMilestonesTool,
];
