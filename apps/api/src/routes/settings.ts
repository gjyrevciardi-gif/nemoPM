import type { FastifyInstance } from "fastify";
import { getDb, settingsRepo } from "@ai-pm/database";
import { UpdateRiskThresholdsInputSchema } from "@ai-pm/shared";
import { parseOrThrow } from "../lib/errors.js";

export async function settingsRoutes(app: FastifyInstance) {
  const db = getDb();

  app.get("/settings/risk-thresholds", async () => {
    return settingsRepo.getRiskThresholds(db);
  });

  app.put("/settings/risk-thresholds", async (req) => {
    const input = parseOrThrow(UpdateRiskThresholdsInputSchema, req.body);
    return settingsRepo.setRiskThresholds(db, input);
  });
}
