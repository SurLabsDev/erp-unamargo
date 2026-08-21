import { and, desc, eq, gte, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  cashCategories,
  cashMovements,
  productCategories,
  products,
  stockMovements,
} from "@/lib/db/schema";
import { addDaysISO, zonedMidnightUtc } from "@/lib/domain/dates";
import { toCents } from "@/lib/domain/cents";
import { valorInventarioCentavos, type Salida } from "@/lib/domain/metrics";
import { getSettings } from "@/lib/settings";

/**
 * Consultas del panel.
 *
 * Todo lo que mira el movimiento del deposito sale de `stock_movements`, que es
 * append-only: nadie lo edita ni lo borra, asi que lo que dice es lo que paso.
 *
 * Las fechas se cortan en la timezone de la instancia y no en UTC: si el
 * negocio cierra a las 21:00 de Montevideo, una salida de las 22:00 es del
 * mismo dia comercial y no del siguiente.
 */

/** Las salidas del periodo, ya con la cantidad en positivo y la fecha en la
 *  timezone de la instancia. */
export async function salidasDelPeriodo(
  desdeISO: string,
  hastaISO: string,
): Promise<Salida[]> {
  const { timezone } = await getSettings();
  const desde = zonedMidnightUtc(desdeISO, timezone);
  const finExclusivo = zonedMidnightUtc(addDaysISO(hastaISO, 1), timezone);

  const filas = await db
    .select({
      productoId: stockMovements.productId,
      // El delta de una salida es negativo en el libro; aca se da vuelta.
      cantidad: sql<number>`(-${stockMovements.delta})::int`,
      fecha: sql<string>`to_char(${stockMovements.createdAt} at time zone ${timezone}, 'YYYY-MM-DD')`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.type, "out"),
        gte(stockMovements.createdAt, desde),
        lt(stockMovements.createdAt, finExclusivo),
      ),
    );

  return filas;
}

export type FilaProducto = {
  id: string;
  sku: string;
  nombre: string;
  stock: number;
  minimo: number;
  rubro: string | null;
  salidas: number;
};

/** Productos activos con cuantas unidades salieron en el periodo. */
export async function productosConSalidas(
  desdeISO: string,
  hastaISO: string,
): Promise<FilaProducto[]> {
  const { timezone } = await getSettings();
  const desde = zonedMidnightUtc(desdeISO, timezone);
  const finExclusivo = zonedMidnightUtc(addDaysISO(hastaISO, 1), timezone);

  // La suma de salidas va como subconsulta correlacionada y NO como join con
  // group by: con el join, un producto sin movimientos desaparece del
  // resultado, y justamente los que no se mueven son la mitad de la historia.
  const salidas = sql<number>`(
    select coalesce(sum(-m.delta), 0)::int
    from ${stockMovements} m
    where m.product_id = ${products.id}
      and m.type = 'out'
      and m.created_at >= ${desde.toISOString()}::timestamptz
      and m.created_at < ${finExclusivo.toISOString()}::timestamptz
  )`;

  return db
    .select({
      id: products.id,
      sku: products.sku,
      nombre: products.name,
      stock: products.currentStock,
      minimo: products.minStock,
      rubro: productCategories.name,
      salidas,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(eq(products.isActive, true));
}

/** Cuanto suma la lista de precios del stock que hay hoy. */
export async function valorDelInventario(): Promise<bigint> {
  const filas = await db
    .select({ stock: products.currentStock, precio: products.price })
    .from(products)
    .where(eq(products.isActive, true));

  return valorInventarioCentavos(
    filas.map((f) => ({
      stock: f.stock,
      precioCentavos: f.precio ? toCents(f.precio) : null,
    })),
  );
}

export type MesDeCaja = { mes: string; ingresos: string; egresos: string };

/** Ingresos y egresos por mes, los ultimos N meses. Los anulados no cuentan:
 *  un movimiento anulado es uno que no ocurrio. */
export async function cajaPorMes(meses: number): Promise<MesDeCaja[]> {
  const filas = await db
    .select({
      mes: sql<string>`to_char(date_trunc('month', ${cashMovements.date}), 'YYYY-MM')`,
      ingresos: sql<string>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.kind} = 'income'), 0)::text`,
      egresos: sql<string>`coalesce(sum(${cashMovements.amount}) filter (where ${cashMovements.kind} = 'expense'), 0)::text`,
    })
    .from(cashMovements)
    .where(isNull(cashMovements.voidedAt))
    .groupBy(sql`date_trunc('month', ${cashMovements.date})`)
    .orderBy(desc(sql`date_trunc('month', ${cashMovements.date})`))
    .limit(meses);

  return filas.reverse(); // del mas viejo al mas nuevo, como se lee un grafico
}

export type FilaCategoria = { etiqueta: string; valor: number };

/** Egresos por categoria en el periodo, para saber en que se va la plata. */
export async function egresosPorCategoria(
  desdeISO: string,
  hastaISO: string,
): Promise<FilaCategoria[]> {
  const filas = await db
    .select({
      etiqueta: cashCategories.name,
      valor: sql<number>`(sum(${cashMovements.amount}) * 100)::bigint::int`,
    })
    .from(cashMovements)
    .innerJoin(cashCategories, eq(cashMovements.categoryId, cashCategories.id))
    .where(
      and(
        eq(cashMovements.kind, "expense"),
        isNull(cashMovements.voidedAt),
        gte(cashMovements.date, desdeISO),
        lte(cashMovements.date, hastaISO),
      ),
    )
    .groupBy(cashCategories.name);

  return filas;
}

/** El dia con mas salidas del periodo, para el titular del grafico. */
export function rangoDePeriodo(hoy: string, dias: number) {
  return { desde: addDaysISO(hoy, -(dias - 1)), hasta: hoy };
}
