/**
 * One-off catalog import for Unamargo (2026-08-20).
 *
 *   npm run db:import-catalogo
 *
 * Use the npm script, NOT a bare `npx tsx scripts/import-catalogo.ts`: tsx does
 * not read `.env` on its own, so the bare form falls back to the local Docker
 * database and reports success while production stays untouched. The runner
 * announces its target database (host and name, never credentials) on the first
 * line, so the operator can see which one is about to change.
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
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/**
 * The sync runs on whatever handle the caller gives it: the plain connection or
 * an open transaction. main() opens the transaction OUTSIDE syncTaxonomy on
 * purpose -- T4 needs to run the same body and roll it back for `--dry-run`,
 * and T6 uploads photos to a bucket, which cannot live inside a transaction.
 */
type Executor = Db | Tx;

/**
 * A failure the operator has to resolve by hand (a duplicate row, a name that
 * differs only in case). main() prints these with the repo's
 * `[import-catalogo] ERROR:` prefix and no stack trace, because the stack adds
 * nothing to "resolvé el duplicado desde Configuración". Anything else is
 * unexpected and keeps its stack.
 */
class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

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

// --- Name matching -----------------------------------------------------------

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
};

type SubtypeRow = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
};

/**
 * Case- and accent-insensitive form, for DETECTING near misses only: names are
 * always written to the database exactly as TAXONOMY declares them.
 * `product_categories.name` is case-sensitive in Postgres, so "combos" and
 * "Combos" can coexist -- and if they did, an exact-match sync would create the
 * second one silently, which is the duplicate the renames exist to prevent.
 */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Exact match, or nothing. A row that differs only by case or accents is not a
 * match and not a licence to create a second row either: stop and let a human
 * decide which name is the right one.
 */
function matchByName<T extends { name: string }>(
  rows: T[],
  wanted: string,
  describe: (found: T) => string,
): T | undefined {
  const exact = rows.find((row) => row.name === wanted);
  if (exact) return exact;
  const near = rows.find(
    (row) => normalizeName(row.name) === normalizeName(wanted),
  );
  if (near) throw new ImportError(describe(near));
  return undefined;
}

// --- Sort order --------------------------------------------------------------

/**
 * The public site orders by sort_order, so the declared order has to be the
 * stored one: everything TAXONOMY names takes 1..N in the order it is declared,
 * and whatever is left (the deactivated rows) is renumbered after it by its
 * current (sort_order, name) -- a total order, so the result is deterministic
 * and a second run finds nothing to change. Pure function: no database here.
 */
function planSortOrder<T extends { name: string; sortOrder: number }>(
  rows: T[],
  declared: string[],
): Array<{ row: T; sortOrder: number }> {
  const declaredSet = new Set(declared);
  const byName = new Map(rows.map((row) => [row.name, row]));
  const ordered: T[] = [];
  for (const name of declared) {
    const row = byName.get(name);
    if (row) ordered.push(row);
  }
  const rest = rows
    .filter((row) => !declaredSet.has(row.name))
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"),
    );
  return [...ordered, ...rest].map((row, index) => ({
    row,
    sortOrder: index + 1,
  }));
}

// --- Reads -------------------------------------------------------------------

async function fetchCategories(db: Executor): Promise<CategoryRow[]> {
  return db
    .select({
      id: productCategories.id,
      name: productCategories.name,
      slug: productCategories.slug,
      sortOrder: productCategories.sortOrder,
      isActive: productCategories.isActive,
    })
    .from(productCategories);
}

async function fetchSubtypes(
  db: Executor,
  categoryId: string,
): Promise<SubtypeRow[]> {
  return db
    .select({
      id: productSubtypes.id,
      name: productSubtypes.name,
      slug: productSubtypes.slug,
      sortOrder: productSubtypes.sortOrder,
      isActive: productSubtypes.isActive,
    })
    .from(productSubtypes)
    .where(eq(productSubtypes.categoryId, categoryId));
}

// --- Sync --------------------------------------------------------------------

/**
 * Both columns this touches are globally unique, so it is the one write that
 * cannot assume anything: the target name may already exist (an admin can
 * create "Mates" from Configuración) and the target slug may be held by a row
 * whose name gives no hint, because renaming from Configuración deliberately
 * never touches the slug.
 */
async function applyRenames(db: Executor): Promise<void> {
  for (const rename of RENAMES) {
    // Re-read per entry: the previous rename moved a name and a slug.
    const categories = await fetchCategories(db);
    const source = categories.find((c) => c.name === rename.from);
    const target = categories.find((c) => c.name === rename.to);
    const slugOwner = categories.find((c) => c.slug === rename.toSlug);

    // Both rows exist: merging them would strand one and its subtypes.
    if (source && target) {
      throw new ImportError(
        `existen a la vez las categorías "${rename.from}" y "${rename.to}". ` +
          `El import no fusiona filas: dejá una sola desde Configuración y volvé a correrlo.`,
      );
    }

    // The row that has to end up owning the target slug, if any exists yet.
    const keeper = source ?? target;
    if (slugOwner && (!keeper || slugOwner.id !== keeper.id)) {
      throw new ImportError(
        `el slug "${rename.toSlug}" ya lo usa la categoría "${slugOwner.name}". ` +
          `Liberalo a mano antes de correr el import.`,
      );
    }

    if (source) {
      await db
        .update(productCategories)
        .set({ name: rename.to, slug: rename.toSlug })
        .where(eq(productCategories.id, source.id));
      console.log(
        `[import-catalogo] Categoría "${rename.from}" renombrada a "${rename.to}" (slug -> "${rename.toSlug}").`,
      );
      continue;
    }

    // Already named as we want it. It may still carry the old slug: renaming
    // from Configuración changes the label and never the address.
    if (target && target.slug !== rename.toSlug) {
      await db
        .update(productCategories)
        .set({ slug: rename.toSlug })
        .where(eq(productCategories.id, target.id));
      console.log(
        `[import-catalogo] Categoría "${rename.to}" ya estaba renombrada; slug corregido de "${target.slug}" a "${rename.toSlug}".`,
      );
    }
  }
}

