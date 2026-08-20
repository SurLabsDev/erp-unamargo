/**
 * One-off catalog import for Unamargo (2026-08-20).
 *
 *   npx tsx scripts/import-catalogo.ts
 *
 * Part 1 (taxonomy). Tasks 4-6 (see
 * .superpowers/sdd/2026-08-20-import-catalogo) extend this same file with a
 * CLI, the product import and the photo upload.
 *
 * This step reconciles the product taxonomy seeded on 2026-08-19 -- inferred
 * from demo fixtures -- against the real range the client's own HTML demo
 * revealed. Categories and subtypes are NEVER deleted here, only deactivated
 * (the rule everywhere in this ERP): history and any future reactivation
 * both depend on the row surviving.
 */
import { eq } from "drizzle-orm";
import { slugify, uniqueSlug } from "@/lib/domain/slug";
import { createScriptDb, schema } from "./lib/db";

const { productCategories, productSubtypes } = schema;

type Db = ReturnType<typeof createScriptDb>["db"];

// --- Desired taxonomy state --------------------------------------------------

const TAXONOMY: Array<{ category: string; subtypes: string[] }> = [
  {
    category: "Mates",
    subtypes: ["Ranchero", "Camionero", "Torpedo", "Imperial", "Porongo"],
  },
  { category: "Bombillas", subtypes: [] },
  {
    category: "Combos",
    subtypes: ["Con porongo", "Con camionero", "Con galleta"],
  },
  {
    category: "Accesorios",
    subtypes: ["Materas", "Yerberos", "Posamates", "Limpieza"],
  },
];

/** Categories seeded on 2026-08-19 from an inference that the client's own
 * demo contradicts: they sell no termos and no yerba, and they group materas
 * inside Accesorios. Deactivated, never deleted, so reactivating is trivial. */
const DEACTIVATE = ["Termo", "Yerba", "Matera"];

/**
 * Controller ruling (not in the original brief): the 2026-08-19 seed used
 * SINGULAR names (Mate, Bombilla); TAXONOMY above is PLURAL. A sync that
 * matched by exact name would create "Mates" next to the existing "Mate" and
 * leave a duplicate. So these renames run FIRST, on the same row (same id),
 * before anything else touches the taxonomy.
 *
 * Renaming a category must normally NOT change its slug -- slugs are
 * published URLs (see src/lib/domain/slug.ts) and this is enforced elsewhere
 * in this codebase on purpose. That rule is waived here ONLY because there
 * are zero products and the client's site does not exist yet, so nothing
 * links to /mate or /bombilla today. This is a one-time exception for this
 * import, not a pattern to reuse elsewhere.
 */
const RENAMES: Array<{ from: string; to: string; toSlug: string }> = [
  { from: "Mate", to: "Mates", toSlug: "mates" },
  { from: "Bombilla", to: "Bombillas", toSlug: "bombillas" },
];

// --- Sync ---------------------------------------------------------------

async function applyRenames(db: Db): Promise<void> {
  for (const rename of RENAMES) {
    const [existing] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.name, rename.from))
      .limit(1);
    if (!existing) continue; // already renamed (or never existed): idempotent

    await db
      .update(productCategories)
      .set({ name: rename.to, slug: rename.toSlug })
      .where(eq(productCategories.id, existing.id));
    console.log(
      `[import-catalogo] Categoría "${rename.from}" renombrada a "${rename.to}" (slug -> "${rename.toSlug}").`,
    );
  }
}

