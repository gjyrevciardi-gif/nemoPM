import Database from "better-sqlite3";
import { config as loadEnv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This package always physically lives at <repo root>/packages/database,
// whether executed from source (src/) or compiled output (dist/), and
// whether required directly or resolved through a pnpm workspace symlink
// from another app's node_modules. So we can reliably locate the repo
// root relative to this file, regardless of the invoking process's cwd
// (which varies: `pnpm --filter @ai-pm/database run seed` cwd's into
// packages/database, while the API server cwd's into apps/api).
const MONOREPO_ROOT = path.resolve(__dirname, "../../..");

// Load the repo-root .env exactly once, without clobbering variables the
// invoking process already set (e.g. in CI or a launched shell).
loadEnv({ path: path.resolve(MONOREPO_ROOT, ".env") });

let instance: Database.Database | null = null;

function resolveDbPath(): string {
  const configured = process.env.DATABASE_PATH ?? "./data/ai-pm.db";
  if (configured === ":memory:") return configured;
  return path.isAbsolute(configured) ? configured : path.resolve(MONOREPO_ROOT, configured);
}

function findMigrationsDir(): string {
  // Works both when running from source (src/) and from compiled output (dist/).
  const candidates = [
    path.resolve(__dirname, "../migrations"),
    path.resolve(__dirname, "../../migrations"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate migrations directory. Tried: ${candidates.join(", ")}`);
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationsDir = findMigrationsDir();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
        file,
        new Date().toISOString(),
      );
    });
    apply();
  }
}

/**
 * Returns a shared, lazily-initialized SQLite connection. Running this
 * repeatedly is cheap and idempotent -- migrations only apply once.
 */
export function getDb(): Database.Database {
  if (instance) return instance;

  const dbPath = resolveDbPath();
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  instance = db;
  return db;
}

/** Used by tests to get an isolated in-memory database with migrations applied. */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

export function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}
