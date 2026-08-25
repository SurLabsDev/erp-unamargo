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
// DOS HIPOTESIS PROBADAS Y DESCARTADAS, con numeros, para no repetirlas:
//
//  1. `max: 3` + `idle_timeout` + `max_lifetime` + `connect_timeout` juntos:
//     quedo PEOR (la API publica paso de 0.44s a errores 500).
//  2. `max: 1`, que es lo que "corresponde" en serverless segun el manual:
//     quedo MUCHO peor. De 32 cargas de pantalla fallaron casi todas, contra
//     12 con `max: 5`. La razon es concreta: el panel dispara diez consultas en
//     paralelo y con una sola conexion se hacen en fila, asi que la pantalla mas
//     cargada se pasa del `statement_timeout` y muere entera.
//
// O sea que el problema NO es la cantidad de conexiones por instancia. Queda
// documentado el sintoma real por si alguien retoma: sesiones en `active` +
// `ClientRead` que sobreviven minutos, o sea Postgres esperando a una funcion
// serverless ya congelada. Se ven asi:
//   select pid, state, wait_event, now()-xact_start, query from pg_stat_activity;
// Singleton via globalThis so dev HMR does not leak connections.
const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

const client = globalForDb.pgClient ?? postgres(url, {
    prepare: false,
    max: 5,
    // Cada conexion se jubila al minuto. Es LO UNICO que corta las sesiones
    // trabadas, y vale la pena entender por que:
    //
    // Cuando Vercel congela una funcion con una consulta en vuelo, la sesion
    // del otro lado queda en `active` + `ClientRead`, o sea Postgres esperando
    // datos de un cliente que ya no existe. Esa sesion ocupa lugar en el pool y
    // NINGUN timeout de la base la mata:
    //   - `statement_timeout` cuenta solo el tiempo EJECUTANDO, y ahi no
    //     ejecuta, espera.
    //   - `idle_in_transaction_session_timeout` aplica a `idle in transaction`,
    //     no a `active`.
    //   - los keepalives TCP no disparan porque, para Postgres, el cliente es
    //     el pooler de Supabase, que esta vivo; el que murio esta del otro lado.
    //
    // Se probo cada una de esas tres y ninguna sirvio. Jubilar la conexion por
    // tiempo la cierra desde nuestro lado, que es el unico lado que puede.
    max_lifetime: 60,
  });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
