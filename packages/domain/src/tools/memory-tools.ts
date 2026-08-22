import { z } from "zod";
import { projectsRepo } from "@ai-pm/database";
import * as memoryDomain from "../memory.js";
import type { WriteTool } from "./types.js";
import { findIssueByKey, requireProjectId } from "./helpers.js";

// -- decisions ---------------------------------------------------------------

const createDecisionSchema = z.object({
  title: z.string().min(1).max(300),
  context: z.string().max(4000).optional(),
  decision: z.string().max(4000).optional(),
  rationale: z.string().max(4000).optional(),
  issueKey: z.string().max(50).optional(),
});

const createDecisionTool: WriteTool<z.infer<typeof createDecisionSchema>> = {
  name: "createDecision",
  kind: "write",
  description:
    "Record a project decision so it can be recalled later: what was decided, the situation that forced it, and why. " +
    "Record only what the user actually said -- never infer a rationale they did not give.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: 'Short name, e.g. "Use Redis for token revocation"' },
      context: { type: "string", description: "The situation that forced a choice" },
      decision: { type: "string", description: "What was chosen" },
      rationale: { type: "string", description: "Why this option won -- only if the user gave a reason" },
      issueKey: { type: "string", description: "Related issue key, optional" },
    },
    required: ["title"],
  },
  schema: createDecisionSchema,
  describe: (_ctx, args) => `Record decision "${args.title}"`,
  execute: (ctx, args) => {
    const issue = args.issueKey ? findIssueByKey(ctx, args.issueKey) : null;
    const decision = memoryDomain.createDecision(ctx.db, requireProjectId(ctx), {
      title: args.title,
      context: args.context,
      decision: args.decision,
      rationale: args.rationale,
      issueId: issue?.id ?? null,
    });
    return { summary: `Recorded decision: ${decision.title}` };
  },
};

// -- milestones --------------------------------------------------------------

const createMilestoneSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  status: z.enum(["planned", "reached"]).optional(),
  occurredAt: z.string().max(40).optional(),
});

const createMilestoneTool: WriteTool<z.infer<typeof createMilestoneSchema>> = {
  name: "createMilestone",
  kind: "write",
  description:
    "Record a milestone the user states (a release, a phase). Do not invent milestones from Git history or activity.",
  tier: "auto",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      status: { type: "string", enum: ["planned", "reached"] },
      occurredAt: { type: "string", description: "ISO date, defaults to now" },
    },
    required: ["title"],
  },
  schema: createMilestoneSchema,
  describe: (_ctx, args) => `Record milestone "${args.title}" (${args.status ?? "planned"})`,
  execute: (ctx, args) => {
    const milestone = memoryDomain.createMilestone(ctx.db, requireProjectId(ctx), {
      title: args.title,
      description: args.description,
      status: args.status,
      source: "manual",
      occurredAt: args.occurredAt,
    });
    return { summary: `Recorded milestone: ${milestone.title}` };
  },
};

// -- notes -------------------------------------------------------------------

const addNoteSchema = z.object({ note: z.string().min(1).max(4000) });

const addProjectNoteTool: WriteTool<z.infer<typeof addNoteSchema>> = {
  name: "addProjectNote",
  kind: "write",
  description: "Save a short free-text note about the project for later recall.",
  tier: "auto",
  parameters: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
  schema: addNoteSchema,
  describe: (_ctx, args) => `Save note: ${args.note.slice(0, 80)}${args.note.length > 80 ? "…" : ""}`,
  execute: (ctx, args) => {
    memoryDomain.createNote(ctx.db, requireProjectId(ctx), args.note);
    return { summary: "Note saved" };
  },
};

// -- project -----------------------------------------------------------------

const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
});

const updateProjectTool: WriteTool<z.infer<typeof updateProjectSchema>> = {
  name: "updateProject",
  kind: "write",
  description: "Change this project's name or description. Cannot change its key or repository path.",
  tier: "ask",
  parameters: {
    type: "object",
    properties: { name: { type: "string" }, description: { type: "string" } },
    required: [],
  },
  schema: updateProjectSchema,
  describe: (ctx, args) => {
    const project = projectsRepo.getProject(ctx.db, requireProjectId(ctx));
    const changes = [args.name ? `rename to "${args.name}"` : null, args.description ? "update description" : null]
      .filter(Boolean)
      .join(", ");
    return `Project "${project?.name ?? "unknown"}": ${changes || "no changes"}`;
  },
  execute: (ctx, args) => {
    if (args.name === undefined && args.description === undefined) {
      throw new Error("updateProject needs a name or a description.");
    }
    const updated = projectsRepo.updateProject(ctx.db, requireProjectId(ctx), {
      name: args.name,
      description: args.description,
    });
    if (!updated) throw new Error("Project not found.");
    return { summary: `Updated project "${updated.name}"` };
  },
};

/**
 * Registered so the permission engine can refuse it by name, never exposed to
 * a model. Deleting a project is a human-only action in the web app.
 */
const deleteProjectTool: WriteTool<Record<string, never>> = {
  name: "deleteProject",
  kind: "write",
  description: "Blocked: project deletion is never available to the agent.",
  tier: "blocked",
  parameters: { type: "object", properties: {}, required: [] },
  schema: z.object({}).passthrough().transform(() => ({}) as Record<string, never>),
  describe: () => "Project deletion is blocked.",
  execute: () => {
    throw new Error("Project deletion is blocked and cannot be performed by the agent.");
  },
};

export const MEMORY_TOOLS = [createDecisionTool, createMilestoneTool, addProjectNoteTool];
export const PROJECT_TOOLS = [updateProjectTool, deleteProjectTool];
