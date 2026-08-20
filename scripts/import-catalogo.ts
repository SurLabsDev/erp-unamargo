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
 * Parts 1 and 2 (taxonomy and the command line). Tasks 5 and 6 (see
 * .superpowers/sdd/2026-08-20-import-catalogo) extend this same file with the
 * product import and the photo upload.
 *
 * This step reconciles the product taxonomy seeded on 2026-08-19 -- inferred
 * from demo fixtures -- against the real range the client's own HTML demo
 * revealed. Categories and subtypes are NEVER deleted here, only deactivated
 * (the rule everywhere in this ERP): history and any future reactivation
 * both depend on the row surviving.
 */
import { statSync } from "node:fs";
import path from "node:path";
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

    switch (flag) {
      case "--demo-dir":
        demoDir = takeValue();
        break;
      case "--path-prefix":
        pathPrefix = takeValue();
        break;
      case "--dry-run":
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
   * in the database. Filled by Task 5; honest zeros until then. */
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

  const summary: ImportSummary = { ...EMPTY_SUMMARY };
  const { db, close } = createScriptDb();
  let started = false;
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
        const taxonomy = await syncTaxonomy(tx);
        summary.categoriesTouched = taxonomy.categoriesTouched;
        // T5 inserts the products HERE, on `tx` and never on `db`, and adds
        // its counts to `summary`.

        // --dry-run has no separate "what it would do" branch, which would
        // drift from the real one the first time somebody edited only half of
        // it: the real body runs, Postgres executes every statement, and the
        // transaction never commits.
        if (options.dryRun) throw new DryRunRollback();
      });
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
    // The log above lists writes that no longer exist. Say so: an operator
    // reading a failed production run has to know whether the rename stuck.
    // No summary follows a failure: its numbers would describe a state that
    // was rolled back.
    if (started) {
      logError(
        "La transacción se revirtió: la base quedó como estaba antes de esta corrida.",
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
