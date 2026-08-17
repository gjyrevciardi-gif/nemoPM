import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "@ai-pm/database";
import { buildServer } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/src -> repo root is three levels up (src -> api -> apps -> root).
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

const PORT = Number(process.env.API_PORT ?? 43821);
const HOST = "127.0.0.1";

async function main() {
  // Fail fast with a clear message if the database can't be opened/migrated,
  // rather than surfacing a confusing error on the first request.
  getDb();

  const app = buildServer();
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`AI PM API listening on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error("Failed to start API server:", err);
  process.exit(1);
});
