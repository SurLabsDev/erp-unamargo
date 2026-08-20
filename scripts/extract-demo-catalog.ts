/**
 * One-off extractor for the client's HTML demo catalog.
 *
 * Reads the demo's index.html, locates `const PRODUCTS = [`, balances square
 * brackets to find the matching close, and evaluates that slice as
 * JavaScript (it is a JS array literal — single-quoted strings, unquoted
 * keys, trailing commas — not JSON, so JSON.parse cannot read it). Applies
 * the three merges declared below, expands products with variants into one
 * entry per variant, and writes the result to scripts/data/catalogo-unamargo.json.
 *
 * This script runs once. Later tasks read the generated JSON; nobody
 * re-parses the HTML again.
 *
 *   npx tsx scripts/extract-demo-catalog.ts [demoDir]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildDescription,
  buildSku,
  deriveSubtype,
  type DemoCategory,
  type Spec,
} from "../src/lib/domain/catalog-import";

type DemoVariant = { label: string; price: number; image?: string };

type DemoProduct = {
  id: number;
  name: string;
  category: DemoCategory;
  type: string;
  material: string;
  price: number;
  badge?: string | null;
  badgeClass?: string;
  shortDesc: string;
  fullDesc: string;
  specs: Spec[];
  stock: string;
  images: string[];
  variants?: DemoVariant[];
  soldOut?: boolean;
  sinPreview?: boolean;
  video?: string;
};

type CatalogEntry = {
  sku: string;
  name: string;
  category: DemoCategory;
  subtype: string | null;
  price: string; // decimal string, two decimals — never a float
  description: string;
  images: string[]; // paths relative to the demo directory
};

type Merge = { dropped: string; keptInFavourOf: string; reason: string };

type CatalogFile = {
  generatedFrom: string;
  merges: Merge[];
  products: CatalogEntry[];
};

/** Internal merge rule: same public shape as Merge, plus an optional price
 * correction applied to a specific variant of the kept product. Only the
 * public fields (dropped/keptInFavourOf/reason) are written to the JSON. */
type MergeRule = Merge & {
  priceOverride?: { variantLabel: string; price: number };
};

const DEMO_DIR =
  process.argv[2] ??
  "/Users/coru/Desktop/Proyectos/surlabs-prod/web-unamargo/claude code unamargo";

const OUTPUT_PATH = path.resolve(__dirname, "data/catalogo-unamargo.json");

const EXPECTED_PRODUCT_COUNT = 34;
const EXPECTED_UNIQUE_IMAGE_COUNT = 42;

const MERGES: MergeRule[] = [
  {
    dropped: "Camionero Pulido",
    keptInFavourOf: "Mate Camionero",
    reason:
      "Mismas 2 fotos y precios identicos (Clasico $490 / Pulido $690): es el mismo mate cargado dos veces.",
  },
  {
    dropped: "Porongo Pulido",
    keptInFavourOf: "Porongo",
    reason:
      "Mismas 2 fotos. El precio del Clasico difiere ($450 vs $490): se toma el mayor, $490.",
    priceOverride: { variantLabel: "Clásico", price: 490 },
  },
  {
    dropped: "Combo Porongo Virola Chata + Posamate",
    keptInFavourOf: "Combo Porongo + Posamate",
    reason:
      "Foto compartida y mismo precio $990: ya existe como variante 'Virola Chata' del combo que se conserva.",
  },
];

/** Locates `const PRODUCTS = [ ... ]` in the demo HTML and returns the raw
 * JS source of the array literal, brackets included. */
function extractProductsSource(html: string): string {
  const marker = "const PRODUCTS = [";
  const markerStart = html.indexOf(marker);
  if (markerStart === -1) {
    throw new Error(
      "No se encontro 'const PRODUCTS = [' en el HTML de la demo.",
    );
  }
  const arrayStart = markerStart + marker.length - 1; // index of the opening "["
  let depth = 0;
  for (let i = arrayStart; i < html.length; i++) {
    const char = html[i];
    if (char === "[") depth++;
    else if (char === "]") {
      depth--;
      if (depth === 0) return html.slice(arrayStart, i + 1);
    }
  }
  throw new Error(
    "No se encontro el cierre del array PRODUCTS (corchetes desbalanceados).",
  );
}

/** Evaluates the extracted source as JavaScript. It is not JSON (single
 * quotes, unquoted keys, trailing commas), so it needs a real JS evaluation
 * rather than JSON.parse. */
function evaluateProducts(source: string): DemoProduct[] {
  const factory = new Function(`"use strict"; return (${source});`);
  return factory() as DemoProduct[];
}

/** Drops the merged-away products and applies the one price correction, all
 * declared as data in MERGES rather than as loose conditionals. */
function applyMerges(products: DemoProduct[]): DemoProduct[] {
  const droppedNames = new Set(MERGES.map((merge) => merge.dropped));
  const overrideByKeptName = new Map(
    MERGES.filter((merge) => merge.priceOverride).map((merge) => [
      merge.keptInFavourOf,
      merge.priceOverride!,
    ]),
  );

  return products
    .filter((product) => !droppedNames.has(product.name))
    .map((product) => {
      const override = overrideByKeptName.get(product.name);
      if (!override || !product.variants) return product;
      return {
        ...product,
        variants: product.variants.map((variant) =>
          variant.label === override.variantLabel
            ? { ...variant, price: override.price }
            : variant,
        ),
      };
    });
}

/** Builds one catalog entry, either for a plain product (variant === null) or
 * for one of its variants. */
