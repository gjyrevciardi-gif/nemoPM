import { z } from "zod";
import { dependenciesRepo, issuesRepo, sprintsRepo } from "@ai-pm/database";
import * as sprintsDomain from "../sprints.js";
import * as issuesDomain from "../issues.js";
import type { WriteTool } from "./types.js";
import {
  findIssueByKey,
  findIssuesByKeys,
  findSprintByName,
  pointsOf,
  requireActiveSprint,
  requireProjectId,
} from "./helpers.js";

const sprintName = z.string().min(1).max(200);
const issueKey = z.string().min(1).max(50);

/** Blocked work among a proposed sprint scope -- the risk a plan must not hide. */
function blockedWarnings(ctx: Parameters<typeof findIssueByKey>[0], issueIds: string[]): string[] {
  const projectId = requireProjectId(ctx);
  const issues = issuesRepo.listIssuesByProject(ctx.db, projectId);
  const byId = new Map(issues.map((i) => [i.id, i]));
  const dependencies = dependenciesRepo.listDependenciesForProject(ctx.db, projectId);
  const selected = new Set(issueIds);

  const warnings: string[] = [];
  for (const dep of dependencies) {
    if (!selected.has(dep.issueId)) continue;
    const blocker = byId.get(dep.dependsOnIssueId);
    const blocked = byId.get(dep.issueId);
    if (!blocker || !blocked || blocker.status === "done") continue;
    warnings.push(
      `${blocked.key} is blocked by ${blocker.key} ("${blocker.title}", ${blocker.status})` +
        (selected.has(blocker.id) ? " -- both are in this sprint" : " -- which is not in this sprint"),
    );
  }
  return warnings;
}

function velocityLine(ctx: Parameters<typeof findIssueByKey>[0]): string {
  const velocity = sprintsDomain.getVelocity(ctx.db, requireProjectId(ctx));
  return velocity.average === null
    ? "Previous velocity: no completed sprints yet"
    : `Previous velocity: ${velocity.average} pts (avg of ${velocity.sampleSize} completed sprint(s): ` +
        `${velocity.sprints.map((s) => `${s.name} ${s.completedPoints}`).join(", ")})`;
}

// -- createSprint / updateSprint / setSprintGoal -----------------------------

const createSprintSchema = z.object({ name: sprintName, goal: z.string().max(2000).optional() });

const createSprintTool: WriteTool<z.infer<typeof createSprintSchema>> = {
  name: "createSprint",
  kind: "write",
  description: "Create a sprint in the planned state, without starting it.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { name: { type: "string" }, goal: { type: "string" } },
    required: ["name"],
  },
  schema: createSprintSchema,
  describe: (_ctx, args) => `Create sprint "${args.name}"${args.goal ? ` — ${args.goal}` : ""} (not started)`,
  execute: (ctx, args) => {
    const sprint = sprintsDomain.createSprint(ctx.db, {
      projectId: requireProjectId(ctx),
      name: args.name,
      goal: args.goal,
    });
    return { summary: `Created sprint "${sprint.name}"` };
  },
};

const updateSprintSchema = z.object({
  sprintName,
  newName: sprintName.optional(),
  goal: z.string().max(2000).optional(),
});

const updateSprintTool: WriteTool<z.infer<typeof updateSprintSchema>> = {
  name: "updateSprint",
  kind: "write",
  description: "Rename a sprint or change its goal.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { sprintName: { type: "string" }, newName: { type: "string" }, goal: { type: "string" } },
    required: ["sprintName"],
  },
  schema: updateSprintSchema,
  describe: (ctx, args) => {
    const sprint = findSprintByName(ctx, args.sprintName, { includeCompleted: true });
    const changes = [args.newName ? `rename to "${args.newName}"` : null, args.goal ? "set goal" : null].filter(
      Boolean,
    );
    return `Update sprint "${sprint.name}": ${changes.join(", ") || "no changes"}`;
  },
  execute: (ctx, args) => {
    const sprint = findSprintByName(ctx, args.sprintName, { includeCompleted: true });
    const updated = sprintsDomain.updateSprint(ctx.db, sprint.id, { name: args.newName, goal: args.goal });
    return { summary: `Updated sprint "${updated.name}"` };
  },
};

