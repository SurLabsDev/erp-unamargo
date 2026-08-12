import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit does not load .env by itself: pick DATABASE_URL from .env when
// the environment does not provide it (local dev convenience, no extra dep).
function envDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync(".env")) {
    const match = readFileSync(".env", "utf8").match(
      /^DATABASE_URL=["']?([^"'\r\n]+)["']?\s*$/m,
    );
    if (match) return match[1];
  }
  return undefined;
}

// Local dev fallback (Docker Postgres on 5433 — see README). Real deployments
// MUST set DATABASE_URL (pooled connection string).
const url =
  envDatabaseUrl() ?? "postgres://surlabs:surlabs@localhost:5433/surlabs_erp";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
