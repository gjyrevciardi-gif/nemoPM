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
import { settingsRoutes } from "./routes/settings.js";

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
  app.register(settingsRoutes);

  return app;
}
