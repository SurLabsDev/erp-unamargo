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
import { avisarALaWeb } from "@/lib/avisar-web";

export type ActionResult =
  { ok: true; message: string } | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError)
    return { ok: false, error: error.message };
  console.error("[dinero:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

function revalidateCash() {
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

const ventaSchema = z.object({
  date: z.string(),
  productId: z.string().uuid(),
  categoryId: z.string().uuid(),
  quantity: z.coerce.number().int().positive("La cantidad tiene que ser mayor a cero."),
});

/**
 * Una venta: descuenta el stock Y anota la plata, o no hace ninguna de las dos.
 *
 * Antes eran dos anotaciones sueltas en dos pantallas, asi que registrar una
 * venta en Dinero dejaba el deposito diciendo que la mercaderia seguia ahi.
 * Van juntas en UNA transaccion: si el stock no alcanza, tampoco se anota la
 * plata, porque un ingreso sin la salida que lo genero es un descuadre que
 * despues nadie sabe de donde salio.
 *
 * El precio se congela ACA, con el descuento vigente al momento de vender. Es
 * lo unico que permite contestar despues "cuanto vendi con esta campana": el
 * precio de hoy no dice a cuanto salio algo la semana pasada.
 */
export async function registerSaleAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireRole();
    const parsed = ventaSchema.safeParse({
      date: formData.get("date"),
      productId: formData.get("productId"),
      categoryId: formData.get("categoryId"),
      quantity: formData.get("quantity"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const input = parsed.data;

    const campanas = await listCampaignsWithTargets();

    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock_shared(${BALANCE_LOCK})`,
      );
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
      if (category.kind !== "income")
        return { ok: false, error: "Una venta se anota como ingreso." };

      const [producto] = await tx
        .select()
        .from(products)
        .where(eq(products.id, input.productId))
        .limit(1);
      if (!producto) return { ok: false, error: "El producto no existe." };
      if (producto.price === null)
        return {
          ok: false,
          error: "El producto no tiene precio: no se puede vender.",
        };

      const descuento = resolveDiscount(
        {
          id: producto.id,
          price: producto.price,
          categoryId: producto.categoryId,
          subtypeId: producto.subtypeId,
        },
        campanas,
        hoy,
      );
      const precioUnitario = descuento ? descuento.priceFinal : producto.price;
      const total = (Number(precioUnitario) * input.quantity).toFixed(2);

      // Mismo update guardado que el resto del stock: nunca leer y despues
      // escribir sin candado, o dos ventas simultaneas dejan el stock negativo.
      const filas = (await tx.execute(sql`
        update ${products}
        set current_stock = current_stock - ${input.quantity}, updated_at = now()
        where id = ${input.productId} and is_active
          and current_stock - ${input.quantity} >= 0
        returning current_stock
      `)) as unknown as Array<{ current_stock: number }>;

      if (filas.length === 0) {
        return {
          ok: false,
          error: producto.isActive
            ? `No hay stock suficiente: quedan ${producto.currentStock}.`
            : "El producto está inactivo.",
        };
      }

      await tx.insert(stockMovements).values({
        productId: input.productId,
        type: "out",
        delta: -input.quantity,
        resultingStock: filas[0].current_stock,
        note: `Venta${descuento ? ` (${descuento.campaignName})` : ""}`,
        unitPrice: precioUnitario,
        campaignId: descuento?.campaignId ?? null,
        createdBy: user.id,
      });

      await tx.insert(cashMovements).values({
        date: input.date,
        kind: "income",
        categoryId: input.categoryId,
        concept: `Venta: ${input.quantity} x ${producto.name}`,
        amount: total,
        createdBy: user.id,
      });

      return {
        ok: true,
        message: `Venta registrada: ${input.quantity} x ${producto.name}. Stock y caja actualizados.`,
      };
    });

    if (result.ok) {
      // Una venta toca los dos libros, asi que hay que refrescar las dos
      // pantallas. No se importa el helper de stock: ese archivo es
      // "use server" y exportar de ahi algo que no es una accion rompe el
      // contrato de Next.
      revalidateCash();
      revalidatePath("/stock");
      revalidatePath(`/stock/${input.productId}`);
      revalidatePath("/stock/movimientos");
      updateTag(ETIQUETA_PANEL);
      await avisarALaWeb();
    }
    return result;
  } catch (error) {
    return handleError(error);
  }
}
