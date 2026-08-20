/**
 * One-off catalog import for Unamargo (2026-08-20).
 *
 *   npm run db:import-catalogo -- [--demo-dir <ruta>] [--path-prefix <prefijo>] [--dry-run]
 *
 * Use the npm script, NOT a bare `npx tsx scripts/import-catalogo.ts`: tsx does
 * not read `.env` on its own, so the bare form falls back to the local Docker
 * database and reports success while production stays untouched. The runner
 * announces its target database (host and name, never credentials) on the first
 * line, so the operator can see which one is about to change.
 *
 * Parts 1 to 3 (taxonomy, the command line and the products). Task 6 (see
 * .superpowers/sdd/2026-08-20-import-catalogo) extends this same file with the
 * photo upload.
 *
 * The taxonomy step reconciles the product taxonomy seeded on 2026-08-19 --
 * inferred from demo fixtures -- against the real range the client's own HTML
 * demo revealed. Categories and subtypes are NEVER deleted here, only
 * deactivated (the rule everywhere in this ERP): history and any future
 * reactivation both depend on the row surviving.
 *
 * The product step then creates the 34 products of
 * scripts/data/catalogo-unamargo.json under that taxonomy, with stock 0 and no
 * ledger movement, and never touches a SKU that is already in the database.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { PRODUCT_LIMIT_LOCK } from "@/lib/db/locks";
import { slugify, uniqueSlug } from "@/lib/domain/slug";
import { MAX_ACTIVE_PRODUCTS } from "@/lib/domain/stock";
import { createScriptDb, schema } from "./lib/db";

const { productCategories, productSubtypes, products } = schema;

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
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/**
 * Thrown at the end of the transaction body when `--dry-run` is on: every
 * statement runs and reaches Postgres, and none of it is committed. main()
 * catches THIS sentinel and nothing else, so a rollback caused by a real
 * failure can never be reported as a clean simulation.
 */
class DryRunRollback extends Error {
  constructor() {
    super("--dry-run");
    this.name = "DryRunRollback";
  }
}

/**
 * Every line the runner prints goes through these three. The prefix carries the
 * mode, so no single line halfway down a long log can be read as a real write
 * when it was a simulation, or the other way round. main() sets it once, before
 * anything is printed, and nothing changes it afterwards.
 */
const PREFIX = "[import-catalogo]";
let linePrefix = PREFIX;

function log(message: string): void {
  console.log(`${linePrefix} ${message}`);
}

function warn(message: string): void {
  console.warn(`${linePrefix} ${message}`);
}

function logError(message: string): void {
  console.error(`${linePrefix} ${message}`);
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
async function applyRenames(
  db: Executor,
  touched: Set<string>,
): Promise<void> {
  for (const rename of RENAMES) {
    // Re-read per entry: the previous rename moved a name and a slug.
    const categories = await fetchCategories(db);
    // Through matchByName, like every other name lookup in this file: a row
    // left as "mate" in lower case is NOT the source of the rename, and it is
    // not a licence to create "Mates" beside it either.
    const source = matchByName(
      categories,
      rename.from,
      (near) =>
        `la categoría "${near.name}" difiere de "${rename.from}" solo por mayúsculas o acentos. ` +
        `Corregila desde Configuración y volvé a correr el import.`,
    );
    const target = matchByName(
      categories,
      rename.to,
      (near) =>
        `la categoría "${near.name}" difiere de "${rename.to}" solo por mayúsculas o acentos. ` +
        `Corregila desde Configuración y volvé a correr el import.`,
    );
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
      touched.add(rename.to);
      log(
        `Categoría "${rename.from}" renombrada a "${rename.to}" (slug -> "${rename.toSlug}").`,
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
      touched.add(rename.to);
      log(
        `Categoría "${rename.to}" ya estaba renombrada; slug corregido de "${target.slug}" a "${rename.toSlug}".`,
      );
    }
  }
}

async function reorderSubtypes(
  db: Executor,
  categoryId: string,
  categoryName: string,
  desiredNames: string[],
  touched: Set<string>,
): Promise<void> {
  const rows = await fetchSubtypes(db, categoryId);
  for (const { row, sortOrder } of planSortOrder(rows, desiredNames)) {
    if (row.sortOrder === sortOrder) continue;
    await db
      .update(productSubtypes)
      .set({ sortOrder })
      .where(eq(productSubtypes.id, row.id));
    touched.add(categoryName);
    log(`Subtipo "${row.name}" de "${categoryName}" ordenado en ${sortOrder}.`);
  }
}

async function syncSubtypes(
  db: Executor,
  categoryId: string,
  categoryName: string,
  desiredNames: string[],
  touched: Set<string>,
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
      touched.add(categoryName);
      log(`Subtipo "${name}" creado bajo "${categoryName}".`);
      continue;
    }
    if (!current.isActive) {
      await db
        .update(productSubtypes)
        .set({ isActive: true })
        .where(eq(productSubtypes.id, current.id));
      touched.add(categoryName);
      log(`Subtipo "${name}" reactivado bajo "${categoryName}".`);
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
    touched.add(categoryName);
    log(
      `Subtipo "${current.name}" desactivado bajo "${categoryName}" (no está en la taxonomía nueva).`,
    );
  }

  await reorderSubtypes(db, categoryId, categoryName, desiredNames, touched);
}

