"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireRole } from "@/lib/auth-helpers";
import { db } from "@/lib/db/client";
import { BALANCE_LOCK } from "@/lib/db/locks";
import {
  cashCategories,
  cashMovements,
  products,
  settings,
  stockMovements,
} from "@/lib/db/schema";
import { listCampaignsWithTargets } from "../descuentos/queries";
import { resolveDiscount } from "@/lib/domain/discounts";
import {
  cashMovementSchema,
  validateCashDate,
  voidReasonSchema,
} from "@/lib/domain/money";
import { todayInTimeZone } from "@/lib/format";
import { ETIQUETA_PANEL } from "../panel-cache";
import { ETIQUETA_SETTINGS } from "@/lib/settings";
import { avisarALaWeb } from "@/lib/avisar-web";

export type ActionResult =
  { ok: true; message: string } | { ok: false; error: string };

/** Una linea de la boleta, ya resuelta: nombre y precio como quedaron
 *  guardados, no como estaban en el formulario. */
export type LineaBoleta = {
  nombre: string;
  sku: string;
  cantidad: number;
  precio: string;
};

/**
 * Lo que hace falta para imprimir la boleta.
 *
 * Se devuelve desde la accion y no se arma con el estado del formulario a
 * proposito: la boleta tiene que decir lo que quedo REGISTRADO. Si el precio
 * se ajusto, si una linea no entro, si el numero de movimiento es otro, el
 * papel que se lleva el cliente tiene que coincidir con el libro.
 */
export type Boleta = {
  numero: number;
  fecha: string;
  lineas: LineaBoleta[];
  total: string;
};

export type ResultadoVenta =
  | { ok: true; message: string; boleta: Boleta }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): { ok: false; error: string } {
  if (error instanceof ForbiddenError)
    return { ok: false, error: error.message };
  console.error("[dinero:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

function revalidateCash() {
  updateTag(ETIQUETA_SETTINGS);
  revalidatePath("/dinero");
  revalidatePath("/");
  // El panel lee cacheado: sin esto seguiria mostrando las cifras de antes
  // de este guardado. Va `updateTag` y no `revalidateTag` porque en Next 16
  // es el que expira YA dentro de una server action; el otro programa la
  // expiracion y el usuario veria su propio cambio recien en la visita
  // siguiente, que es justo la queja que originó todo esto.
  updateTag(ETIQUETA_PANEL);
}

export async function createCashMovementAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireRole(); // both roles create movements
    const parsed = cashMovementSchema.safeParse({
      date: formData.get("date"),
      kind: formData.get("kind"),
      categoryId: formData.get("categoryId"),
      concept: formData.get("concept"),
      amount: formData.get("amount"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const input = parsed.data;

    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      // Shared balance lock: concurrent movements don't block each other, but
      // the exclusive lock in updateBalanceSettingsAction can't move the cut
      // date between our date validation and the INSERT (§7.1 invariant).
      await tx.execute(
        sql`select pg_advisory_xact_lock_shared(${BALANCE_LOCK})`,
      );
      const [instance] = await tx.select().from(settings).limit(1);
      if (!instance)
        return { ok: false, error: "La instancia no está configurada." };

      const dateError = validateCashDate(
        input.date,
        todayInTimeZone(instance.timezone),
        instance.initialBalanceDate,
      );
      if (dateError) return { ok: false, error: dateError };

      const [category] = await tx
        .select()
        .from(cashCategories)
        .where(eq(cashCategories.id, input.categoryId))
        .limit(1);
      if (!category || !category.isActive) {
        return { ok: false, error: "La categoría no existe o está inactiva." };
      }
      if (category.kind !== input.kind) {
        return {
          ok: false,
          error: "La categoría no corresponde al tipo de movimiento.",
        };
      }

      await tx.insert(cashMovements).values({
        date: input.date,
        kind: input.kind,
        categoryId: input.categoryId,
        concept: input.concept,
        amount: input.amount,
        createdBy: user.id,
      });
      return {
        ok: true,
        message:
          input.kind === "income"
            ? "Ingreso registrado."
            : "Egreso registrado.",
      };
    });

    if (result.ok) revalidateCash();
    return result;
  } catch (error) {
    return handleError(error);
  }
}

export async function voidCashMovementAction(
  movementId: number,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin"); // soft-void is admin-only
    const parsed = voidReasonSchema.safeParse(formData.get("reason"));
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    // Movements are never edited nor deleted: correction = void + re-entry.
    const [voided] = await db
      .update(cashMovements)
      .set({ voidedAt: new Date(), voidedBy: user.id, voidReason: parsed.data })
      .where(
        and(eq(cashMovements.id, movementId), isNull(cashMovements.voidedAt)),
      )
      .returning({ id: cashMovements.id });
    if (!voided) {
      return { ok: false, error: "El movimiento no existe o ya está anulado." };
    }

    revalidateCash();
    return { ok: true, message: "Movimiento anulado." };
  } catch (error) {
    return handleError(error);
  }
}

