"use server";

import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  deliverAlerts,
  evaluateProductAlert,
  type PendingAlert,
} from "@/lib/alerts";
import { ForbiddenError, requireRole } from "@/lib/auth-helpers";
import { db, type Tx } from "@/lib/db/client";
// Serializes operations that check the 150-active-SKU limit (create,
// reactivate, import): a plain COUNT has a race between two admins.
import { PRODUCT_LIMIT_LOCK } from "@/lib/db/locks";
import {
  deleteProductImage,
  storageConfigured,
  uploadProductImage,
} from "@/lib/storage";
import {
  productImages,
  productSubtypes,
  products,
  stockMovements,
} from "@/lib/db/schema";
import { slugify, uniqueSlug } from "@/lib/domain/slug";
import { avisarALaWeb } from "@/lib/avisar-web";
import {
  MAX_ACTIVE_PRODUCTS,
  computeAdjustmentDelta,
  movementInputSchema,
  productCreateSchema,
  productUpdateSchema,
} from "@/lib/domain/stock";

export type ActionResult =
  { ok: true; message: string } | { ok: false; error: string };

const LIMIT_ERROR = `Límite alcanzado: la instancia admite hasta ${MAX_ACTIVE_PRODUCTS} SKU activos. Desactivá un producto para liberar lugar.`;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError)
    return { ok: false, error: error.message };
  console.error("[stock:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

/** Revalida las pantallas del ERP y, ademas, le avisa a la web publica.
 *  El aviso va aca adentro a proposito: cualquier accion nueva que revalide
 *  el catalogo lo hereda sin que nadie se acuerde de agregarlo. */
async function revalidateStock(productId?: string) {
  revalidatePath("/stock");
  revalidatePath("/stock/movimientos");
  if (productId) revalidatePath(`/stock/${productId}`);
  revalidatePath("/");
  await avisarALaWeb();
}

/** Slug unico para la URL del producto en la web. Se calcula DENTRO de la
 * transaccion del alta para que dos altas simultaneas no elijan el mismo. */
async function slugParaProducto(tx: Tx, nombre: string): Promise<string> {
  const usados = await tx.select({ slug: products.slug }).from(products);
  const base = slugify(nombre) || "producto";
  return uniqueSlug(
    base,
    new Set(usados.map((u) => u.slug).filter((x): x is string => x !== null)),
  );
}

/** Clasificacion valida = subtipo perteneciente a la categoria elegida. La base
 * lo garantiza con una foranea compuesta; esto existe solo para devolver un
 * mensaje en español en vez de un error de constraint. */
async function validarClasificacion(
  tx: Tx,
  categoryId: string | null,
  subtypeId: string | null,
): Promise<string | null> {
  if (!subtypeId) return null;
  if (!categoryId) return "Elegí la categoría antes que el subtipo.";
  const [sub] = await tx
    .select({ categoryId: productSubtypes.categoryId })
    .from(productSubtypes)
    .where(eq(productSubtypes.id, subtypeId))
    .limit(1);
  if (!sub) return "El subtipo no existe.";
  if (sub.categoryId !== categoryId)
    return "Ese subtipo no pertenece a la categoría elegida.";
  return null;
}

const clasificacionSchema = z.object({
  categoryId: z
    .string()
    .trim()
    .transform((v) => (v === "" || v === "sin" ? null : v))
    .nullable()
    .refine((v) => v === null || z.uuid().safeParse(v).success, {
      error: "Categoría inválida.",
    }),
  subtypeId: z
    .string()
    .trim()
    .transform((v) => (v === "" || v === "sin" ? null : v))
    .nullable()
    .refine((v) => v === null || z.uuid().safeParse(v).success, {
      error: "Subtipo inválido.",
    }),
});

export async function createProductAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin");
    const parsed = productCreateSchema.safeParse({
      sku: formData.get("sku"),
      name: formData.get("name"),
      minStock: formData.get("minStock"),
      initialStock: formData.get("initialStock") || 0,
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { sku, name, minStock, initialStock } = parsed.data;

    const clasif = clasificacionSchema.safeParse({
      categoryId: formData.get("categoryId") ?? "",
      subtypeId: formData.get("subtypeId") ?? "",
    });
    if (!clasif.success) return { ok: false, error: firstIssue(clasif.error) };

    let pendingAlert: PendingAlert | null = null;
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${PRODUCT_LIMIT_LOCK})`,
      );

      const [{ active }] = await tx
        .select({ active: count() })
        .from(products)
        .where(eq(products.isActive, true));
      if (active >= MAX_ACTIVE_PRODUCTS)
        return { ok: false, error: LIMIT_ERROR };

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
      const invalida = await validarClasificacion(
        tx,
        clasif.data.categoryId,
        clasif.data.subtypeId,
      );
      if (invalida) return { ok: false, error: invalida };

      const [product] = await tx
        .insert(products)
        .values({
          sku,
          name,
          minStock,
          currentStock: initialStock,
          categoryId: clasif.data.categoryId,
          subtypeId: clasif.data.subtypeId,
          slug: await slugParaProducto(tx, name),
        })
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
      await revalidateStock();
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
          return {
            ok: false,
            error: `Ya existe un producto con el SKU ${sku}.`,
          };
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
      await revalidateStock(productId);
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
        await tx.execute(
          sql`select pg_advisory_xact_lock(${PRODUCT_LIMIT_LOCK})`,
        );
        const [{ current }] = await tx
          .select({ current: count() })
          .from(products)
          .where(and(eq(products.isActive, true)));
        if (current >= MAX_ACTIVE_PRODUCTS)
          return { ok: false, error: LIMIT_ERROR };
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
      await revalidateStock(productId);
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
    const user = await requireRole(); // both roles register movements
    const noteRaw = formData.get("note");
    const parsed = movementInputSchema.safeParse({
      type: formData.get("type"),
      productId: formData.get("productId"),
      quantity: formData.get("quantity") ?? undefined,
      countedStock: formData.get("countedStock") ?? undefined,
      note:
        typeof noteRaw === "string" && noteRaw.trim() !== ""
          ? noteRaw
          : undefined,
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const input = parsed.data;

    let pendingAlert: PendingAlert | null = null;
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      if (input.type === "entrada" || input.type === "salida") {
        const delta =
          input.type === "entrada" ? input.quantity : -input.quantity;

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
            .select({
              isActive: products.isActive,
              currentStock: products.currentStock,
            })
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
        .where(
          and(eq(products.id, input.productId), eq(products.isActive, true)),
        )
        .limit(1)
        .for("update");
      if (!product) {
        const [exists] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, input.productId))
          .limit(1);
        return exists
          ? {
              ok: false,
              error: "El producto está inactivo: no admite movimientos.",
            }
          : { ok: false, error: "El producto no existe." };
      }

      const delta = computeAdjustmentDelta(
        product.currentStock,
        input.countedStock,
      );
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
      await revalidateStock(input.productId);
    }
    return result;
  } catch (error) {
    return handleError(error);
  }
}

// --- Fotos del producto -----------------------------------------------------

/**
 * La imagen llega YA redimensionada por el navegador (ver product-images.tsx).
 * Eso no es una optimizacion: Vercel corta el cuerpo del request en 4.5MB y
 * devuelve FUNCTION_PAYLOAD_TOO_LARGE antes de ejecutar nada, asi que una foto
 * de celular cruda fallaria justo en el caso normal. El limite de abajo es la
 * red de contencion por si alguien postea a mano.
 */
const MAX_BYTES_SUBIDA = 2 * 1024 * 1024;
const TIPOS_ACEPTADOS = ["image/webp", "image/jpeg", "image/png"];

export async function uploadProductImageAction(
  productId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    if (!storageConfigured()) {
      return {
        ok: false,
        error: "El almacenamiento de fotos no está configurado.",
      };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Elegí una imagen." };
    }
    if (!TIPOS_ACEPTADOS.includes(file.type)) {
      return { ok: false, error: "El formato tiene que ser WebP, JPG o PNG." };
    }
    if (file.size > MAX_BYTES_SUBIDA) {
      return { ok: false, error: "La imagen es demasiado grande." };
    }

    const [product] = await db
      .select({ id: products.id, sku: products.sku })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!product) return { ok: false, error: "El producto no existe." };

    const subida = await uploadProductImage({
      sku: product.sku,
      bytes: await file.arrayBuffer(),
      contentType: file.type,
    });
    if (!subida.ok) return { ok: false, error: subida.error };

    // La fila se inserta DESPUES de que el objeto exista: al reves, un fallo de
    // subida dejaria una fila apuntando a una foto que no esta.
    const [{ siguiente }] = await db
      .select({
        siguiente: sql<number>`coalesce(max(${productImages.sortOrder}), -1) + 1`,
      })
      .from(productImages)
      .where(eq(productImages.productId, productId));

    await db
      .insert(productImages)
      .values({ productId, path: subida.path, sortOrder: siguiente });

    revalidatePath(`/stock/${productId}`);
    revalidatePath("/stock");
    return { ok: true, message: "Foto agregada." };
  } catch (error) {
    return handleError(error);
  }
}

export async function deleteProductImageAction(
  imageId: string,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const [row] = await db
      .select({
        id: productImages.id,
        productId: productImages.productId,
        path: productImages.path,
      })
      .from(productImages)
      .where(eq(productImages.id, imageId))
      .limit(1);
    if (!row) return { ok: false, error: "La foto no existe." };

    // Primero la fila, despues el objeto. Si el borrado del archivo falla,
    // queda un huerfano en el bucket (invisible y barato); al reves quedaria
    // una foto rota en la web del cliente, que se ve.
    await db.delete(productImages).where(eq(productImages.id, imageId));
    await deleteProductImage(row.path);

    revalidatePath(`/stock/${row.productId}`);
    revalidatePath("/stock");
    return { ok: true, message: "Foto eliminada." };
  } catch (error) {
    return handleError(error);
  }
}

/** La foto principal es la de sortOrder mas bajo: es la que va a mostrar la
 * web en el listado. */
export async function setPrimaryProductImageAction(
  imageId: string,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const [row] = await db
      .select({ productId: productImages.productId })
      .from(productImages)
      .where(eq(productImages.id, imageId))
      .limit(1);
    if (!row) return { ok: false, error: "La foto no existe." };

    await db.transaction(async (tx) => {
      await tx
        .update(productImages)
        .set({ sortOrder: sql`${productImages.sortOrder} + 1` })
        .where(eq(productImages.productId, row.productId));
      await tx
        .update(productImages)
        .set({ sortOrder: 0 })
        .where(eq(productImages.id, imageId));
    });

    revalidatePath(`/stock/${row.productId}`);
    revalidatePath("/stock");
    return { ok: true, message: "Foto principal actualizada." };
  } catch (error) {
    return handleError(error);
  }
}

// --- Ficha del producto (contenido para la web) -----------------------------

const fichaSchema = z.object({
  price: z
    .string()
    .trim()
    .transform((v) => v.replace(",", "."))
    .refine((v) => v === "" || /^\d+(\.\d{1,2})?$/.test(v), {
      error: "El precio admite hasta dos decimales.",
    })
    .transform((v) => (v === "" ? null : v)),
  description: z
    .string()
    .trim()
    .max(2000, { error: "La descripción admite hasta 2000 caracteres." })
    .transform((v) => (v === "" ? null : v)),
});

/**
 * Precio, descripción y clasificación: lo que consume la web del cliente.
 * NO toca stock ni dinero. El precio es de exhibición: el módulo Dinero
 * registra movimientos de caja, no ventas por producto.
 */
export async function updateProductContentAction(
  productId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = fichaSchema.safeParse({
      price: formData.get("price") ?? "",
      description: formData.get("description") ?? "",
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const clasif = clasificacionSchema.safeParse({
      categoryId: formData.get("categoryId") ?? "",
      subtypeId: formData.get("subtypeId") ?? "",
    });
    if (!clasif.success) return { ok: false, error: firstIssue(clasif.error) };

    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      const invalida = await validarClasificacion(
        tx,
        clasif.data.categoryId,
        clasif.data.subtypeId,
      );
      if (invalida) return { ok: false, error: invalida };

      const [updated] = await tx
        .update(products)
        .set({
          price: parsed.data.price,
          description: parsed.data.description,
          categoryId: clasif.data.categoryId,
          subtypeId: clasif.data.subtypeId,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
        .returning({ id: products.id });
      if (!updated) return { ok: false, error: "El producto no existe." };
      return { ok: true, message: "Ficha actualizada." };
    });

    if (result.ok) await revalidateStock(productId);
    return result;
  } catch (error) {
    return handleError(error);
  }
}
