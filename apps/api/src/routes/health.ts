import type { FastifyInstance } from "fastify";
import { getAIHealth } from "../lib/ai.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));
  app.get("/ai/health", async () => getAIHealth());
}