const lineaSchema = z.object({
  productId: z.string().uuid(),
  cantidad: z.coerce.number().int().positive(),
  /** Precio unitario efectivamente cobrado o pagado. Viene del catalogo pero
   *  se puede editar: un "precio amigo" es una venta real y tiene que quedar
   *  registrada por lo que se cobro, no por lo que decia la lista. */
  precio: z.string().regex(/^\d+(\.\d{1,2})?$/, "Precio inválido."),
});

const operacionSchema = z.object({
  date: z.string(),
  categoryId: z.string().uuid(),
  lineas: z.array(lineaSchema).min(1, "No cargaste ningún producto."),
  nota: z.string().trim().max(200).optional(),
});

/**
 * Una operacion que mueve stock y plata a la vez, con varias lineas.
 *
 * Es comun que alguien se lleve un mate y una bombilla: eso es UNA venta con
 * dos lineas, no dos ventas. Y una compra al proveedor son diez articulos en la
 * misma factura.
 *
 * Todo en una transaccion: si una linea no tiene stock, no se anota ni el resto
 * de las lineas ni la plata. Media venta registrada es peor que ninguna, porque
 * la caja y el deposito quedan contando historias distintas.
 */
async function registrarOperacion(
  tipo: "venta" | "compra",
  formData: FormData,
): Promise<ResultadoVenta> {
  const user = await requireRole();
  let lineasCrudas: unknown;
  try {
    lineasCrudas = JSON.parse(String(formData.get("lineas") ?? "[]"));
  } catch {
    return { ok: false, error: "No se pudieron leer los productos." };
  }
  const parsed = operacionSchema.safeParse({
    date: formData.get("date"),
    categoryId: formData.get("categoryId"),
    lineas: lineasCrudas,
    nota: formData.get("nota") ?? undefined,
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  const campanas = tipo === "venta" ? await listCampaignsWithTargets() : [];

  const result = await db.transaction(async (tx): Promise<ResultadoVenta> => {
    await tx.execute(sql`select pg_advisory_xact_lock_shared(${BALANCE_LOCK})`);
    const [instance] = await tx.select().from(settings).limit(1);
    if (!instance)
      return { ok: false, error: "La instancia no está configurada." };

    const hoy = todayInTimeZone(instance.timezone);
    const dateError = validateCashDate(
      input.date,
      hoy,
      instance.initialBalanceDate,
    );
    if (dateError) return { ok: false, error: dateError };

    const [category] = await tx
      .select()
      .from(cashCategories)
      .where(eq(cashCategories.id, input.categoryId))
      .limit(1);
    if (!category || !category.isActive)
      return { ok: false, error: "La categoría no existe o está inactiva." };
    const esperado = tipo === "venta" ? "income" : "expense";
    if (category.kind !== esperado)
      return {
        ok: false,
        error:
          tipo === "venta"
            ? "Una venta se anota como ingreso."
            : "Una compra se anota como egreso.",
      };

    let total = 0;
    const nombres: string[] = [];
    const lineasBoleta: LineaBoleta[] = [];

    for (const linea of input.lineas) {
      const delta = tipo === "venta" ? -linea.cantidad : linea.cantidad;

      const filas = (await tx.execute(sql`
        update ${products}
        set current_stock = current_stock + ${delta}, updated_at = now()
        where id = ${linea.productId} and is_active
          and current_stock + ${delta} >= 0
        returning current_stock, name, sku
      `)) as unknown as Array<{
        current_stock: number;
        name: string;
        sku: string;
      }>;

      if (filas.length === 0) {
        const [p] = await tx
          .select({
            name: products.name,
            isActive: products.isActive,
            currentStock: products.currentStock,
          })
          .from(products)
          .where(eq(products.id, linea.productId))
          .limit(1);
        if (!p) return { ok: false, error: "Un producto ya no existe." };
        if (!p.isActive)
          return { ok: false, error: `"${p.name}" está inactivo.` };
        return {
          ok: false,
          error: `No hay stock suficiente de "${p.name}": quedan ${p.currentStock}. No se registró nada.`,
        };
      }

      // La campana se guarda aunque el precio se haya editado: el producto se
      // vendio bajo esa campana igual, y el precio anotado es el que se cobro.
      let campaignId: string | null = null;
      if (tipo === "venta") {
        const [prod] = await tx
          .select({
            id: products.id,
            price: products.price,
            categoryId: products.categoryId,
            subtypeId: products.subtypeId,
          })
          .from(products)
          .where(eq(products.id, linea.productId))
          .limit(1);
        if (prod) {
          const d = resolveDiscount(prod, campanas, hoy);
          campaignId = d?.campaignId ?? null;
        }
      }

      await tx.insert(stockMovements).values({
        productId: linea.productId,
        type: tipo === "venta" ? "out" : "in",
        delta,
        resultingStock: filas[0].current_stock,
        note: tipo === "venta" ? "Venta" : (input.nota?.trim() || "Compra"),
        unitPrice: linea.precio,
        campaignId,
        createdBy: user.id,
      });

      total += Number(linea.precio) * linea.cantidad;
      nombres.push(`${linea.cantidad} x ${filas[0].name}`);
      lineasBoleta.push({
        nombre: filas[0].name,
        sku: filas[0].sku,
        cantidad: linea.cantidad,
        precio: linea.precio,
      });
    }

    // El id del movimiento de caja ES el numero de boleta. No se inventa un
    // contador aparte: asi el papel que se lleva el cliente se puede buscar en
    // el libro de Dinero sin traducir nada.
    const [movimiento] = await tx
      .insert(cashMovements)
      .values({
        date: input.date,
        kind: tipo === "venta" ? "income" : "expense",
        categoryId: input.categoryId,
        concept:
          input.nota?.trim() ||
          `${tipo === "venta" ? "Venta" : "Compra"}: ${nombres.join(", ").slice(0, 180)}`,
        amount: total.toFixed(2),
        createdBy: user.id,
      })
      .returning({ id: cashMovements.id });

    const n = input.lineas.length;
    return {
      ok: true,
      message: `${tipo === "venta" ? "Venta" : "Compra"} registrada: ${n} ${n === 1 ? "producto" : "productos"}. Stock y caja actualizados.`,
      boleta: {
        numero: movimiento.id,
        fecha: input.date,
        lineas: lineasBoleta,
        total: total.toFixed(2),
      },
    };
  });

  if (result.ok) {
    revalidateCash();
    revalidatePath("/stock");
    revalidatePath("/stock/movimientos");
    updateTag(ETIQUETA_PANEL);
    await avisarALaWeb();
  }
  return result;
}

export async function registerSaleAction(
  formData: FormData,
): Promise<ResultadoVenta> {
  try {
    return await registrarOperacion("venta", formData);
  } catch (error) {
    return handleError(error);
  }
}

/** Compra de mercaderia: suma stock y anota lo que se pago. Sin criterio de
 *  costeo impuesto: se guarda el precio de CADA compra y el negocio saca el
 *  margen como quiera. Inventar un promedio ponderado seria decidir por ellos
 *  algo que cambia todos los numeros de rentabilidad. */
export async function registrarCompraAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const r = await registrarOperacion("compra", formData);
    // La compra no imprime boleta: se descarta la parte que no le sirve.
    return r.ok ? { ok: true, message: r.message } : r;
  } catch (error) {
    return handleError(error);
  }
}
