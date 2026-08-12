import { MAX_QUANTITY, skuSchema } from "./stock";

// Products-import CSV parser (PROMPT_ERP.md §9) as PURE functions. Tolerant
// by contract: ',' or ';' autodetected, BOM optional, case-insensitive
// headers (accented "mínimo" accepted). Per-row errors never abort the file.

/**
 * Canonical Surlabs template. SINGLE SOURCE OF TRUTH: the repo file
 * templates/plantilla-productos.csv and the download endpoint serve exactly
 * this string (a unit test enforces the file matches).
 */
export const PRODUCTS_CSV_TEMPLATE = [
  "sku,nombre,stock,minimo",
  "MATE-IMP-CUE,Mate imperial forrado en cuero,10,3",
  "BOMB-ALP-PIC,Bombilla de alpaca pico de loro,12,4",
  "YER-CAN-1KG,Yerba Canarias 1 kg,40,10",
  "",
].join("\r\n");

export const MAX_IMPORT_ROWS = 150;

export type ParsedImportRow = {
  /** 1-based line number in the file (header = line 1). */
  line: number;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
};

export type RejectedImportRow = {
  line: number;
  sku: string;
  reason: string;
};

export type ParseResult =
  | { ok: false; fileError: string }
  | { ok: true; rows: ParsedImportRow[]; rejected: RejectedImportRow[] };

/** Minimal CSV line splitter with double-quote support. */
function splitCsvLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === separator) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function parseIntStrict(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  // MAX_QUANTITY also protects the int4 columns: an overflow at INSERT time
  // would abort the whole import transaction instead of one row.
  return Number.isSafeInteger(parsed) && parsed <= MAX_QUANTITY ? parsed : null;
}

const EXPECTED_HEADERS = ["sku", "nombre", "stock", "minimo"] as const;

export function parseProductsCsv(text: string): ParseResult {
  const content = text.replace(/^\uFEFF/, ""); // tolerate BOM
  const lines = content.split(/\r\n|\r|\n/);

  const headerLine = lines[0] ?? "";
  if (headerLine.trim() === "") {
    return { ok: false, fileError: "El archivo está vacío." };
  }

  // Separator autodetection over the header line.
  const separator =
    (headerLine.match(/;/g)?.length ?? 0) > (headerLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";

  const headers = splitCsvLine(headerLine, separator).map(normalizeHeader);
  const indices = EXPECTED_HEADERS.map((expected) => headers.indexOf(expected));
  if (indices.some((index) => index === -1)) {
    return {
      ok: false,
      fileError:
        "El encabezado no coincide con la plantilla: se esperan las columnas sku, nombre, stock y minimo. Descargá la plantilla desde esta pantalla.",
    };
  }
  const [skuIdx, nameIdx, stockIdx, minIdx] = indices;

  const dataLines = lines
    .map((line, index) => ({ line: index + 1, raw: line }))
    .slice(1)
    .filter((entry) => entry.raw.trim() !== "");

  if (dataLines.length === 0) {
    return { ok: false, fileError: "El archivo no tiene filas de datos." };
  }
  if (dataLines.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      fileError: `El archivo tiene ${dataLines.length} filas de datos; el máximo es ${MAX_IMPORT_ROWS}.`,
    };
  }

  const rows: ParsedImportRow[] = [];
  const rejected: RejectedImportRow[] = [];
  const seenSkus = new Set<string>();

  for (const entry of dataLines) {
    const fields = splitCsvLine(entry.raw, separator);
    const rawSku = (fields[skuIdx] ?? "").trim();
    const rawName = (fields[nameIdx] ?? "").trim();
    const rawStock = fields[stockIdx] ?? "";
    const rawMin = fields[minIdx] ?? "";

    const reject = (reason: string) =>
      rejected.push({ line: entry.line, sku: rawSku || "—", reason });

    const skuParsed = skuSchema.safeParse(rawSku);
    if (!skuParsed.success) {
      reject(
        rawSku === ""
          ? "El SKU está vacío."
          : "SKU inválido (1 a 40 caracteres: letras, números, guion y guion bajo).",
      );
      continue;
    }
    const sku = skuParsed.data;
    if (seenSkus.has(sku)) {
      reject("SKU duplicado dentro del archivo.");
      continue;
    }
    if (rawName === "") {
      reject("El nombre está vacío.");
      continue;
    }
    if (rawName.length > 120) {
      reject("El nombre admite hasta 120 caracteres.");
      continue;
    }
    const stock = parseIntStrict(rawStock);
    if (stock === null) {
      reject("El stock debe ser un número entero entre 0 y 1.000.000.");
      continue;
    }
    const minStock = parseIntStrict(rawMin);
    if (minStock === null) {
      reject("El mínimo debe ser un número entero entre 0 y 1.000.000.");
      continue;
    }

    seenSkus.add(sku);
    rows.push({ line: entry.line, sku, name: rawName, stock, minStock });
  }

  return { ok: true, rows, rejected };
}

// --- Import planning (pure, shared by preview and execute) ------------------

export const IMPORT_EXISTS_REASON =
  "Ya existe un producto con este SKU (la importación solo crea, nunca actualiza).";

export function importLimitReason(maxActive: number): string {
  return `Supera el límite de ${maxActive} SKU activos.`;
}

/**
 * Decides, in file order, which parsed rows can be created given the SKUs
 * that already exist and the remaining active-SKU capacity (§9). Pure: the
 * DB reads and the lock live in the caller.
 */
export function planImportRows(
  rows: ParsedImportRow[],
  existingSkus: ReadonlySet<string>,
  capacity: number,
  maxActive: number,
): { creatable: ParsedImportRow[]; rejected: RejectedImportRow[] } {
  const creatable: ParsedImportRow[] = [];
  const rejected: RejectedImportRow[] = [];
  let remaining = capacity;
  for (const row of rows) {
    if (existingSkus.has(row.sku)) {
      rejected.push({ line: row.line, sku: row.sku, reason: IMPORT_EXISTS_REASON });
    } else if (remaining <= 0) {
      rejected.push({
        line: row.line,
        sku: row.sku,
        reason: importLimitReason(maxActive),
      });
    } else {
      creatable.push(row);
      remaining--;
    }
  }
  return { creatable, rejected };
}
