import { and, asc, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { SUPPORT_DISPLAY_NAME } from "@/lib/format";
import {
  productCategories,
  productImages,
  productSubtypes,
  products,
  stockMovements,
  users,
  type Product,
} from "@/lib/db/schema";
import { zonedDateRangeToUtc } from "@/lib/domain/dates";

export const MOVEMENTS_PAGE_SIZE = 50;

export type CatalogRow = Product & { hasMovements: boolean };

/** Full catalog (≤150 active rows by contract): filtering happens client-side. */
export async function listCatalog(): Promise<CatalogRow[]> {
  return db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      isActive: products.isActive,
      currentStock: products.currentStock,
      minStock: products.minStock,
      categoryId: products.categoryId,
      subtypeId: products.subtypeId,
      price: products.price,
      description: products.description,
      slug: products.slug,
      lowStockAlertedAt: products.lowStockAlertedAt,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      // Identifiers spelled out: interpolating drizzle columns inside a
      // subquery renders them unqualified ("id" resolves to the wrong table).
      hasMovements: sql<boolean>`exists (select 1 from stock_movements sm where sm.product_id = products.id)`,
    })
    .from(products)
    .orderBy(desc(products.isActive), asc(products.sku));
}

export async function getCatalogProduct(
  id: string,
): Promise<CatalogRow | undefined> {
  const [row] = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      isActive: products.isActive,
      currentStock: products.currentStock,
      minStock: products.minStock,
      categoryId: products.categoryId,
      subtypeId: products.subtypeId,
      price: products.price,
      description: products.description,
      slug: products.slug,
      lowStockAlertedAt: products.lowStockAlertedAt,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      // Identifiers spelled out: interpolating drizzle columns inside a
      // subquery renders them unqualified ("id" resolves to the wrong table).
      hasMovements: sql<boolean>`exists (select 1 from stock_movements sm where sm.product_id = products.id)`,
    })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  return row;
}

export type MovementRow = {
  id: number;
  type: "in" | "out" | "adjustment" | "initial";
  delta: number;
  resultingStock: number;
  note: string | null;
  createdAt: Date;
  productId: string;
  productSku: string;
  productName: string;
  userName: string;
};

export type MovementFilters = {
  productId?: string;
  type?: "in" | "out" | "adjustment" | "initial";
  userId?: string;
  /** Calendar dates as picked by the user, interpreted in the instance tz. */
  fromISO?: string;
  toISO?: string;
  page: number;
};

export async function listMovements(
  filters: MovementFilters,
  timezone: string,
): Promise<{ rows: MovementRow[]; total: number; pageCount: number }> {
  const { from, to } = zonedDateRangeToUtc(
    filters.fromISO,
    filters.toISO,
    timezone,
  );
  const conditions = [
    filters.productId
      ? eq(stockMovements.productId, filters.productId)
      : undefined,
    filters.type ? eq(stockMovements.type, filters.type) : undefined,
    filters.userId ? eq(stockMovements.createdBy, filters.userId) : undefined,
    from ? gte(stockMovements.createdAt, from) : undefined,
    to ? lt(stockMovements.createdAt, to) : undefined,
  ].filter((c) => c !== undefined);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Defense in depth: pages sanitize the param, but a non-integer here would
  // produce a fractional SQL OFFSET.
  const page = Math.max(1, Math.floor(filters.page) || 1);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: stockMovements.id,
        type: stockMovements.type,
        delta: stockMovements.delta,
        resultingStock: stockMovements.resultingStock,
        note: stockMovements.note,
        createdAt: stockMovements.createdAt,
        productId: stockMovements.productId,
        productSku: products.sku,
        productName: products.name,
        userName: sql<string>`case when ${users.isSupport} then ${SUPPORT_DISPLAY_NAME} else ${users.name} end`,
      })
      .from(stockMovements)
      .innerJoin(products, eq(stockMovements.productId, products.id))
      .innerJoin(users, eq(stockMovements.createdBy, users.id))
      .where(where)
      .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
      .limit(MOVEMENTS_PAGE_SIZE)
      .offset((page - 1) * MOVEMENTS_PAGE_SIZE),
    db.select({ total: count() }).from(stockMovements).where(where),
  ]);

  return {
    rows,
    total,
    pageCount: Math.max(1, Math.ceil(total / MOVEMENTS_PAGE_SIZE)),
  };
}

export async function listMovementFilterOptions() {
  const [productOptions, userOptions] = await Promise.all([
    db
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .orderBy(asc(products.sku)),
    // La cuenta de soporte no se ofrece como filtro: seria anunciarle al
    // cliente que existe. Si llegara a firmar un movimiento, su nombre aparece
    // en esa fila igual (decision explicita de Surlabs), pero no hace falta
    // listarla ademas en el desplegable.
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.isSupport, false))
      .orderBy(asc(users.name)),
  ]);
  return { productOptions, userOptions };
}

/** Active products at or below their minimum (min_stock = 0 excluded). */
export async function listLowStockProducts(): Promise<Product[]> {
  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.isActive, true),
        sql`${products.minStock} > 0`,
        sql`${products.currentStock} <= ${products.minStock}`,
      ),
    )
    .orderBy(asc(products.sku));
}

export async function listRecentMovements(
  limit: number,
): Promise<MovementRow[]> {
  return db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      delta: stockMovements.delta,
      resultingStock: stockMovements.resultingStock,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      productId: stockMovements.productId,
      productSku: products.sku,
      productName: products.name,
      userName: sql<string>`case when ${users.isSupport} then ${SUPPORT_DISPLAY_NAME} else ${users.name} end`,
    })
    .from(stockMovements)
    .innerJoin(products, eq(stockMovements.productId, products.id))
    .innerJoin(users, eq(stockMovements.createdBy, users.id))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(limit);
}

/** Fotos de un producto, la principal primero. */
export async function listProductImages(productId: string) {
  return db
    .select({
      id: productImages.id,
      path: productImages.path,
      sortOrder: productImages.sortOrder,
    })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.sortOrder), asc(productImages.id));
}

export type OpcionClasificacion = {
  id: string;
  name: string;
  subtypes: { id: string; name: string }[];
};

/** Categorias ACTIVAS con sus subtipos activos, para los selectores del alta y
 * de la ficha. Las desactivadas no se ofrecen para clasificaciones nuevas, pero
 * los productos que ya las tienen las conservan. */
export async function listClassificationOptions(): Promise<
  OpcionClasificacion[]
> {
  const [cats, subs] = await Promise.all([
    db
      .select({ id: productCategories.id, name: productCategories.name })
      .from(productCategories)
      .where(eq(productCategories.isActive, true))
      .orderBy(asc(productCategories.sortOrder), asc(productCategories.name)),
    db
      .select({
        id: productSubtypes.id,
        categoryId: productSubtypes.categoryId,
        name: productSubtypes.name,
      })
      .from(productSubtypes)
      .where(eq(productSubtypes.isActive, true))
      .orderBy(asc(productSubtypes.sortOrder), asc(productSubtypes.name)),
  ]);
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    subtypes: subs
      .filter((s) => s.categoryId === c.id)
      .map((s) => ({ id: s.id, name: s.name })),
  }));
}
