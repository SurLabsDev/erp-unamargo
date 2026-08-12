import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { products } from "@/lib/db/schema";

// The ONLY public endpoint (PROMPT_ERP.md §10): read-only stock for the
// client's static site. No auth, no cookies. Abuse is handled by CDN caching
// (s-maxage + SWR), not rate limiting. Versioned under /v1 because breaking
// it breaks the client's website. NEVER expose: minimums, movements, money,
// users or internal ids. Methods other than GET/OPTIONS get Next's 405.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

export async function GET(): Promise<Response> {
  const rows = await db
    .select({
      sku: products.sku,
      name: products.name,
      stock: products.currentStock,
    })
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(asc(products.sku));

  return Response.json(
    {
      generated_at: new Date().toISOString(),
      items: rows.map((row) => ({
        sku: row.sku,
        name: row.name,
        stock: row.stock,
        in_stock: row.stock > 0,
      })),
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