async function applyDeactivations(
  db: Executor,
  categories: CategoryRow[],
  touched: Set<string>,
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
      warn(`Categoría "${name}" no existe; nada que desactivar.`);
      continue;
    }
    if (!category.isActive) continue; // already inactive: idempotent no-op

    await db
      .update(productCategories)
      .set({ isActive: false })
      .where(eq(productCategories.id, category.id));
    touched.add(name);
    log(`Categoría "${name}" desactivada.`);
  }
}

async function reorderCategories(
  db: Executor,
  touched: Set<string>,
): Promise<void> {
  const rows = await fetchCategories(db);
  const declared = TAXONOMY.map((entry) => entry.category);
  for (const { row, sortOrder } of planSortOrder(rows, declared)) {
    if (row.sortOrder === sortOrder) continue;
    await db
      .update(productCategories)
      .set({ sortOrder })
      .where(eq(productCategories.id, row.id));
    touched.add(row.name);
    log(`Categoría "${row.name}" ordenada en ${sortOrder}.`);
  }
}

/**
 * Returns how many categories it actually WROTE (their own row, or one of their
 * subtypes), counted by name so a category rewritten three times counts once.
 * A second run over an already-imported database reports 0, and that is exactly
 * what the operator needs to read: nothing left to do.
 */
export async function syncTaxonomy(
  db: Executor,
): Promise<{ categoriesTouched: number }> {
  const touched = new Set<string>();
  await applyRenames(db, touched);

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
      touched.add(entry.category);
      log(`Categoría "${entry.category}" creada (slug "${slug}").`);
    } else if (!category.isActive) {
      await db
        .update(productCategories)
        .set({ isActive: true })
        .where(eq(productCategories.id, category.id));
      touched.add(entry.category);
      log(`Categoría "${entry.category}" reactivada.`);
    }

    await syncSubtypes(db, category.id, entry.category, entry.subtypes, touched);
  }

  await applyDeactivations(db, categories, touched);
  await reorderCategories(db, touched);
  return { categoriesTouched: touched.size };
}

// --- Product import ----------------------------------------------------------

/**
 * The catalog scripts/extract-demo-catalog.ts pulled out of the client's demo,
 * versioned beside this file. Read relative to the repo root, like
 * scripts/seed.ts reads config/instance.json: `npm run` sets the cwd there, and
 * the header of this file already requires going through the npm script.
 */
const CATALOG_PATH = "scripts/data/catalogo-unamargo.json";

