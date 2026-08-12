/**
 * Verifies the permanent stock invariant (PROMPT_ERP.md §4):
 * products.current_stock (materialized cache) must equal Σ(delta) of the
 * product's movements in the append-only ledger. Exits non-zero on mismatch.
 *
 *   npm run db:check
 */
import { eq, sql, sum } from "drizzle-orm";
import { createScriptDb, schema } from "./lib/db";

const { products, stockMovements } = schema;

async function main() {
  const { db, close } = createScriptDb();
  try {
    const rows = await db
      .select({
        sku: products.sku,
        currentStock: products.currentStock,
        ledgerSum: sql<string | null>`${sum(stockMovements.delta)}`,
      })
      .from(products)
      .leftJoin(stockMovements, eq(stockMovements.productId, products.id))
      .groupBy(products.id);

    const mismatches = rows.filter(
      (row) => row.currentStock !== Number(row.ledgerSum ?? 0),
    );

    if (mismatches.length > 0) {
      console.error("INTEGRITY FAILED — cache != Σ(delta) del ledger:");
      for (const row of mismatches) {
        console.error(
          `  ${row.sku}: current_stock=${row.currentStock} ledger=${Number(row.ledgerSum ?? 0)}`,
        );
      }
      process.exitCode = 1;
      return;
    }
    console.log(`Integridad OK: ${rows.length} productos verificados.`);
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
