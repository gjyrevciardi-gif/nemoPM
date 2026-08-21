import Fastify from "fastify";
import cors from "@fastify/cors";
import { ApiError } from "@ai-pm/shared";

import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { issueRoutes } from "./routes/issues.js";
import { sprintRoutes } from "./routes/sprints.js";
import { activityRoutes } from "./routes/activity.js";
import { gitRoutes } from "./routes/git.js";
import { stateRoutes } from "./routes/state.js";
import { riskRoutes } from "./routes/risks.js";
import { aiRoutes } from "./routes/ai.js";
import { agentRoutes } from "./routes/agent.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { memoryRoutes } from "./routes/memory.js";
import { settingsRoutes } from "./routes/settings.js";
import { eventRoutes } from "./routes/events.js";
import { publishChange } from "./lib/events.js";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** POSTs that only ask the model something -- they write nothing to change. */
const READ_ONLY_POSTS = [/\/ai\/status$/, /\/ai\/plan-task$/];

function isChange(method: string, statusCode: number, path: string): boolean {
  if (!MUTATING_METHODS.has(method) || statusCode >= 400) return false;
  return !READ_ONLY_POSTS.some((pattern) => pattern.test(path));
}

/**
 * Best effort: the project the change belongs to. Project-scoped routes carry
 * it in the path; routes keyed by another entity (/issues/:id, /sprints/:id)
 * carry it in the entity they return. Null means "unknown", which clients
 * treat as "refresh everything" rather than risk showing stale data.
 */
function projectIdOf(path: string, payload: unknown): string | null {
  const fromPath = /^\/projects\/([^/?]+)/.exec(path)?.[1];
  if (fromPath) return decodeURIComponent(fromPath);

  if (typeof payload === "string" && payload.startsWith("{")) {
    try {
      const body = JSON.parse(payload) as { projectId?: unknown };
      if (typeof body.projectId === "string") return body.projectId;
    } catch {
      // Not JSON we understand -- fall through to "unknown".
    }
  }
  return null;
}

export function buildServer() {
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const app = Fastify({
    logger: isTest
      ? false
      : {
          level: process.env.LOG_LEVEL ?? "info",
          transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
        },
  });

  app.register(cors, {
    origin: true, // local-first single-user app; the web UI and VS Code extension both call this API from localhost.
  });

  // One choke point for live sync: every successful write, whoever made it --
  // the web app, the VS Code extension, the agent applying its own tools --
  // leaves through here, so no route can forget to announce its change.
  app.addHook("onSend", async (req, reply, payload) => {
    if (isChange(req.method, reply.statusCode, req.url)) {
      publishChange({
        projectId: projectIdOf(req.url, payload),
        method: req.method,
        path: req.url,
        at: new Date().toISOString(),
      });
    }
    return payload;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    app.log.error(err);
    reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
  });

  app.register(healthRoutes);
  app.register(projectRoutes);
  app.register(issueRoutes);
  app.register(sprintRoutes);
  app.register(activityRoutes);
  app.register(gitRoutes);
  app.register(stateRoutes);
  app.register(riskRoutes);
  app.register(aiRoutes);
  app.register(agentRoutes);
  app.register(settingsRoutes);
  app.register(portfolioRoutes);
  app.register(memoryRoutes);
  app.register(eventRoutes);

  return app;
}