/**
 * The JSON is generated and versioned, so this is not defending against a
 * hostile file: it is what turns a drift between the extractor and this import
 * into one legible line instead of a constraint violation twenty products in.
 * The limits are the ones the app validates its own products with
 * (src/lib/domain/stock.ts) -- what this writes has to be what the ERP would
 * have accepted -- and unknown keys (`merges`) are ignored on purpose: they
 * document the extraction, they are not input for the import.
 */
const catalogSchema = z.object({
  generatedFrom: z.string().min(1),
  products: z
    .array(
      z.object({
        sku: z.string().regex(/^[A-Z0-9_-]{1,40}$/),
        name: z.string().trim().min(1).max(120),
        category: z.string().min(1),
        // null, not absent, for the products whose category has no subtypes or
        // whose name names no shape.
        subtype: z.string().min(1).nullable(),
        // A decimal STRING all the way to Postgres, never a float: `price` is
        // numeric(12,2) and the round trip through a double is exactly how a
        // price the client set by hand comes back a cent short.
        price: z.string().regex(/^\d{1,10}\.\d{2}$/),
        description: z.string(),
        images: z.array(z.string()),
      }),
    )
    .min(1),
});

/** One product as the extractor left it. Task 6 reads `images` off these same
 * entries, outside the transaction. */
export type CatalogEntry = z.infer<typeof catalogSchema>["products"][number];