function buildEntry(product: DemoProduct, variant: DemoVariant | null): CatalogEntry {
  const name = variant ? `${product.name} (${variant.label})` : product.name;
  const price = variant ? variant.price : product.price;
  // A variant carries a single representative image (its own, or the
  // product's first if it has none); a plain product carries its full gallery.
  const images = variant ? [variant.image ?? product.images[0]] : product.images;

  return {
    sku: buildSku(product.name, product.category, variant?.label ?? null),
    name,
    category: product.category,
    subtype: deriveSubtype(product.name, product.category),
    price: price.toFixed(2),
    description: buildDescription(product.fullDesc, product.specs),
    images,
  };
}

function toEntries(products: DemoProduct[]): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const product of products) {
    if (product.variants && product.variants.length > 0) {
      for (const variant of product.variants) entries.push(buildEntry(product, variant));
    } else {
      entries.push(buildEntry(product, null));
    }
  }
  return entries;
}

/** Every actual file under <demoDir>/images, as demo-relative paths
 * ("images/foo.jpg"), used for a case-sensitive existence check — macOS's
 * default filesystem is case-insensitive at lookup and would hide a mismatch
 * that a case-sensitive deploy target would not forgive. Normalized to NFC:
 * macOS stores filenames as NFD (accents as combining marks) while the HTML
 * source has them as NFC (precomposed), and those are the same path even
 * though they differ byte-for-byte. */
function collectActualImagePaths(demoDir: string): Set<string> {
  const imagesDir = path.join(demoDir, "images");
  if (!existsSync(imagesDir)) return new Set();
  return new Set(
    readdirSync(imagesDir).map((fileName) =>
      path.join("images", fileName).normalize("NFC"),
    ),
  );
}

function verifyImages(
  entries: CatalogEntry[],
  demoDir: string,
): { unique: string[]; missing: string[] } {
  const actual = collectActualImagePaths(demoDir);
  const unique = [...new Set(entries.flatMap((entry) => entry.images))];
  const missing = unique.filter(
    (imagePath) => !actual.has(imagePath.replace(/^\.\//, "").normalize("NFC")),
  );
  return { unique, missing };
}

function main() {
  const htmlPath = path.join(DEMO_DIR, "index.html");
  console.log(`[extract-demo-catalog] Leyendo ${htmlPath}`);
  const html = readFileSync(htmlPath, "utf8");

  const source = extractProductsSource(html);
  const rawProducts = evaluateProducts(source);
  console.log(
    `[extract-demo-catalog] ${rawProducts.length} productos crudos encontrados en la demo.`,
  );

  const merged = applyMerges(rawProducts);
  console.log("[extract-demo-catalog] Fusiones aplicadas:");
  for (const merge of MERGES) {
    console.log(`[extract-demo-catalog]   - "${merge.dropped}" -> "${merge.keptInFavourOf}": ${merge.reason}`);
  }

  const products = toEntries(merged);

  console.log(`[extract-demo-catalog] ${products.length} productos generados (esperado ${EXPECTED_PRODUCT_COUNT}).`);
  if (products.length !== EXPECTED_PRODUCT_COUNT) {
    console.error(
      `[extract-demo-catalog] ERROR: se esperaban ${EXPECTED_PRODUCT_COUNT} productos y se generaron ${products.length}. ` +
        "La demo cambio o la extraccion esta mal: parar y revisar, no ajustar el numero.",
    );
    process.exitCode = 1;
    return;
  }

  const skuCounts = new Map<string, number>();
  for (const product of products) {
    skuCounts.set(product.sku, (skuCounts.get(product.sku) ?? 0) + 1);
  }
  const duplicateSkus = [...skuCounts.entries()].filter(([, count]) => count > 1);
  console.log(`[extract-demo-catalog] SKU duplicados: ${duplicateSkus.length}.`);
  if (duplicateSkus.length > 0) {
    for (const [sku, count] of duplicateSkus) {
      console.error(`[extract-demo-catalog]   - ${sku} aparece ${count} veces`);
    }
    console.error(
      "[extract-demo-catalog] ERROR: hay SKU duplicados. Parar y revisar antes de escribir el archivo.",
    );
    process.exitCode = 1;
    return;
  }

  const maxSkuLength = Math.max(...products.map((product) => product.sku.length));
  console.log(`[extract-demo-catalog] Largo maximo de SKU: ${maxSkuLength}.`);

  const badPrices = products.filter((product) => !/^\d+\.\d{2}$/.test(product.price));
  console.log(`[extract-demo-catalog] Precios con formato invalido: ${badPrices.length}.`);
  if (badPrices.length > 0) {
    for (const product of badPrices) {
      console.error(`[extract-demo-catalog]   - ${product.sku}: "${product.price}"`);
    }
    console.error("[extract-demo-catalog] ERROR: hay precios sin dos decimales. Parar y revisar.");
    process.exitCode = 1;
    return;
  }

  const { unique: uniqueImages, missing: missingImages } = verifyImages(products, DEMO_DIR);
  console.log(
    `[extract-demo-catalog] Rutas de imagen unicas: ${uniqueImages.length} (esperado ${EXPECTED_UNIQUE_IMAGE_COUNT}).`,
  );
  if (missingImages.length > 0) {
    console.error(`[extract-demo-catalog] ERROR: ${missingImages.length} imagenes no existen en disco:`);
    for (const imagePath of missingImages) console.error(`[extract-demo-catalog]   - ${imagePath}`);
    process.exitCode = 1;
    return;
  }
  console.log("[extract-demo-catalog] Todas las imagenes referenciadas existen en disco.");

  const catalog: CatalogFile = {
    generatedFrom: htmlPath,
    merges: MERGES.map(({ dropped, keptInFavourOf, reason }) => ({
      dropped,
      keptInFavourOf,
      reason,
    })),
    products,
  };

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`[extract-demo-catalog] Escrito ${OUTPUT_PATH}`);
}

main();
