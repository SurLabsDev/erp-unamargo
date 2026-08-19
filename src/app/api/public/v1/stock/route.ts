import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  productCategories,
  productImages,
  productSubtypes,
  products,
} from "@/lib/db/schema";
import { resolveDiscount } from "@/lib/domain/discounts";
import { todayInTimeZone } from "@/lib/format";
import { listCampaignsWithTargets } from "@/app/(app)/descuentos/queries";
import { getSettings } from "@/lib/settings";
import { publicImageUrl } from "@/lib/storage";

// The ONLY public endpoint (PROMPT_ERP.md §10): read-only catalog for the
// client's site. No auth, no cookies. Abuse is handled by CDN caching
// (s-maxage + SWR), not rate limiting. Versioned under /v1 because breaking it
// breaks the client's website: fields may only be ADDED, never renamed nor
// removed. NEVER expose: minimums, movements, money, users or internal ids.
// Methods other than GET/OPTIONS get Next's 405.
//
// `id`, `categoryId` and `subtypeId` are fetched below ONLY to feed
// `resolveDiscount` in memory; they must never appear in the response object.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

export async function GET(): Promise<Response> {
  const [rows, imagenes, campanas, settings] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        stock: products.currentStock,
        slug: products.slug,
        price: products.price,
        description: products.description,
        categoryId: products.categoryId,
        categoryName: productCategories.name,
        categorySlug: productCategories.slug,
        subtypeId: products.subtypeId,
        subtypeName: productSubtypes.name,
        subtypeSlug: productSubtypes.slug,
      })
      .from(products)
      .leftJoin(
        productCategories,
        eq(products.categoryId, productCategories.id),
      )
      .leftJoin(productSubtypes, eq(products.subtypeId, productSubtypes.id))
      .where(eq(products.isActive, true))
      .orderBy(asc(products.sku)),
    db
      .select({
        sku: products.sku,
        path: productImages.path,
        sortOrder: productImages.sortOrder,
      })
      .from(productImages)
      .innerJoin(products, eq(productImages.productId, products.id))
      .where(eq(products.isActive, true))
      .orderBy(asc(productImages.sortOrder), asc(productImages.id)),
    listCampaignsWithTargets(),
    getSettings(),
  ]);

  const hoy = todayInTimeZone(settings.timezone);

  // Las fotos se agrupan en memoria: son pocas por producto y evita un
  // array_agg que complica la consulta sin ganar nada a esta escala.
  const porSku = new Map<string, string[]>();
  for (const img of imagenes) {
    const lista = porSku.get(img.sku) ?? [];
    lista.push(publicImageUrl(img.path));
    porSku.set(img.sku, lista);
  }

  return Response.json(
    {
      generated_at: new Date().toISOString(),
      items: rows.map((row) => {
        const descuento = resolveDiscount(
          {
            id: row.id,
            price: row.price,
            categoryId: row.categoryId,
            subtypeId: row.subtypeId,
          },
          campanas,
          hoy,
        );

        // `row.id`, `row.categoryId` and `row.subtypeId` end here: they fed
        // `resolveDiscount` above and are deliberately NOT read again below.
        return {
          sku: row.sku,
          name: row.name,
          stock: row.stock,
          in_stock: row.stock > 0,
          slug: row.slug,
          // String decimal, NUNCA number: un float redondea plata.
          price: row.price,
          price_final: descuento ? descuento.priceFinal : row.price,
          discount: descuento
            ? { percentage: descuento.percentage, campaign: descuento.campaignName }
            : null,
          description: row.description,
          category: row.categoryName
            ? { name: row.categoryName, slug: row.categorySlug }
            : null,
          subtype: row.subtypeName
            ? { name: row.subtypeName, slug: row.subtypeSlug }
            : null,
          images: porSku.get(row.sku) ?? [],
        };
      }),
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