export function loadCatalog(): CatalogEntry[] {
  const file = path.resolve(CATALOG_PATH);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new ImportError(
      `no se pudo leer el catálogo ${file}: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `Corré el import desde la raíz del repo con npm run db:import-catalogo.`,
    );
  }

  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const where = issue.path.length > 0 ? issue.path.join(".") : "(raíz)";
    throw new ImportError(
      `el catálogo ${file} no tiene la forma esperada: ${where}: ${issue.message}. ` +
        `Regeneralo con npx tsx scripts/extract-demo-catalog.ts.`,
    );
  }

  // The SKU is the key this import is idempotent by: repeated in the file, the
  // second copy would be counted as "already existed" and the operator would
  // read a skip where the catalog has a bug.
  const seen = new Set<string>();
  for (const entry of parsed.data.products) {
    if (seen.has(entry.sku)) {
      throw new ImportError(
        `el catálogo ${file} trae el SKU "${entry.sku}" repetido. ` +
          `Regeneralo con npx tsx scripts/extract-demo-catalog.ts.`,
      );
    }
    seen.add(entry.sku);
  }
  return parsed.data.products;
}

/** An entry with its taxonomy already resolved to ids that exist. */
type ClassifiedEntry = CatalogEntry & {
  categoryId: string;
  subtypeId: string | null;
};

/**
 * Turns the names the catalog carries into the ids the taxonomy sync just wrote
 * IN THIS SAME TRANSACTION -- read, never assumed, because a hardcoded id would
 * be wrong on any database but the one it was copied from.
 *
 * Every entry is resolved BEFORE the first product is inserted: a catalog that
 * has drifted away from TAXONOMY fails as one message about the name that is
 * missing, instead of a log listing twelve products created and then an error.
 *
 * A subtype is looked up WITHIN its category. That is also what the composite
 * foreign key on (subtype_id, category_id) enforces, so getting it wrong here
 * would not corrupt anything -- it would abort the transaction with a
 * constraint name, which tells the operator nothing.
 */
async function classifyEntries(
  db: Executor,
  entries: CatalogEntry[],
): Promise<ClassifiedEntry[]> {
  const categories = await fetchCategories(db);
  // One read per category, not one per product.
  const subtypesByCategory = new Map<string, SubtypeRow[]>();
  const classified: ClassifiedEntry[] = [];

  for (const entry of entries) {
    const category = matchByName(
      categories,
      entry.category,
      (near) =>
        `el producto "${entry.sku}" declara la categoría "${entry.category}" y en la base está como "${near.name}", ` +
        `que difiere solo por mayúsculas o acentos. Corregila desde Configuración y volvé a correr el import.`,
    );
    if (!category) {
      throw new ImportError(
        `el producto "${entry.sku}" declara la categoría "${entry.category}", que no existe en la base. ` +
          `El catálogo y la taxonomía de este script se separaron: revisá TAXONOMY o regenerá el catálogo.`,
      );
    }
    // Resolving to a deactivated category would create products the client's
    // site never shows, and say nothing about it: the same drift, one step
    // further along.
    if (!category.isActive) {
      throw new ImportError(
        `el producto "${entry.sku}" cuelga de la categoría "${category.name}", que está desactivada. ` +
          `El catálogo y la taxonomía de este script se separaron: revisá TAXONOMY o regenerá el catálogo.`,
      );
    }

    // Bound to a local so the narrowing survives into the callback below: a
    // property is widened back to `string | null` inside a closure.
    const subtypeName = entry.subtype;
    let subtypeId: string | null = null;
    if (subtypeName !== null) {
      let subtypes = subtypesByCategory.get(category.id);
      if (!subtypes) {
        subtypes = await fetchSubtypes(db, category.id);
        subtypesByCategory.set(category.id, subtypes);
      }
      const subtype = matchByName(
        subtypes,
        subtypeName,
        (near) =>
          `el producto "${entry.sku}" declara el subtipo "${subtypeName}" de "${category.name}" y en la base está como "${near.name}", ` +
          `que difiere solo por mayúsculas o acentos. Corregilo desde Configuración y volvé a correr el import.`,
      );
      if (!subtype) {
        throw new ImportError(
          `el producto "${entry.sku}" declara el subtipo "${subtypeName}", que no existe bajo "${category.name}". ` +
            `El catálogo y la taxonomía de este script se separaron: revisá TAXONOMY o regenerá el catálogo.`,
        );
      }
      if (!subtype.isActive) {
        throw new ImportError(
          `el producto "${entry.sku}" cuelga del subtipo "${subtype.name}" de "${category.name}", que está desactivado. ` +
            `El catálogo y la taxonomía de este script se separaron: revisá TAXONOMY o regenerá el catálogo.`,
        );
      }
      subtypeId = subtype.id;
    }

    classified.push({ ...entry, categoryId: category.id, subtypeId });
  }
  return classified;
}

/**
 * Creates the catalog's products, and never touches one that is already there:
 * an existing SKU is left exactly as it is -- name, price, description and all
 * -- and counted as skipped. That is what makes the whole script safe to run
 * twice, and it is also the honest behaviour: this import has no way of knowing
 * whether the client edited that product from the ERP after the last run.
 *
 * Runs on the transaction handle the runner passes in, under the advisory lock
 * that transaction already took (see main()). It must NOT take it again.
 */
export async function importProducts(
  db: Executor,
  entries: CatalogEntry[],
): Promise<{ created: number; skipped: number }> {
  const classified = await classifyEntries(db, entries);

  const existing = new Set(
    (
      await db
        .select({ sku: products.sku })
        .from(products)
        .where(
          inArray(
            products.sku,
            entries.map((entry) => entry.sku),
          ),
        )
    ).map((row) => row.sku),
  );

  // Checked BEFORE the first insert, not discovered halfway: on the client's
  // empty database 34 products fit with room to spare, but if someone had
  // already loaded a catalog by hand, hitting the cap at product 118 would
  // leave the operator with a rolled-back transaction and no idea why.
  const [{ active }] = await db
    .select({ active: count() })
    .from(products)
    .where(eq(products.isActive, true));
  const toCreate = classified.filter(
    (entry) => !existing.has(entry.sku),
  ).length;
  if (active + toCreate > MAX_ACTIVE_PRODUCTS) {
    throw new ImportError(
      `el catálogo agrega ${toCreate} productos a los ${active} activos que ya hay y el tope es ${MAX_ACTIVE_PRODUCTS}. ` +
        `Desactivá productos desde Stock antes de correr el import.`,
    );
  }

  // Without a slug the client's site cannot link the product. The ones already
  // taken are collected ONCE and accumulated into the set, so two products of
  // the same catalog can never pick the same one (the idiom in
  // src/lib/import-runner.ts, and the reason it is a set and not a re-query).
  const slugsUsados = new Set(
    (await db.select({ slug: products.slug }).from(products))
      .map((row) => row.slug)
      .filter((slug): slug is string => slug !== null),
  );

  let created = 0;
  let skipped = 0;

  for (const entry of classified) {
    if (existing.has(entry.sku)) {
      skipped++;
      log(`Producto "${entry.sku}" ya existe; se deja como está.`);
      continue;
    }

    const slug = uniqueSlug(slugify(entry.name) || "producto", slugsUsados);
    slugsUsados.add(slug);

    const [row] = await db
      .insert(products)
      .values({
        sku: entry.sku,
        name: entry.name,
        categoryId: entry.categoryId,
        subtypeId: entry.subtypeId,
        price: entry.price,
        description: entry.description,
        // Stock 0 and minimum 0. The real quantities are loaded by the client
        // from the ERP, which is what puts them in the ledger with an author,
        // and that is also why NO row goes into stock_movements here: with
        // stock 0 there is nothing to record, the ledger is append-only, and a
        // product with no movements keeps its SKU editable -- these SKUs were
        // derived from a demo and the client may well change them before going
        // live. A minimum of 0 additionally leaves alerts off
        // (src/lib/alerts.ts), so importing the catalog fires no breach
        // notices.
        currentStock: 0,
        minStock: 0,
        slug,
      })
      .onConflictDoNothing({ target: products.sku })
      .returning({ id: products.id });

    if (!row) {
      // The lock serializes imports, but it does not stop somebody creating
      // this SKU by hand from the ERP between the read above and this insert.
      // Skip it and say so: aborting would take down the other 33 that were
      // perfectly fine.
      skipped++;
      warn(
        `Producto "${entry.sku}" apareció en la base durante la corrida; se deja como está.`,
      );
      continue;
    }

    created++;
    log(`Producto "${entry.sku}" creado (slug "${slug}").`);
  }

  return { created, skipped };
}

// --- Command line ------------------------------------------------------------

/**
 * The client's own HTML demo, and the folder the photos come from. Same default
 * as scripts/extract-demo-catalog.ts on purpose: both read the same delivery.
 * NOTHING here ever writes inside it -- it is the client's original.
 */
const DEFAULT_DEMO_DIR =
  "/Users/coru/Desktop/Proyectos/surlabs-prod/web-unamargo/claude code unamargo";

/**
 * The `--` is not decoration: npm eats everything before it, so
 * `npm run db:import-catalogo --dry-run` passes the flag to npm (which ignores
 * it) and runs a REAL import. Every usage string in this file keeps it.
 */
const USAGE =
  "Uso: npm run db:import-catalogo -- [--demo-dir <ruta>] [--path-prefix <prefijo>] [--dry-run]";

const HELP = [
  USAGE,
  "",
  "  --demo-dir <ruta>       Carpeta de la demo del cliente, de donde salen las fotos.",
  `                          Por defecto: ${DEFAULT_DEMO_DIR}`,
  "  --path-prefix <prefijo> Prefijo de las rutas del bucket, por ejemplo _prueba/",
  "                          para poder borrar el ensayo después. Vacío por defecto.",
  "  --dry-run               Corre todo y no escribe nada: la transacción se revierte",
  "                          y no se sube ninguna foto.",
].join("\n");

type ImportOptions = {
  /** Absolute path to an existing directory. Task 6 reads the photos there. */
  demoDir: string;
  /** Either "" or a prefix ending in "/". Task 6 puts it in front of every
   * object key it writes to the bucket. */
  pathPrefix: string;
  /** Runs the whole import and keeps none of it: the transaction is rolled
   * back and Task 6 uploads no file. */
  dryRun: boolean;
};

/**
 * Must exist and be a directory. A typo here is the difference between
 * importing the client's photos and importing none, and without this check the
 * run would only fail 34 products later, halfway through the bucket.
 * A relative path resolves against the cwd, which `npm run` sets to the repo
 * root.
 */
function resolveDemoDir(value: string): string {
  // `--demo-dir ""` and `--demo-dir=` would resolve to process.cwd(), which
  // exists and IS a directory, so every check below would pass and the import
  // would quietly read the repo root instead of the client's demo.
  if (value.trim() === "") {
    throw new ImportError(
      `--demo-dir no puede estar vacío: apuntaría a ${process.cwd()}.\n${USAGE}`,
    );
  }
  const resolved = path.resolve(value);
  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    throw new ImportError(
      `no existe el directorio de la demo: ${resolved}. Pasalo con --demo-dir <ruta>.`,
    );
  }
  if (!stats.isDirectory()) {
    throw new ImportError(`--demo-dir no es un directorio: ${resolved}.`);
  }
  return resolved;
}

/**
 * The prefix ends up in front of every object key in the `productos` bucket, so
 * it is held to the same safe alphabet the app uses for its own paths (see
 * src/lib/storage.ts): a key that needs URL-encoding would be stored under one
 * name and published under another.
 *
 * A missing trailing slash is ADDED, not rejected: `--path-prefix _prueba`
 * would otherwise write `_pruebaMATE-RAN-01/foto.jpg`, real production keys
 * that nobody would think to look for when cleaning up the rehearsal.
 */
function normalizePathPrefix(value: string): string {
  if (value === "") return "";
  if (value.startsWith("/")) {
    throw new ImportError(
      `--path-prefix no puede empezar con "/": las rutas del bucket son relativas (recibido "${value}").`,
    );
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new ImportError(
      `--path-prefix solo admite letras, números, ".", "_", "-" y "/" (recibido "${value}").`,
    );
  }
  const trimmed = value.replace(/\/+$/, "");
  const segments = trimmed.split("/");
  if (segments.some((p) => p === "" || p === "." || p === "..")) {
    throw new ImportError(
      `--path-prefix tiene un segmento vacío o relativo (recibido "${value}").`,
    );
  }
  return `${trimmed}/`;
}

/**
 * Strict on purpose: an unknown flag, a missing value or a stray argument stops
 * the run instead of being ignored. This script writes the client's production
 * catalog, and a `--dry-run` swallowed as a typo is a real import nobody meant
 * to start. Accepts both `--flag value` and `--flag=value`.
 */
function parseOptions(argv: string[]): ImportOptions {
  let demoDir = DEFAULT_DEMO_DIR;
  let pathPrefix = "";
  let dryRun = false;
  const seen = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // npm strips the first `--` before handing the rest over, but not every
    // version of every runner does: skipping a literal one costs a line and
    // saves the flags after it from being read as garbage.
    if (arg === "--") continue;

    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    const takeValue = (): string => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      // The value is required and cannot be the next flag: `--path-prefix
      // --dry-run` has to fail, not prefix the bucket with "--dry-run" and
      // silently run for real.
      if (next === undefined || next.startsWith("--")) {
        throw new ImportError(`la opción ${flag} necesita un valor.\n${USAGE}`);
      }
      i++;
      return next;
    };

    // Silently letting the last one win is the one lenient behaviour nobody
    // expects from a parser that rejects unknown flags and stray arguments,
    // and it hides exactly the mistake that matters: two --path-prefix, one of
    // them the rehearsal prefix, and the run goes to production keys.
    const once = (): void => {
      if (seen.has(flag)) {
        throw new ImportError(`la opción ${flag} está repetida.\n${USAGE}`);
      }
      seen.add(flag);
    };

    switch (flag) {
      case "--demo-dir":
        once();
        demoDir = takeValue();
        break;
      case "--path-prefix":
        once();
        pathPrefix = takeValue();
        break;
      case "--dry-run":
        once();
        if (inline !== undefined) {
          throw new ImportError(`--dry-run no lleva valor.\n${USAGE}`);
        }
        dryRun = true;
        break;
      default:
        throw new ImportError(`opción desconocida: ${arg}.\n${USAGE}`);
    }
  }

  return {
    demoDir: resolveDemoDir(demoDir),
    pathPrefix: normalizePathPrefix(pathPrefix),
    dryRun,
  };
}

