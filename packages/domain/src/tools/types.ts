import type Database from "better-sqlite3";
import type { z } from "zod";
import type { CodeContext, GitStatus, PermissionTier, ProjectState } from "@ai-pm/shared";

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string; properties?: Record<string, JsonSchemaProperty>; required?: string[] };
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

/**
 * Capabilities the domain can't compute on its own -- project state folds in
 * the risk engine and Git, both of which live above this layer. Injected by
 * the API so tools stay pure database + domain calls.
 */
export interface ToolServices {
  projectState(projectId: string): Promise<ProjectState>;
  gitStatus(projectId: string): Promise<GitStatus>;
}

export interface ToolContext {
  db: Database.Database;
  /** The project this turn is scoped to; null on portfolio turns. */
  projectId: string | null;
  /** Editor context supplied by the VS Code extension for this turn, if any. */
  codeContext: CodeContext | null;
  services: ToolServices;
}

interface BaseTool<Args> {
  name: string;
  description: string;
  tier: PermissionTier;
  parameters: JsonSchema;
  schema: z.ZodType<Args, z.ZodTypeDef, any>;
}

/**
 * A tool that answers a question. Always safe to run during a turn, which is
 * what lets the agent look things up iteratively instead of being handed the
 * whole database in its prompt.
 */
export interface ReadTool<Args = any> extends BaseTool<Args> {
  kind: "read";
  read(ctx: ToolContext, args: Args): Promise<unknown> | unknown;
}

/**
 * A tool that changes something. `describe` must be side-effect free: it is
 * what the human reads before approving, and it runs against the same state
 * `execute` will later mutate.
 */
export interface WriteTool<Args = any> extends BaseTool<Args> {
  kind: "write";
  describe(ctx: ToolContext, args: Args): string;
  execute(ctx: ToolContext, args: Args): { summary: string };
  /** Facts backing this action, shown as evidence on the approval card. */
  evidence?(ctx: ToolContext, args: Args): string[];
  /** Story points this action moves into a sprint, for the plan's point total. */
  points?(ctx: ToolContext, args: Args): number;
}

export type AgentTool<Args = any> = ReadTool<Args> | WriteTool<Args>;

export function isWriteTool(tool: AgentTool): tool is WriteTool {
  return tool.kind === "write";
}
