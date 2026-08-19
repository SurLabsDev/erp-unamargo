import { count, eq, inArray, sql } from "drizzle-orm";
import { evaluateProductAlert, type PendingAlert } from "@/lib/alerts";
import { db } from "@/lib/db/client";
import { PRODUCT_LIMIT_LOCK } from "@/lib/db/locks";
import { products, stockMovements } from "@/lib/db/schema";
import { slugify, uniqueSlug } from "@/lib/domain/slug";
import {
  IMPORT_EXISTS_REASON,
  planImportRows,
  type ParsedImportRow,
  type RejectedImportRow,
} from "@/lib/domain/import";
import { MAX_ACTIVE_PRODUCTS } from "@/lib/domain/stock";

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

async function activeCapacity(
  executor: Pick<typeof db, "select">,
): Promise<number> {
  const [{ active }] = await executor
    .select({ active: count() })
    .from(products)
    .where(eq(products.isActive, true));
  return MAX_ACTIVE_PRODUCTS - active;
}

/**
 * Read-only preview (§9 step 1): marks each parsed row against the DB
 * (existing SKU, remaining 150-active capacity, in file order) via the pure
 * planner. The confirm step re-validates everything under the lock — this is
 * only informative.
 */
export async function previewImport(rows: ParsedImportRow[]): Promise<{
  creatable: ParsedImportRow[];
  rejected: RejectedImportRow[];
}> {
  const existing = await existingSkuSet(
    db,
    rows.map((row) => row.sku),
  );
  const capacity = await activeCapacity(db);
  return planImportRows(rows, existing, capacity, MAX_ACTIVE_PRODUCTS);
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

    const existing = await existingSkuSet(
      tx,
      rows.map((row) => row.sku),
    );
    const capacity = await activeCapacity(tx);
    const plan = planImportRows(rows, existing, capacity, MAX_ACTIVE_PRODUCTS);

    // Los productos importados tambien necesitan slug: sin el, la web no puede
    // linkearlos. Se juntan los ya usados UNA vez y se acumulan en el set, para
    // que dos filas del mismo CSV no elijan el mismo.
    const slugsUsados = new Set(
      (await tx.select({ slug: products.slug }).from(products))
        .map((r) => r.slug)
        .filter((x): x is string => x !== null),
    );

    const rejected: RejectedImportRow[] = [...plan.rejected];
    const pendings: PendingAlert[] = [];
    let created = 0;

    for (const row of plan.creatable) {
      const [product] = await tx
        .insert(products)
        .values({
          sku: row.sku,
          name: row.name,
          minStock: row.minStock,
          currentStock: row.stock,
          slug: (() => {
            const nuevo = uniqueSlug(
              slugify(row.name) || "producto",
              slugsUsados,
            );
            slugsUsados.add(nuevo);
            return nuevo;
          })(),
        })
        .onConflictDoNothing({ target: products.sku })
        .returning({ id: products.id });
      if (!product) {
        // Raced with a concurrent manual creation despite the lock
        // serializing imports: reject the row, don't abort.
        rejected.push({
          line: row.line,
          sku: row.sku,
          reason: IMPORT_EXISTS_REASON,
        });
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

      const pending = await evaluateProductAlert(tx, product.id);
      if (pending) pendings.push(pending);
    }

    return { created, rejected, pendings };
  });
}
