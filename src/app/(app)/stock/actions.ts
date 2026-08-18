"use server";

import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deliverAlerts, evaluateProductAlert, type PendingAlert } from "@/lib/alerts";
import {
  ForbiddenError,
  requireLedgerAuthor,
  requireRole,
} from "@/lib/auth-helpers";
import { db } from "@/lib/db/client";
// Serializes operations that check the 150-active-SKU limit (create,
// reactivate, import): a plain COUNT has a race between two admins.
import { PRODUCT_LIMIT_LOCK } from "@/lib/db/locks";
import { products, stockMovements } from "@/lib/db/schema";
import {
  MAX_ACTIVE_PRODUCTS,
  computeAdjustmentDelta,
  movementInputSchema,
  productCreateSchema,
  productUpdateSchema,
} from "@/lib/domain/stock";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const LIMIT_ERROR = `Límite alcanzado: la instancia admite hasta ${MAX_ACTIVE_PRODUCTS} SKU activos. Desactivá un producto para liberar lugar.`;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError) return { ok: false, error: error.message };
  console.error("[stock:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

function revalidateStock(productId?: string) {
  revalidatePath("/stock");
  revalidatePath("/stock/movimientos");
  if (productId) revalidatePath(`/stock/${productId}`);
  revalidatePath("/");
}

export async function createProductAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireLedgerAuthor("admin");
    const parsed = productCreateSchema.safeParse({
      sku: formData.get("sku"),
      name: formData.get("name"),
      minStock: formData.get("minStock"),
      initialStock: formData.get("initialStock") || 0,
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { sku, name, minStock, initialStock } = parsed.data;

    let pendingAlert: PendingAlert | null = null;
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      await tx.execute(sql`select pg_advisory_xact_lock(${PRODUCT_LIMIT_LOCK})`);

      const [{ active }] = await tx
        .select({ active: count() })
        .from(products)
        .where(eq(products.isActive, true));
      if (active >= MAX_ACTIVE_PRODUCTS) return { ok: false, error: LIMIT_ERROR };

      const [existing] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.sku, sku))
        .limit(1);
      if (existing) {
        return {
          ok: false,
          error: `Ya existe un producto con el SKU ${sku} (puede estar inactivo).`,
        };
      }

      // Initial stock enters the ledger as an 'initial' movement so the
      // invariant current_stock == Σ(delta) holds from day one.
      const [product] = await tx
        .insert(products)
        .values({ sku, name, minStock, currentStock: initialStock })
        .returning({ id: products.id });
      if (initialStock > 0) {
        await tx.insert(stockMovements).values({
          productId: product.id,
          type: "initial",
          delta: initialStock,
          resultingStock: initialStock,
          note: "Stock inicial",
          createdBy: user.id,
        });
      }
      // A product can be born in breach (initialStock <= minStock): §8.1
      // requires evaluation here too, like the CSV import does.
      pendingAlert = await evaluateProductAlert(tx, product.id);
      return { ok: true, message: `Producto ${sku} creado.` };
    });

    if (result.ok) {
      await deliverAlerts(pendingAlert ? [pendingAlert] : []);
      revalidateStock();
    }
    return result;
  } catch (error) {
    return handleError(error);
  }
}

export async function updateProductAction(
  productId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const skuRaw = formData.get("sku");
    const parsed = productUpdateSchema.safeParse({
      sku: typeof skuRaw === "string" && skuRaw !== "" ? skuRaw : undefined,
      name: formData.get("name"),
      minStock: formData.get("minStock"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { sku, name, minStock } = parsed.data;

    let pendingAlert: PendingAlert | null = null;
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      const [product] = await tx
        .select()
        .from(products)
        .where(eq(products.id, productId))
        .limit(1)
        .for("update");
      if (!product) return { ok: false, error: "El producto no existe." };

      let nextSku = product.sku;
      if (sku && sku !== product.sku) {
        const [{ moved }] = await tx
          .select({ moved: count() })
          .from(stockMovements)
          .where(eq(stockMovements.productId, productId));
        if (moved > 0) {
          return {
            ok: false,
            error:
              "El SKU no se puede modificar porque el producto ya tiene movimientos.",
          };
        }
        const [duplicate] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.sku, sku))
          .limit(1);
        if (duplicate) {
          return { ok: false, error: `Ya existe un producto con el SKU ${sku}.` };
        }
        nextSku = sku;
      }

      await tx
        .update(products)
        .set({ sku: nextSku, name, minStock, updatedAt: new Date() })
        .where(eq(products.id, productId));
      // A min_stock change can trigger or rearm the alert (§8).
      pendingAlert = await evaluateProductAlert(tx, productId);
      return { ok: true, message: "Producto actualizado." };
    });

    if (result.ok) {
      await deliverAlerts(pendingAlert ? [pendingAlert] : []);
      revalidateStock(productId);
    }
    return result;
  } catch (error) {
    return handleError(error);
  }
}

