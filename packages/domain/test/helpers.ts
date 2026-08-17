import type Database from "better-sqlite3";
import type { GitStatus } from "@ai-pm/shared";
import type { ToolContext, WriteTool, ReadTool } from "../src/index.js";
import { getAgentTool } from "../src/index.js";

const OFFLINE_GIT: GitStatus = {
  connected: false,
  repositoryPath: null,
  error: "No repository linked in tests.",
  branch: null,
  isClean: null,
  stagedFiles: [],
  unstagedFiles: [],
  recentCommits: [],
  latestCommitAt: null,
};

/** A ToolContext for domain tests: real database, stubbed API-level services. */
export function toolContext(
  db: Database.Database,
  projectId: string | null,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    db,
    projectId,
    codeContext: null,
    services: {
      projectState: async () => {
        throw new Error("projectState is an API-level service and is not stubbed here.");
      },
      gitStatus: async () => OFFLINE_GIT,
    },
    ...overrides,
  };
}

export function writeTool(name: string): WriteTool {
  const tool = getAgentTool(name);
  if (!tool || tool.kind !== "write") throw new Error(`${name} is not a registered write tool`);
  return tool;
}

export function readTool(name: string): ReadTool {
  const tool = getAgentTool(name);
  if (!tool || tool.kind !== "read") throw new Error(`${name} is not a registered read tool`);
  return tool;
}

/** Parse + execute in one step, the way the agent does after the permission engine. */
export function runWrite(ctx: ToolContext, name: string, rawArgs: unknown): string {
  const tool = writeTool(name);
  return tool.execute(ctx, tool.schema.parse(rawArgs)).summary;
}

export function describeWrite(ctx: ToolContext, name: string, rawArgs: unknown): string {
  const tool = writeTool(name);
  return tool.describe(ctx, tool.schema.parse(rawArgs));
}
