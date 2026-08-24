import { unstable_cache } from "next/cache";
import {
  cajaPorMes,
  egresosPorCategoria,
  productosConSalidas,
  salidasDelPeriodo,
  valorDelInventario,
} from "./queries";
import { countActiveCampaigns } from "./descuentos/queries";
import { periodTotals } from "./dinero/queries";
import { listLowStockProducts, listRecentMovements } from "./stock/queries";
import type { Period } from "@/lib/domain/money";

/**
 * El panel cacheado.
 *
 * Son diez consultas y se rehacian TODAS en cada visita, aunque nadie hubiera
 * tocado nada. Es la pantalla mas cara del ERP y la que menos cambia: el stock
 * de un negocio no se mueve entre que mirás el panel y volvés treinta segundos
 * despues.
 *
 * No se cachea por tiempo y listo. Se cachea con ETIQUETA y se invalida cuando
 * se guarda algo, que es lo que ya hacen `revalidateStock`, `revalidateCash` y
 * companiia. Asi el panel es instantaneo mientras nadie escribe, y en el
 * momento en que alguien registra un movimiento la proxima visita lo ve. Un
 * TTL a secas te obliga a elegir entre datos viejos o consultas de mas; la
 * etiqueta no obliga a elegir.
 *
 * Los 120 segundos son solo una red por si algun camino de escritura se olvida
 * de invalidar, no el mecanismo principal.
 *
 * Ojo con dos cosas si se toca esto:
 *  - Nada de lo que se cachea puede depender del usuario. Todas estas consultas
 *    son de la instancia entera; si alguna pasara a filtrar por usuario, un
 *    empleado veria los datos de otro.
 *  - La clave TIENE que incluir las fechas del periodo. Sin eso, el filtro de
 *    fechas del panel devolveria siempre el primer rango que alguien consulto.
 *  - **Lo que entra a la cache se serializa a JSON.** Un `bigint` revienta con
 *    "Do not know how to serialize a BigInt", y una `Date` vuelve convertida en
 *    texto, asi que `Intl` la rechaza con "Invalid time value" y se cae el
 *    render entero del panel. Las dos cosas pasaron. Por eso lo que guarda
 *    plata o fechas se convierte ANTES de entrar y se reconstruye al salir,
 *    en los envoltorios de abajo. Si se agrega una consulta nueva, revisar
 *    primero si devuelve `Date` o `bigint`.
 */
export const ETIQUETA_PANEL = "panel";

const OPCIONES = { revalidate: 120, tags: [ETIQUETA_PANEL] };

export const panelBajoStock = unstable_cache(
  () => listLowStockProducts(),
  ["panel", "bajo-stock"],
  OPCIONES,
);

const movimientosCacheados = unstable_cache(
  async (n: number) =>
    (await listRecentMovements(n)).map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  ["panel", "movimientos"],
  OPCIONES,
);

/** La fecha entra como texto y sale como `Date`: en el medio hay un JSON. */
export async function panelMovimientos(n: number) {
  const filas = await movimientosCacheados(n);
  return filas.map((m) => ({ ...m, createdAt: new Date(m.createdAt) }));
}

export const panelTotales = unstable_cache(
  (period: Period) => periodTotals(period),
  ["panel", "totales"],
  OPCIONES,
);

export const panelCampanas = unstable_cache(
  (hoy: string) => countActiveCampaigns(hoy),
  ["panel", "campanas"],
  OPCIONES,
);

export const panelSalidas = unstable_cache(
  (desde: string, hasta: string) => salidasDelPeriodo(desde, hasta),
  ["panel", "salidas"],
  OPCIONES,
);

export const panelProductosConSalidas = unstable_cache(
  (desde: string, hasta: string) => productosConSalidas(desde, hasta),
  ["panel", "productos-salidas"],
  OPCIONES,
);

const inventarioCacheado = unstable_cache(
  async () => (await valorDelInventario()).toString(),
  ["panel", "inventario"],
  OPCIONES,
);

/** Los centavos viajan como texto: `bigint` no sobrevive a un JSON. */
export async function panelInventario(): Promise<bigint> {
  return BigInt(await inventarioCacheado());
}

export const panelCajaPorMes = unstable_cache(
  (meses: number) => cajaPorMes(meses),
  ["panel", "caja-meses"],
  OPCIONES,
);

export const panelEgresos = unstable_cache(
  (desde: string, hasta: string) => egresosPorCategoria(desde, hasta),
  ["panel", "egresos"],
  OPCIONES,
);
