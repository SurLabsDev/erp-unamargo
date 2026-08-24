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
// El resto de los numeros son la diferencia entre un ERP que anda y uno que se
// cuelga solo. La base admite 60 conexiones. Con `max: 5` y SIN `idle_timeout`,
// cada instancia serverless abria cinco y no las soltaba nunca: a las doce
// instancias tibias la base se quedaba sin cupo y CUALQUIER pantalla se
// colgaba esperando una conexion que no llegaba. No fallaba: esperaba. Por eso
// se veia intermitente y sin errores en los logs.
//
//  - `idle_timeout` es el arreglo de fondo: suelta la conexion que no se usa,
//    asi una instancia dormida deja de ocupar cupo.
//  - `max: 3` porque una invocacion atiende un pedido. La pantalla que mas pide
//    son diez consultas en paralelo y con tres corren en cuatro tandas, que a
//    ~100ms cada una no se nota, pero baja casi a la mitad el cupo por instancia.
//  - `max_lifetime` recicla conexiones viejas que el pooler pudo haber perdido.
//  - `connect_timeout` es para que falle FUERTE en vez de esperar para siempre:
//    un error que se ve se arregla, una espera infinita parece un cuelgue.
// Singleton via globalThis so dev HMR does not leak connections.
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

const client = globalForDb.pgClient ?? postgres(url, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
  });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
