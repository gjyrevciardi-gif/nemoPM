import type { FastifyInstance } from "fastify";
import { getDb } from "@ai-pm/database";
import { AIUnavailableError } from "@ai-pm/ai";
import { AgentRequestSchema, ApiError } from "@ai-pm/shared";
import { parseOrThrow } from "../lib/errors.js";
import { buildPortfolioState, buildProjectSummary } from "../lib/portfolio.js";
import { runPortfolioAgent } from "../lib/portfolio-agent.js";

export async function portfolioRoutes(app: FastifyInstance) {
  const db = getDb();

  // Deterministic and useful without any AI -- the home page renders this.
  app.get("/portfolio/state", async () => buildPortfolioState(db));

  app.get<{ Params: { projectId: string } }>("/projects/:projectId/summary", async (req) =>
    buildProjectSummary(db, req.params.projectId),
  );

  app.post("/agent", async (req) => {
    const input = parseOrThrow(AgentRequestSchema, req.body);
    try {
      return await runPortfolioAgent(db, input.message);
    } catch (err) {
      if (err instanceof AIUnavailableError) {
        throw new ApiError(
          503,
          "AI_UNAVAILABLE",
          `NEMO requires a running local model and none is available: ${err.message}`,
        );
      }
      throw err;
    }
  });
}