const setSprintGoalSchema = z.object({ goal: z.string().min(1).max(2000), sprintName: sprintName.optional() });

const setSprintGoalTool: WriteTool<z.infer<typeof setSprintGoalSchema>> = {
  name: "setSprintGoal",
  kind: "write",
  description: "Set the goal text of a sprint. Defaults to the active sprint.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: { goal: { type: "string" }, sprintName: { type: "string" } },
    required: ["goal"],
  },
  schema: setSprintGoalSchema,
  describe: (ctx, args) => {
    const sprint = args.sprintName ? findSprintByName(ctx, args.sprintName) : requireActiveSprint(ctx);
    return `Set goal of "${sprint.name}"`;
  },
  execute: (ctx, args) => {
    const sprint = args.sprintName ? findSprintByName(ctx, args.sprintName) : requireActiveSprint(ctx);
    sprintsDomain.updateSprint(ctx.db, sprint.id, { goal: args.goal });
    return { summary: `Goal of "${sprint.name}" set` };
  },
};

// -- start / complete --------------------------------------------------------

const startSprintSchema = z.object({ sprintName });

const startSprintTool: WriteTool<z.infer<typeof startSprintSchema>> = {
  name: "startSprint",
  kind: "write",
  description:
    "Start a planned sprint. Fails if another sprint is already active -- complete that one first.",
  tier: "ask",
  parameters: { type: "object", properties: { sprintName: { type: "string" } }, required: ["sprintName"] },
  schema: startSprintSchema,
  describe: (ctx, args) => {
    const sprint = findSprintByName(ctx, args.sprintName);
    const active = sprintsRepo.getActiveSprint(ctx.db, requireProjectId(ctx));
    if (active && active.id !== sprint.id) {
      return `Start sprint "${sprint.name}" — BLOCKED while "${active.name}" is active; complete it first`;
    }
    return `Start sprint "${sprint.name}"`;
  },
  execute: (ctx, args) => {
    const sprint = findSprintByName(ctx, args.sprintName);
    const started = sprintsDomain.startSprint(ctx.db, sprint.id);
    return { summary: `Started sprint "${started.name}"` };
  },
};

const completeSprintSchema = z.object({ sprintName: sprintName.optional() });

const completeSprintTool: WriteTool<z.infer<typeof completeSprintSchema>> = {
  name: "completeSprint",
  kind: "write",
  description: "Mark a sprint complete. Defaults to the currently active sprint.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { sprintName: { type: "string", description: "Optional; defaults to the active sprint" } },
    required: [],
  },
  schema: completeSprintSchema,
  describe: (ctx, args) => {
    const sprint = args.sprintName ? findSprintByName(ctx, args.sprintName) : requireActiveSprint(ctx);
    const points = sprintsDomain.sprintPoints(ctx.db, sprint.id);
    return (
      `Complete sprint "${sprint.name}" (${points.completed}/${points.total} pts done` +
      (points.unfinishedCount > 0 ? `, ${points.unfinishedCount} issue(s) unfinished)` : ")")
    );
  },
  evidence: (ctx, args) => {
    const sprint = args.sprintName ? findSprintByName(ctx, args.sprintName) : requireActiveSprint(ctx);
    const points = sprintsDomain.sprintPoints(ctx.db, sprint.id);
    const unfinished = issuesRepo.listIssuesBySprint(ctx.db, sprint.id).filter((i) => i.status !== "done");
    return [
      `"${sprint.name}" delivered ${points.completed} of ${points.total} pts`,
      unfinished.length > 0
        ? `${unfinished.length} unfinished issue(s) will stay in the completed sprint unless carried over: ${unfinished
            .map((i) => i.key)
            .join(", ")}`
        : "All issues in this sprint are done",
    ];
  },
  execute: (ctx, args) => {
    const sprint = args.sprintName ? findSprintByName(ctx, args.sprintName) : requireActiveSprint(ctx);
    sprintsDomain.completeSprint(ctx.db, sprint.id);
    return { summary: `Completed sprint "${sprint.name}"` };
  },
};

// -- sprint scope ------------------------------------------------------------

const addToSprintSchema = z.object({ issueKey, sprintName });

