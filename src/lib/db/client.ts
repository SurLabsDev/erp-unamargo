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
// `max: 1` NO es una restriccion arbitraria: es lo que corresponde en
// serverless. Cada invocacion atiende un pedido, asi que las conexiones de mas
// no aceleran nada y en cambio multiplican por cinco lo que cada instancia le
// saca al pooler. Cuando el pool del pooler se llena, las consultas hacen cola
// hasta morir por `statement_timeout`, y desde afuera se ve como que "la app se
// cuelga sola": cualquier pantalla, al azar, y peor cuanto mas se usa.
//
// Las pantallas que disparan varias consultas en paralelo (el panel manda diez)
// ahora las hacen de a una sobre la misma conexion. A ~100ms cada una eso suma
// alrededor de un segundo, que es plata bien gastada para que la pantalla
// cargue SIEMPRE en vez de casi siempre.
//
// Historia, para no repetirla: un intento anterior puso `max: 3` junto con
// `idle_timeout`, `max_lifetime` y `connect_timeout` todos a la vez, y quedo
// PEOR. Se revirtio en bloque. El culpable era casi seguro cerrar conexiones
// por tiempo contra un pooler en modo transaccion, no el `max`. Si hay que
// tocar esto, un parametro por vez y midiendo.
// Singleton via globalThis so dev HMR does not leak connections.
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

const client = globalForDb.pgClient ?? postgres(url, { prepare: false, max: 1 });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
