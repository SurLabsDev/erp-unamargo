import { count, eq, inArray, sql } from "drizzle-orm";
import { evaluateProductAlert, type PendingAlert } from "@/lib/alerts";
import { db } from "@/lib/db/client";
import { PRODUCT_LIMIT_LOCK } from "@/lib/db/locks";
import { products, stockMovements } from "@/lib/db/schema";
import type { ParsedImportRow, RejectedImportRow } from "@/lib/domain/import";
import { MAX_ACTIVE_PRODUCTS } from "@/lib/domain/stock";

const EXISTS_REASON =
  "Ya existe un producto con este SKU (la importación solo crea, nunca actualiza).";
const LIMIT_REASON = `Supera el límite de ${MAX_ACTIVE_PRODUCTS} SKU activos.`;

async function existingSkuSet(
  executor: Pick<typeof db, "select">,
  skus: string[],
): Promise<Set<string>> {
  if (skus.length === 0) return new Set();
  const rows = await executor
    .select({ sku: products.sku })
    .from(products)
    .where(inArray(products.sku, skus));
  return new Set(rows.map((row) => row.sku));
}

/**
 * Read-only preview (§9 step 1): marks each parsed row against the DB
 * (existing SKU, remaining 150-active capacity, in file order). The confirm
 * step re-validates everything under the lock — this is only informative.
 */
export async function previewImport(rows: ParsedImportRow[]): Promise<{
  creatable: ParsedImportRow[];
  rejected: RejectedImportRow[];
}> {
  const existing = await existingSkuSet(db, rows.map((row) => row.sku));
  const [{ active }] = await db
    .select({ active: count() })
    .from(products)
    .where(eq(products.isActive, true));
  let capacity = MAX_ACTIVE_PRODUCTS - active;

  const creatable: ParsedImportRow[] = [];
  const rejected: RejectedImportRow[] = [];
  for (const row of rows) {
    if (existing.has(row.sku)) {
      rejected.push({ line: row.line, sku: row.sku, reason: EXISTS_REASON });
    } else if (capacity <= 0) {
      rejected.push({ line: row.line, sku: row.sku, reason: LIMIT_REASON });
    } else {
      creatable.push(row);
      capacity--;
    }
  }
  return { creatable, rejected };
}

export type ImportOutcome = {
  created: number;
  rejected: RejectedImportRow[];
  pendings: PendingAlert[];
};

/**
 * §9 confirm step: imports the VALID rows only (never all-or-nothing), each
 * product entering the ledger via an 'initial' movement. Runs under the
 * PRODUCT_LIMIT_LOCK so the 150-active check cannot race, and evaluates the
 * alert state machine per product (batch email is delivered by the caller
 * AFTER commit as ONE summary).
 */
export async function executeImport(
  userId: string,
  rows: ParsedImportRow[],
): Promise<ImportOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${PRODUCT_LIMIT_LOCK})`);

    const rejected: RejectedImportRow[] = [];
    const pendings: PendingAlert[] = [];
    let created = 0;

    const existing = await existingSkuSet(tx, rows.map((row) => row.sku));
    const [{ active }] = await tx
      .select({ active: count() })
      .from(products)
      .where(eq(products.isActive, true));
    let capacity = MAX_ACTIVE_PRODUCTS - active;

    for (const row of rows) {
      if (existing.has(row.sku)) {
        rejected.push({ line: row.line, sku: row.sku, reason: EXISTS_REASON });
        continue;
      }
      if (capacity <= 0) {
        rejected.push({ line: row.line, sku: row.sku, reason: LIMIT_REASON });
        continue;
      }

      const [product] = await tx
        .insert(products)
        .values({
          sku: row.sku,
          name: row.name,
          minStock: row.minStock,
          currentStock: row.stock,
        })
        .onConflictDoNothing({ target: products.sku })
        .returning({ id: products.id });
      if (!product) {
        // Raced with a concurrent creation despite the lock's serialization
        // of imports (e.g. a manual create): reject, don't abort.
        rejected.push({ line: row.line, sku: row.sku, reason: EXISTS_REASON });
        continue;
      }

      if (row.stock > 0) {
        await tx.insert(stockMovements).values({
          productId: product.id,
          type: "initial",
          delta: row.stock,
          resultingStock: row.stock,
          note: "Importación inicial",
          createdBy: userId,
        });
      }
      created++;
      capacity--;

      const pending = await evaluateProductAlert(tx, product.id);
      if (pending) pendings.push(pending);
    }

    return { created, rejected, pendings };
  });
}