const addIssueToSprintTool: WriteTool<z.infer<typeof addToSprintSchema>> = {
  name: "addIssueToSprint",
  kind: "write",
  description: "Move an issue into an existing (non-completed) sprint by name.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { issueKey: { type: "string" }, sprintName: { type: "string" } },
    required: ["issueKey", "sprintName"],
  },
  schema: addToSprintSchema,
  describe: (ctx, args) =>
    `Move ${findIssueByKey(ctx, args.issueKey).key} into sprint "${findSprintByName(ctx, args.sprintName).name}"`,
  points: (ctx, args) => findIssueByKey(ctx, args.issueKey).storyPoints ?? 0,
  execute: (ctx, args) => {
    const issue = findIssueByKey(ctx, args.issueKey);
    const sprint = findSprintByName(ctx, args.sprintName);
    sprintsDomain.addIssueToSprint(ctx.db, issue.id, sprint.id);
    return { summary: `Moved ${issue.key} into "${sprint.name}"` };
  },
};

const removeFromSprintSchema = z.object({ issueKeys: z.array(issueKey).min(1).max(50) });

const removeIssueFromSprintTool: WriteTool<z.infer<typeof removeFromSprintSchema>> = {
  name: "removeIssueFromSprint",
  kind: "write",
  description: "Take issues out of their sprint and return them to the backlog.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { issueKeys: { type: "array", items: { type: "string" } } },
    required: ["issueKeys"],
  },
  schema: removeFromSprintSchema,
  describe: (ctx, args) => {
    const issues = findIssuesByKeys(ctx, args.issueKeys);
    return `Remove ${issues.length} issue(s) from their sprint, back to backlog: ${issues
      .map((i) => `${i.key} (${i.storyPoints ?? 0} pts, ${i.priority})`)
      .join(", ")}`;
  },
  evidence: (ctx, args) => {
    const issues = findIssuesByKeys(ctx, args.issueKeys);
    return [`Removing ${pointsOf(issues)} pts from sprint scope`];
  },
  execute: (ctx, args) => {
    const issues = findIssuesByKeys(ctx, args.issueKeys);
    for (const issue of issues) sprintsDomain.removeIssueFromSprint(ctx.db, issue.id);
    return { summary: `Removed ${issues.map((i) => i.key).join(", ")} from their sprint` };
  },
};

const carryOverSchema = z.object({ fromSprintName: sprintName.optional(), toSprintName: sprintName });

const carryOverTool: WriteTool<z.infer<typeof carryOverSchema>> = {
  name: "carryOverUnfinishedIssues",
  kind: "write",
  description:
    "Move every unfinished issue from one sprint into another. Source defaults to the active sprint. Finished issues stay put.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { fromSprintName: { type: "string" }, toSprintName: { type: "string" } },
    required: ["toSprintName"],
  },
  schema: carryOverSchema,
  describe: (ctx, args) => {
    const from = args.fromSprintName
      ? findSprintByName(ctx, args.fromSprintName, { includeCompleted: true })
      : requireActiveSprint(ctx);
    const to = findSprintByName(ctx, args.toSprintName);
    const unfinished = issuesRepo.listIssuesBySprint(ctx.db, from.id).filter((i) => i.status !== "done");
    const lines = [
      `Carry ${unfinished.length} unfinished issue(s) from "${from.name}" into "${to.name}" (${pointsOf(
        unfinished,
      )} pts):`,
    ];
    for (const issue of unfinished) lines.push(`  ${issue.key} "${issue.title}" (${issue.status})`);
    return lines.join("\n");
  },
  points: (ctx, args) => {
    const from = args.fromSprintName
      ? findSprintByName(ctx, args.fromSprintName, { includeCompleted: true })
      : requireActiveSprint(ctx);
    return pointsOf(issuesRepo.listIssuesBySprint(ctx.db, from.id).filter((i) => i.status !== "done"));
  },
  execute: (ctx, args) => {
    const from = args.fromSprintName
      ? findSprintByName(ctx, args.fromSprintName, { includeCompleted: true })
      : requireActiveSprint(ctx);
    const to = findSprintByName(ctx, args.toSprintName);
    if (from.id === to.id) throw new Error("Source and destination sprint are the same.");
    const carried = sprintsDomain.carryOverUnfinishedIssues(ctx.db, from.id, to.id);
    return { summary: `Carried ${carried.length} unfinished issue(s) from "${from.name}" into "${to.name}"` };
  },
};