async function reorderSubtypes(
  db: Executor,
  categoryId: string,
  categoryName: string,
  desiredNames: string[],
): Promise<void> {
  const rows = await fetchSubtypes(db, categoryId);
  for (const { row, sortOrder } of planSortOrder(rows, desiredNames)) {
    if (row.sortOrder === sortOrder) continue;
    await db
      .update(productSubtypes)
      .set({ sortOrder })
      .where(eq(productSubtypes.id, row.id));
    console.log(
      `[import-catalogo] Subtipo "${row.name}" de "${categoryName}" ordenado en ${sortOrder}.`,
    );
  }
}

async function syncSubtypes(
  db: Executor,
  categoryId: string,
  categoryName: string,
  desiredNames: string[],
): Promise<void> {
  const existing = await fetchSubtypes(db, categoryId);

  const desiredSet = new Set(desiredNames);
  const takenSlugs = new Set(existing.map((s) => s.slug));

  for (const [index, name] of desiredNames.entries()) {
    const current = matchByName(
      existing,
      name,
      (near) =>
        `el subtipo "${near.name}" de "${categoryName}" difiere de "${name}" solo por mayúsculas o acentos. ` +
        `Corregilo desde Configuración y volvé a correr el import.`,
    );
    if (!current) {
      const slug = uniqueSlug(slugify(name), takenSlugs);
      takenSlugs.add(slug);
      await db.insert(productSubtypes).values({
        categoryId,
        name,
        slug,
        sortOrder: index + 1,
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

  await reorderSubtypes(db, categoryId, categoryName, desiredNames);
}

async function applyDeactivations(
  db: Executor,
  categories: CategoryRow[],
): Promise<void> {
  for (const name of DEACTIVATE) {
    const category = matchByName(
      categories,
      name,
      (near) =>
        `la categoría "${near.name}" difiere de "${name}" solo por mayúsculas o acentos. ` +
        `Decidí a mano si hay que desactivarla y volvé a correr el import.`,
    );
    if (!category) {
      // Correct on a clean database: there is nothing to deactivate.
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
    category.isActive = false;
    console.log(`[import-catalogo] Categoría "${name}" desactivada.`);
  }
}

async function reorderCategories(db: Executor): Promise<void> {
  const rows = await fetchCategories(db);
  const declared = TAXONOMY.map((entry) => entry.category);
  for (const { row, sortOrder } of planSortOrder(rows, declared)) {
    if (row.sortOrder === sortOrder) continue;
    await db
      .update(productCategories)
      .set({ sortOrder })
      .where(eq(productCategories.id, row.id));
    console.log(
      `[import-catalogo] Categoría "${row.name}" ordenada en ${sortOrder}.`,
    );
  }
}

export async function syncTaxonomy(db: Executor): Promise<void> {
  await applyRenames(db);

  const categories = await fetchCategories(db);
  const takenSlugs = new Set(categories.map((c) => c.slug));

  for (const [index, entry] of TAXONOMY.entries()) {
    let category = matchByName(
      categories,
      entry.category,
      (near) =>
        `la categoría "${near.name}" difiere de "${entry.category}" solo por mayúsculas o acentos. ` +
        `Corregila desde Configuración y volvé a correr el import.`,
    );

    if (!category) {
      const slug = uniqueSlug(slugify(entry.category), takenSlugs);
      takenSlugs.add(slug);
      const [created] = await db
        .insert(productCategories)
        .values({ name: entry.category, slug, sortOrder: index + 1 })
        .returning({
          id: productCategories.id,
          name: productCategories.name,
          slug: productCategories.slug,
          sortOrder: productCategories.sortOrder,
          isActive: productCategories.isActive,
        });
      category = created;
      categories.push(category);
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

  await applyDeactivations(db, categories);
  await reorderCategories(db);
}

// --- Runner -------------------------------------------------------------

/** Host and database name of the target, NEVER user or password. */
function describeTarget(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return "fallback local de scripts/lib/db.ts (DATABASE_URL no está definida)";
  }
  try {
    const parsed = new URL(url);
    const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    const name = parsed.pathname.replace(/^\//, "") || "(sin nombre)";
    return `${host}/${name}`;
  } catch {
    return "DATABASE_URL ilegible";
  }
}

async function main(): Promise<void> {
  console.log(`[import-catalogo] Base de datos destino: ${describeTarget()}.`);
  const { db, close } = createScriptDb();
  try {
    // One transaction for the whole taxonomy: ~30 statements in autocommit
    // would leave the client's taxonomy half migrated if any of them failed.
    // It is opened here and not inside syncTaxonomy so T4 can roll the same
    // body back for --dry-run and T6 can upload photos outside of it.
    await db.transaction(async (tx) => {
      await syncTaxonomy(tx);
    });
    console.log("[import-catalogo] Taxonomía sincronizada.");
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  // `|| error.name`: an AggregateError (a refused connection, say) carries an
  // empty message, and a bare "ERROR:" line tells the operator nothing.
  const message =
    error instanceof Error ? error.message || error.name : String(error);
  console.error(`[import-catalogo] ERROR: ${message}`);
  // Expected failures are self-explanatory; anything else keeps its stack.
  if (!(error instanceof ImportError)) console.error(error);
  process.exit(1);
});
