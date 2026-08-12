import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/lib/db/schema";

// Scripts run outside Next: they read DATABASE_URL (loaded from .env via
// tsx --env-file-if-exists) with the same local Docker fallback as the app.
export function createScriptDb() {
  const url =
    process.env.DATABASE_URL ??
    "postgres://surlabs:surlabs@localhost:5433/surlabs_erp";
  if (!process.env.DATABASE_URL) {
    console.warn(`[db] DATABASE_URL no definida; usando fallback local ${url}`);
  }
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export { schema };