// --- Summary -----------------------------------------------------------------

/**
 * What the run did, printed as one line at the end. Each phase reports its own
 * numbers and main() collects them, so no phase has to know about the others.
 */
type ImportSummary = {
  /** Categories whose row or subtypes the taxonomy sync wrote. Filled by
   * syncTaxonomy (Task 3). */
  categoriesTouched: number;
  /** Products inserted, and products left alone because their SKU was already
   * in the database. Filled by importProducts. */
  productsCreated: number;
  productsSkipped: number;
  /** Photos uploaded and linked, and photos not uploaded because the product
   * already had its own. Filled by Task 6; honest zeros until then. */
  photosUploaded: number;
  photosSkipped: number;
};

const EMPTY_SUMMARY: ImportSummary = {
  categoriesTouched: 0,
  productsCreated: 0,
  productsSkipped: 0,
  photosUploaded: 0,
  photosSkipped: 0,
};

/**
 * Label first, number second ("productos creados 34"), so nothing has to agree
 * in gender or number with a count that may be 0, 1 or 42.
 */
function formatSummary(summary: ImportSummary): string {
  return (
    `categorías tocadas ${summary.categoriesTouched}; ` +
    `productos creados ${summary.productsCreated}, salteados ${summary.productsSkipped}; ` +
    `fotos subidas ${summary.photosUploaded}, salteadas ${summary.photosSkipped}`
  );
}

