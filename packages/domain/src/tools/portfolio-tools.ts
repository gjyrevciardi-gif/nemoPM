import { z } from "zod";
import { activitiesRepo, dependenciesRepo, issuesRepo, projectsRepo, sprintsRepo } from "@ai-pm/database";
import * as issuesDomain from "../issues.js";
import * as sprintsDomain from "../sprints.js";
import * as memoryDomain from "../memory.js";
import type { ReadTool } from "./types.js";

/**
 * Tools for the portfolio agent, which reasons across every project.
 *
 * All read-only, on purpose. A vague cross-project instruction ("clean up the
 * stale work") could otherwise touch several projects at once, and there is no
 * single project owner to approve that. Changing anything means opening that
 * project's own agent, where the approval flow and the blast radius are both
 * scoped to one project.
 */
function requireProjectByKey(db: Parameters<typeof projectsRepo.listProjects>[0], key: string) {
  const wanted = key.trim().toLowerCase();
  const project = projectsRepo
    .listProjects(db)
    .find((p) => p.key.toLowerCase() === wanted || p.name.toLowerCase() === wanted);
  if (!project) {
    throw new Error(
      `No project with key or name "${key.trim()}". Use listProjects to see the real projects; do not invent one.`,
    );
  }
  return project;
}

const getPortfolioStateTool: ReadTool<Record<string, never>> = {
  name: "getPortfolioState",
  kind: "read",
  description:
    "Deterministic summary of every project: active sprint, progress, open/blocked work, risk counts, velocity, last activity. Start here.",
  tier: "auto",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  read: (ctx) => ctx.services.portfolioState(),
};

const getProjectDetailSchema = z.object({ projectKey: z.string().min(1).max(50) });

const getProjectDetailTool: ReadTool<z.infer<typeof getProjectDetailSchema>> = {
  name: "getProjectDetail",
  kind: "read",
  description:
    "Look deeper into ONE project: its active sprint contents, open risks with evidence, blocked issues, and recent activity. Use only after the portfolio summary points at a project.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { projectKey: { type: "string", description: 'Project key, e.g. "ECOM"' } },
    required: ["projectKey"],
  },
  schema: getProjectDetailSchema,
  read: async (ctx, args) => {
    const project = requireProjectByKey(ctx.db, args.projectKey);
    const state = await ctx.services.projectState(project.id);
    const issues = issuesRepo.listIssuesByProject(ctx.db, project.id);
    const dependencies = dependenciesRepo.listDependenciesForProject(ctx.db, project.id);
    const active = sprintsRepo.getActiveSprint(ctx.db, project.id);
    const byId = new Map(issues.map((i) => [i.id, i]));

    return {
      project: { key: project.key, name: project.name },
      metrics: state.metrics,
      activeSprint: active
        ? {
            name: active.name,
            goal: active.goal,
            startedAt: active.startedAt,
            ...sprintsDomain.sprintPoints(ctx.db, active.id),
            // Bounded: the sprint's own unfinished work, not the whole project.
            unfinished: issuesRepo
              .listIssuesBySprint(ctx.db, active.id)
              .filter((i) => i.status !== "done")
              .slice(0, 25)
              .map((i) => `${i.key} "${i.title}" ${i.status}/${i.priority} ${i.storyPoints ?? "?"}pts`),
          }
        : null,
      risks: state.risks.map((r) => ({ severity: r.severity, type: r.type, message: r.message, evidence: r.evidence })),
      blocked: issuesDomain
        .findBlockedIssues(ctx.db, issues, dependencies)
        .slice(0, 25)
        .map((issue) => {
          const blockers = dependencies
            .filter((d) => d.issueId === issue.id)
            .map((d) => byId.get(d.dependsOnIssueId))
            .filter((b) => b && b.status !== "done")
            .map((b) => b!.key);
          return `${issue.key} "${issue.title}" blocked by ${blockers.join(", ")}`;
        }),
      velocity: sprintsDomain.getVelocity(ctx.db, project.id),
      recentActivity: activitiesRepo
        .listActivityByProject(ctx.db, project.id, 10)
        .map((a) => `${a.createdAt} ${a.type}`),
    };
  },
};

const listProjectDecisionsSchema = z.object({ projectKey: z.string().min(1).max(50) });

const listProjectDecisionsTool: ReadTool<z.infer<typeof listProjectDecisionsSchema>> = {
  name: "listProjectDecisions",
  kind: "read",
  description: "Recorded decisions for one project -- the answer to 'why did that project choose X'.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { projectKey: { type: "string" } },
    required: ["projectKey"],
  },
  schema: listProjectDecisionsSchema,
  read: (ctx, args) => {
    const project = requireProjectByKey(ctx.db, args.projectKey);
    return {
      project: project.key,
      decisions: memoryDomain
        .listDecisionsByProject(ctx.db, project.id)
        .slice(0, 20)
        .map((d) => ({ title: d.title, decision: d.decision, rationale: d.rationale, decidedAt: d.decidedAt })),
    };
  },
};

export const PORTFOLIO_TOOLS: ReadTool[] = [
  getPortfolioStateTool,
  getProjectDetailTool,
  listProjectDecisionsTool,
];
