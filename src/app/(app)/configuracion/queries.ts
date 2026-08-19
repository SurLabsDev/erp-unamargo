import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { productCategories, productSubtypes, users } from "@/lib/db/schema";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  isActive: boolean;
};

export async function listUsers(): Promise<UserRow[]> {
  return (
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      // La cuenta de soporte de Surlabs no se muestra al cliente. El conteo
      // "N de 5 usuarios activos" se deriva de esta misma lista, asi que
      // filtrar aca la excluye tambien del tope.
      .where(eq(users.isSupport, false))
      .orderBy(asc(users.name))
  );
}

// --- Catalogo ---------------------------------------------------------------

export type SubtypeRow = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  productCount: number;
};

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  productCount: number;
  subtypes: SubtypeRow[];
};

/**
 * Categorias con sus subtipos anidados y cuantos productos usa cada uno.
 * El conteo es lo que le explica al cliente por que una categoria en uso se
 * desactiva en vez de borrarse.
 *
 * Dos consultas y el armado en memoria: son unas pocas decenas de filas y un
 * LEFT JOIN con dos conteos distintos sale peor de leer que esto.
 */
export async function listProductCatalog(): Promise<CategoryRow[]> {
  const [cats, subs] = await Promise.all([
    db
      .select({
        id: productCategories.id,
        name: productCategories.name,
        slug: productCategories.slug,
        isActive: productCategories.isActive,
        productCount: sql<number>`(select count(*)::int from products p where p.category_id = ${productCategories.id})`,
      })
      .from(productCategories)
      .orderBy(asc(productCategories.sortOrder), asc(productCategories.name)),
    db
      .select({
        id: productSubtypes.id,
        categoryId: productSubtypes.categoryId,
        name: productSubtypes.name,
        slug: productSubtypes.slug,
        isActive: productSubtypes.isActive,
        productCount: sql<number>`(select count(*)::int from products p where p.subtype_id = ${productSubtypes.id})`,
      })
      .from(productSubtypes)
      .orderBy(asc(productSubtypes.sortOrder), asc(productSubtypes.name)),
  ]);

  return cats.map((c) => ({
    ...c,
    subtypes: subs
      .filter((s) => s.categoryId === c.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        isActive: s.isActive,
        productCount: s.productCount,
      })),
  }));
}

/** Slugs ya usados, para que `uniqueSlug` no genere uno repetido. */
export async function takenCategorySlugs(): Promise<Set<string>> {
  const rows = await db
    .select({ slug: productCategories.slug })
    .from(productCategories);
  return new Set(rows.map((r) => r.slug));
}

export async function takenSubtypeSlugs(
  categoryId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ slug: productSubtypes.slug })
    .from(productSubtypes)
    .where(eq(productSubtypes.categoryId, categoryId));
  return new Set(rows.map((r) => r.slug));
}