// --- Runner -------------------------------------------------------------

/**
 * Host, database name and -- on Supabase -- the project, NEVER the password and
 * never the whole user. The pooler host (`aws-0-<region>.pooler.supabase.com`) is the
 * same for every project on a region, so the host alone cannot tell the client's
 * database from any other; what identifies it is the `<projectref>` that Supabase
 * puts in the user (`postgres.<projectref>`). That ref is not a secret: it is the
 * subdomain of the public SUPABASE_URL.
 */
function describeTarget(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return "fallback local de scripts/lib/db.ts (DATABASE_URL no está definida)";
  }
  try {
    const parsed = new URL(url);
    const host = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    const name = parsed.pathname.replace(/^\//, "") || "(sin nombre)";
    const [, ...ref] = parsed.username.split(".");
    const project = ref.length > 0 ? ` (proyecto ${ref.join(".")})` : "";
    return `${host}/${name}${project}`;
  } catch {
    return "DATABASE_URL ilegible";
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }
  const options = parseOptions(argv);
  // Set before the first line is printed and never again: from here on every
  // line of the log says which of the two runs this was.
  if (options.dryRun) linePrefix = `${PREFIX}[SIMULACRO]`;

  log(
    options.dryRun
      ? `Base de datos destino: ${describeTarget()}. SIMULACRO: no se escribe nada, ni en la base ni en el bucket.`
      : `Base de datos destino: ${describeTarget()}. CORRIDA REAL: los cambios quedan escritos.`,
  );
  log(`Demo del cliente (solo lectura): ${options.demoDir}`);
  log(
    `Prefijo de las rutas del bucket: ${
      options.pathPrefix === "" ? "(ninguno)" : options.pathPrefix
    }`,
  );

  // Read before the connection is opened: a catalog that does not parse is not
  // worth a transaction, and the failure is the operator's to fix on disk.
  // Task 6 uploads the photos of these same entries, outside the transaction.
  const entries = loadCatalog();
  log(`Catálogo: ${entries.length} productos leídos de ${CATALOG_PATH}.`);

  const summary: ImportSummary = { ...EMPTY_SUMMARY };
  const { db, close } = createScriptDb();
  let started = false;
  // Set the instant the transaction commits, and never cleared: it is what
  // separates "the run failed and the database is untouched" from "the run
  // failed with the client's catalog already written". Only the second one is
  // worth a summary, and only the first one is worth saying it rolled back.
  let committed = false;
  try {
    try {
      // One transaction for the whole taxonomy: ~30 statements in autocommit
      // would leave the client's taxonomy half migrated if any of them failed.
      // It is opened here and not inside syncTaxonomy so this runner can roll
      // the same body back for --dry-run and T6 can upload photos outside it.
      //
      // TRAP for T5/T6: createScriptDb opens the client with `max: 1`, so the
      // transaction holds the ONLY connection. Any query issued on the outer
      // `db` handle while this is open waits for a connection that cannot be
      // freed until the transaction ends: it hangs forever, with no error and
      // no timeout. Inside here, always use `tx`.
      await db.transaction(async (tx) => {
        started = true;
        // FIRST statement of the transaction, before anything writes: same
        // order as src/lib/import-runner.ts:73, the other place that inserts
        // products under the 150-active cap. T5 checks that cap and must not
        // take the lock itself further down -- a transaction that has already
        // written unique-indexed columns and only then asks for a lock is the
        // asymmetry that turns two concurrent writers into a deadlock instead
        // of a queue. It costs nothing here and it settles the order for T5.
        await tx.execute(
          sql`select pg_advisory_xact_lock(${PRODUCT_LIMIT_LOCK})`,
        );

        const taxonomy = await syncTaxonomy(tx);
        summary.categoriesTouched = taxonomy.categoriesTouched;

        // On `tx` and never on `db`: the pool is `max: 1`, so a query on the
        // outer handle would wait forever for the connection this transaction
        // is holding. The 150-active cap it checks rides on the advisory lock
        // taken above; it does not take one of its own.
        const imported = await importProducts(tx, entries);
        summary.productsCreated = imported.created;
        summary.productsSkipped = imported.skipped;

        // --dry-run has no separate "what it would do" branch, which would
        // drift from the real one the first time somebody edited only half of
        // it: the real body runs, Postgres executes every statement, and the
        // transaction never commits.
        if (options.dryRun) throw new DryRunRollback();
      });
      committed = true;
      log("Cambios confirmados en la base.");
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
      log(
        "Transacción revertida a propósito: la base quedó exactamente como estaba.",
      );
    }

    // T6 uploads the photos HERE, OUTSIDE the transaction (a bucket does not
    // roll back) and only when options.dryRun is false. It reads the files
    // from options.demoDir and prefixes its keys with options.pathPrefix.

    log(
      `Resumen${options.dryRun ? " del SIMULACRO (nada de esto se escribió)" : ""}: ${formatSummary(summary)}.`,
    );
  } catch (error) {
    // The log above lists writes that may no longer exist. Say which: an
    // operator reading a failed production run has to know whether the rename
    // stuck.
    if (started && !committed) {
      logError(
        "La transacción se revirtió: la base quedó como estaba antes de esta corrida.",
      );
    }
    // The question is NOT "did the run finish", it is "did anything survive".
    // A summary of a rolled-back transaction describes a state that does not
    // exist. But once the transaction has committed -- or once T6 has put a
    // photo in the bucket, which no rollback takes back -- the operator needs
    // those numbers precisely BECAUSE the run failed: they are the only record
    // of what is now in the client's database and bucket. T6: keep this
    // condition true for anything it uploads.
    if (committed || summary.photosUploaded > 0) {
      log(
        `Resumen hasta el fallo (esto quedó escrito): ${formatSummary(summary)}.`,
      );
    }
    throw error;
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  // `|| error.name`: an AggregateError (a refused connection, say) carries an
  // empty message, and a bare "ERROR:" line tells the operator nothing.
  const message =
    error instanceof Error ? error.message || error.name : String(error);
  logError(`ERROR: ${message}`);
  // Expected failures are self-explanatory; anything else keeps its stack.
  if (!(error instanceof ImportError)) console.error(error);
  process.exit(1);
});