// -- planSprint (the flagship composite) -------------------------------------

const planSprintSchema = z.object({
  name: z.preprocess(value=>typeof value==="string"&&value.trim()===""?undefined:value,sprintName.optional()).transform(value=>value?.trim()||"Next Sprint"),
  goal: z.string().max(2000).optional(),
  issueKeys: z.array(issueKey).max(50).default([]),
  carryOverFromActiveSprint: z.boolean().optional(),
  completeActiveSprint: z.boolean().optional(),
  start: z.boolean().optional(),
  maxPoints: z.number().min(0).max(1000).optional(),
  avoidBlocked: z.boolean().optional(),
});

function issuesForPlan(ctx:Parameters<typeof findIssueByKey>[0],args:z.infer<typeof planSprintSchema>){
  let selected=findIssuesByKeys(ctx,args.issueKeys);
  if(selected.length===0 && args.maxPoints!==undefined){
    const projectId=requireProjectId(ctx);
    const all=issuesRepo.listIssuesByProject(ctx.db,projectId);
    const blocked=new Set(dependenciesRepo.listDependenciesForProject(ctx.db,projectId).filter(dep=>all.find(i=>i.id===dep.dependsOnIssueId)?.status!=="done").map(dep=>dep.issueId));
    const rank:Record<string,number>={critical:0,high:1,medium:2,low:3};
    let used=0;
    selected=all.filter(i=>!i.sprintId&&i.status!=="done"&&(!args.avoidBlocked||!blocked.has(i.id))).sort((a,b)=>(rank[a.priority]??9)-(rank[b.priority]??9)||a.position-b.position).filter(issue=>{const points=issue.storyPoints??0;if(used+points>args.maxPoints!)return false;used+=points;return true;});
  }
  if(args.avoidBlocked){
    const warnings=blockedWarnings(ctx,selected.map(i=>i.id));
    if(warnings.length>0) throw new Error(`Plan includes blocked work: ${warnings.join("; ")}`);
  }
  return selected;
}

