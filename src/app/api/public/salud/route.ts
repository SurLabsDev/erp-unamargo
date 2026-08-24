import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

/**
 * Diagnostico: la consulta mas barata posible contra la base, con el tiempo
 * partido en dos. Sirve para separar "tarda la consulta" de "tarda conseguir la
 * conexion", que desde afuera se ven igual y se arreglan distinto.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const t0 = Date.now();
  try {
    await db.execute(sql`select 1`);
    const primera = Date.now() - t0;
    const t1 = Date.now();
    await db.execute(sql`select 1`);
    const segunda = Date.now() - t1;
    return Response.json(
      { ok: true, primeraMs: primera, segundaMs: segunda },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        msMuerto: Date.now() - t0,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
