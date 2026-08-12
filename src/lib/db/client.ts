import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Real deployments MUST set DATABASE_URL to the POOLED connection string
// (Supabase pgbouncer :6543 / Neon `-pooler` host): the runtime is serverless
// and a direct connection string exhausts the free-tier connection limit.
// Local dev falls back to the Docker Postgres from the README.
const url =
  process.env.DATABASE_URL ??
  "postgres://surlabs:surlabs@localhost:5433/surlabs_erp";

if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production") {
  console.warn(
    "[db] DATABASE_URL is not set; falling back to the local dev URL.",
  );
}

// `prepare: false` is required for transaction-mode poolers (pgbouncer).
// Singleton via globalThis so dev HMR does not leak connections.
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

const client = globalForDb.pgClient ?? postgres(url, { prepare: false, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