export async function setProductActiveAction(
  productId: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await requireRole("admin");

    let pendingAlert: PendingAlert | null = null;
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      if (active) {
        await tx.execute(sql`select pg_advisory_xact_lock(${PRODUCT_LIMIT_LOCK})`);
        const [{ current }] = await tx
          .select({ current: count() })
          .from(products)
          .where(and(eq(products.isActive, true)));
        if (current >= MAX_ACTIVE_PRODUCTS) return { ok: false, error: LIMIT_ERROR };
      }

      const [product] = await tx
        .update(products)
        .set({ isActive: active, updatedAt: new Date() })
        .where(eq(products.id, productId))
        .returning({ sku: products.sku });
      if (!product) return { ok: false, error: "El producto no existe." };

      // Reactivation re-evaluates the alert (§8); a product already triggered
      // before deactivation keeps its state and does not email again.
      if (active) {
        pendingAlert = await evaluateProductAlert(tx, productId);
      }
      return {
        ok: true,
        message: active
          ? `Producto ${product.sku} reactivado.`
          : `Producto ${product.sku} desactivado. Su historial se conserva.`,
      };
    });

    if (result.ok) {
      await deliverAlerts(pendingAlert ? [pendingAlert] : []);
      revalidateStock(productId);
    }
    return result;
  } catch (error) {
    return handleError(error);
  }
}

export async function registerMovementAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireLedgerAuthor(); // both roles register movements
    const noteRaw = formData.get("note");
    const parsed = movementInputSchema.safeParse({
      type: formData.get("type"),
      productId: formData.get("productId"),
      quantity: formData.get("quantity") ?? undefined,
      countedStock: formData.get("countedStock") ?? undefined,
      note: typeof noteRaw === "string" && noteRaw.trim() !== "" ? noteRaw : undefined,
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const input = parsed.data;

    let pendingAlert: PendingAlert | null = null;
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      if (input.type === "entrada" || input.type === "salida") {
        const delta = input.type === "entrada" ? input.quantity : -input.quantity;

        // Atomic guarded update: never read-then-write without a lock. The
        // WHERE guard makes concurrent salidas unable to drive stock < 0
        // (AC-STK-4); the DB CHECK is the last line of defense.
        const rows = (await tx.execute(sql`
          update ${products}
          set current_stock = current_stock + ${delta}, updated_at = now()
          where id = ${input.productId} and is_active and current_stock + ${delta} >= 0
          returning current_stock
        `)) as unknown as Array<{ current_stock: number }>;

        if (rows.length === 0) {
          const [product] = await tx
            .select({ isActive: products.isActive, currentStock: products.currentStock })
            .from(products)
            .where(eq(products.id, input.productId))
            .limit(1);
          if (!product) return { ok: false, error: "El producto no existe." };
          if (!product.isActive) {
            return {
              ok: false,
              error: "El producto está inactivo: no admite movimientos.",
            };
          }
          return {
            ok: false,
            error: `Stock insuficiente: quedan ${product.currentStock} unidades disponibles.`,
          };
        }

        const resultingStock = rows[0].current_stock;
        await tx.insert(stockMovements).values({
          productId: input.productId,
          type: input.type === "entrada" ? "in" : "out",
          delta,
          resultingStock,
          note: input.note ?? null,
          createdBy: user.id,
        });
        pendingAlert = await evaluateProductAlert(tx, input.productId);
        return { ok: true, message: "Movimiento registrado." };
      }

      // Ajuste: read under FOR UPDATE row lock (no unlocked read-then-write),
      // derive the delta from the counted stock, write cache + ledger.
      const [product] = await tx
        .select({ currentStock: products.currentStock })
        .from(products)
        .where(and(eq(products.id, input.productId), eq(products.isActive, true)))
        .limit(1)
        .for("update");
      if (!product) {
        const [exists] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, input.productId))
          .limit(1);
        return exists
          ? { ok: false, error: "El producto está inactivo: no admite movimientos." }
          : { ok: false, error: "El producto no existe." };
      }

      const delta = computeAdjustmentDelta(product.currentStock, input.countedStock);
      if (delta === 0) {
        return {
          ok: true,
          message: "Sin cambios: el stock contado coincide con el registrado.",
        };
      }

      await tx
        .update(products)
        .set({ currentStock: input.countedStock, updatedAt: new Date() })
        .where(eq(products.id, input.productId));
      await tx.insert(stockMovements).values({
        productId: input.productId,
        type: "adjustment",
        delta,
        resultingStock: input.countedStock,
        note: input.note,
        createdBy: user.id,
      });
      pendingAlert = await evaluateProductAlert(tx, input.productId);
      return { ok: true, message: "Ajuste registrado." };
    });

    if (result.ok) {
      await deliverAlerts(pendingAlert ? [pendingAlert] : []);
      revalidateStock(input.productId);
    }
    return result;
  } catch (error) {
    return handleError(error);
  }
}