const planSprintTool: WriteTool<z.infer<typeof planSprintSchema>> = {
  name: "planSprint",
  kind: "write",
  // Descriptions are prompt cost paid on every tool-calling round trip, so they
  // carry only what the model needs to choose correctly: when to pick this tool
  // and the one rule it must respect.
  description:
    "Plan the next sprint: create it, add the given issues, optionally carry unfinished work over, and start it. " +
    "Set maxPoints to enforce a capacity cap; if issueKeys is empty NEMO deterministically selects priority backlog within it. Set avoidBlocked to exclude blocked work. Only one sprint can be active, so starting one requires completeActiveSprint.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string",description:"Name for the new sprint; omit to use Next Sprint" },
      goal: { type: "string" },
      issueKeys: { type: "array", items: { type: "string" }, description: "Existing issue keys" },
      carryOverFromActiveSprint: { type: "boolean", description: "Move unfinished work from the active sprint" },
      completeActiveSprint: { type: "boolean", description: "Close the active sprint as part of this plan" },
      start: { type: "boolean", description: "Start it now (default true)" },
      maxPoints:{type:"number",description:"Hard maximum story points for selected backlog work"},
      avoidBlocked:{type:"boolean",description:"Exclude/reject issues with unfinished dependencies"},
    },
    required: [],
  },
  schema: planSprintSchema,
  describe: (ctx, args) => {
    const issues = issuesForPlan(ctx,args);
    const active = sprintsRepo.getActiveSprint(ctx.db, requireProjectId(ctx));
    const carried =
      args.carryOverFromActiveSprint && active
        ? issuesRepo.listIssuesBySprint(ctx.db, active.id).filter((i) => i.status !== "done")
        : [];
    const total=pointsOf([...issues,...carried]);
    if(args.maxPoints!==undefined&&total>args.maxPoints) throw new Error(`Plan totals ${total} points, above maxPoints ${args.maxPoints}.`);

    const lines = [`Create sprint "${args.name}"${args.goal ? ` — ${args.goal}` : ""}`];
    for (const issue of issues) lines.push(`  + ${issue.key} "${issue.title}" (${issue.storyPoints ?? 0} pts, ${issue.priority})`);
    for (const issue of carried) lines.push(`  ~ carry ${issue.key} "${issue.title}" (${issue.storyPoints ?? 0} pts, ${issue.status})`);
    if (active && args.completeActiveSprint) lines.push(`  ! complete active sprint "${active.name}"`);
    if (args.start !== false) lines.push("  > start it");
    lines.push(`  Total: ${total} pts`);
    return lines.join("\n");
  },
  points: (ctx, args) => {
    const issues = issuesForPlan(ctx,args);
    const active = sprintsRepo.getActiveSprint(ctx.db, requireProjectId(ctx));
    const carried =
      args.carryOverFromActiveSprint && active
        ? issuesRepo.listIssuesBySprint(ctx.db, active.id).filter((i) => i.status !== "done")
        : [];
    const total=pointsOf([...issues,...carried]);
    if(args.maxPoints!==undefined&&total>args.maxPoints) throw new Error(`Plan totals ${total} points, above maxPoints ${args.maxPoints}.`);
    return total;
  },
  evidence: (ctx, args) => {
    const issues = issuesForPlan(ctx,args);
    const active = sprintsRepo.getActiveSprint(ctx.db, requireProjectId(ctx));
    const carried =
      args.carryOverFromActiveSprint && active
        ? issuesRepo.listIssuesBySprint(ctx.db, active.id).filter((i) => i.status !== "done")
        : [];

    const evidence = [velocityLine(ctx)];
    if (active) {
      const points = sprintsDomain.sprintPoints(ctx.db, active.id);
      evidence.push(
        `Active sprint "${active.name}": ${points.completed}/${points.total} pts done, ${points.unfinishedCount} issue(s) unfinished`,
      );
    } else {
      evidence.push("No sprint is currently active");
    }
    if (carried.length > 0) {
      evidence.push(`Carrying ${carried.length} unfinished issue(s) (${pointsOf(carried)} pts): ${carried.map((i) => i.key).join(", ")}`);
    }
    if (issues.length > 0) {
      const byPriority = issues.reduce<Record<string, number>>((acc, issue) => {
        acc[issue.priority] = (acc[issue.priority] ?? 0) + 1;
        return acc;
      }, {});
      evidence.push(
        `Selected ${issues.length} backlog issue(s) (${pointsOf(issues)} pts): ` +
          Object.entries(byPriority)
            .map(([priority, count]) => `${count} ${priority}`)
            .join(", "),
      );
    }
    evidence.push(`Planned total: ${pointsOf([...issues, ...carried])} pts`);
    return evidence;
  },
  execute: (ctx, args) => {
    const projectId = requireProjectId(ctx);
    const issues = issuesForPlan(ctx,args);
    const active = sprintsRepo.getActiveSprint(ctx.db, projectId);
    const carried=args.carryOverFromActiveSprint&&active?issuesRepo.listIssuesBySprint(ctx.db,active.id).filter(i=>i.status!=="done"):[];
    const total=pointsOf([...issues,...carried]);
    if(args.maxPoints!==undefined&&total>args.maxPoints) throw new Error(`Plan totals ${total} points, above maxPoints ${args.maxPoints}.`);
    const result = sprintsDomain.planSprint(ctx.db, projectId, {
      name: args.name,
      goal: args.goal,
      issueIds: issues.map((i) => i.id),
      carryOver: args.carryOverFromActiveSprint,
      completeActive: args.completeActiveSprint,
      start: args.start !== false,
    });

    const parts = [
      `Created "${result.sprint.name}" with ${result.addedIssues.length} issue(s)`,
      result.carriedIssues.length > 0 ? `carried ${result.carriedIssues.length} unfinished issue(s)` : null,
      result.completedSprint ? `completed "${result.completedSprint.name}"` : null,
      result.sprint.status === "active" ? "and started it" : null,
    ].filter(Boolean);
    return { summary: parts.join(", ") };
  },
};

export const SPRINT_TOOLS = [
  createSprintTool,
  updateSprintTool,
  setSprintGoalTool,
  startSprintTool,
  completeSprintTool,
  addIssueToSprintTool,
  removeIssueFromSprintTool,
  carryOverTool,
  planSprintTool,
];

export { blockedWarnings, issuesDomain };