async function syncSubtypes(
  db: Db,
  categoryId: string,
  categoryName: string,
  desiredNames: string[],
): Promise<void> {
  const existing = await db
    .select({
      id: productSubtypes.id,
      name: productSubtypes.name,
      slug: productSubtypes.slug,
      sortOrder: productSubtypes.sortOrder,
      isActive: productSubtypes.isActive,
    })
    .from(productSubtypes)
    .where(eq(productSubtypes.categoryId, categoryId));

  const existingByName = new Map(existing.map((s) => [s.name, s]));
  const desiredSet = new Set(desiredNames);
  const takenSlugs = new Set(existing.map((s) => s.slug));
  let nextOrder =
    existing.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;

  for (const name of desiredNames) {
    const current = existingByName.get(name);
    if (!current) {
      const slug = uniqueSlug(slugify(name), takenSlugs);
      takenSlugs.add(slug);
      await db.insert(productSubtypes).values({
        categoryId,
        name,
        slug,
        sortOrder: nextOrder++,
      });
      console.log(
        `[import-catalogo] Subtipo "${name}" creado bajo "${categoryName}".`,
      );
      continue;
    }
    if (!current.isActive) {
      await db
        .update(productSubtypes)
        .set({ isActive: true })
        .where(eq(productSubtypes.id, current.id));
      console.log(
        `[import-catalogo] Subtipo "${name}" reactivado bajo "${categoryName}".`,
      );
    }
  }

  // Old subtypes of this category that the desired list no longer names get
  // deactivated, never deleted -- same rule as categories.
  for (const current of existing) {
    if (desiredSet.has(current.name)) continue;
    if (!current.isActive) continue; // already inactive: idempotent no-op
    await db
      .update(productSubtypes)
      .set({ isActive: false })
      .where(eq(productSubtypes.id, current.id));
    console.log(
      `[import-catalogo] Subtipo "${current.name}" desactivado bajo "${categoryName}" (no está en la taxonomía nueva).`,
    );
  }
}

async function applyDeactivations(
  db: Db,
  categoryByName: Map<string, { id: string; isActive: boolean }>,
): Promise<void> {
  for (const name of DEACTIVATE) {
    const category = categoryByName.get(name);
    if (!category) {
      console.warn(
        `[import-catalogo] Categoría "${name}" no existe; nada que desactivar.`,
      );
      continue;
    }
    if (!category.isActive) continue; // already inactive: idempotent no-op

    await db
      .update(productCategories)
      .set({ isActive: false })
      .where(eq(productCategories.id, category.id));
    console.log(`[import-catalogo] Categoría "${name}" desactivada.`);
  }
}

export async function syncTaxonomy(db: Db): Promise<void> {
  await applyRenames(db);

  const categories = await db
    .select({
      id: productCategories.id,
      name: productCategories.name,
      slug: productCategories.slug,
      sortOrder: productCategories.sortOrder,
      isActive: productCategories.isActive,
    })
    .from(productCategories);

  const categoryByName = new Map(categories.map((c) => [c.name, c]));
  const takenSlugs = new Set(categories.map((c) => c.slug));
  let nextOrder =
    categories.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1;

  for (const entry of TAXONOMY) {
    let category = categoryByName.get(entry.category);

    if (!category) {
      const slug = uniqueSlug(slugify(entry.category), takenSlugs);
      takenSlugs.add(slug);
      const [created] = await db
        .insert(productCategories)
        .values({ name: entry.category, slug, sortOrder: nextOrder++ })
        .returning();
      category = created;
      categoryByName.set(entry.category, category);
      console.log(
        `[import-catalogo] Categoría "${entry.category}" creada (slug "${slug}").`,
      );
    } else if (!category.isActive) {
      await db
        .update(productCategories)
        .set({ isActive: true })
        .where(eq(productCategories.id, category.id));
      category.isActive = true;
      console.log(`[import-catalogo] Categoría "${entry.category}" reactivada.`);
    }

    await syncSubtypes(db, category.id, entry.category, entry.subtypes);
  }

  await applyDeactivations(db, categoryByName);
}

// --- Runner -------------------------------------------------------------

async function main(): Promise<void> {
  const { db, close } = createScriptDb();
  try {
    await syncTaxonomy(db);
    console.log("[import-catalogo] Taxonomía sincronizada.");
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
