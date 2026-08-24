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
//
// HIPOTESIS PROBADA Y DESCARTADA (2026-08-24): se probo `max: 3` con
// `idle_timeout: 20`, `max_lifetime` y `connect_timeout: 10` creyendo que el
// ERP se quedaba sin conexiones. NO era eso -la base tenia 8 de 60 conexiones
// en uso y cero locks trabados- y ademas la version con esos parametros dejo el
// ambiente de prueba PEOR: la API paso de 0.44s a errores 500 y cuelgues. La
// sospecha es que cerrar conexiones por tiempo contra un pooler en modo
// transaccion deja sesiones trabadas del lado del servidor. No volver a
// intentarlo sin medir antes y despues.
//
// El sintoma real a investigar es otro: aparecen sesiones en estado `active` +
// `ClientRead` que duran minutos, o sea Postgres esperando datos de un cliente
// serverless que ya murio. Se ven con:
//   select pid, state, wait_event, now()-xact_start, query from pg_stat_activity;
// Singleton via globalThis so dev HMR does not leak connections.
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

const client = globalForDb.pgClient ?? postgres(url, { prepare: false, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
