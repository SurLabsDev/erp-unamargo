import { db } from "@/lib/db/client";
import { siteStripPhotos } from "@/lib/db/schema";
import { toPublicStripPhotos } from "@/lib/domain/strip";
import { publicImageUrl } from "@/lib/storage";

// The THIRD public endpoint, next to /v1/stock and /v1/popup (see DECISIONS.md
// 2026-11-06 for why it is its own endpoint). Same rules as those two:
// read-only, for the client's site, no auth, no cookies; abuse is handled by
// CDN caching (s-maxage + SWR), not rate limiting. Versioned under /v1 because
// breaking it breaks the client's website: fields may only be ADDED, never
// renamed nor removed. Methods other than GET/OPTIONS get Next's 405.
//
// Contract: { generated_at, photos: [{ url, width, height, alt }] }, in the
// exact order the site has to show them, and `photos: []` when there are
// none. `url` is the absolute public URL of the image (bucket `productos`,
// under `tira/`); `width` and `height` are the stored image's pixels, so the
// site can lay each photo out at its own proportions; `alt` is plain text or
// null.
//
// NEVER expose: the internal id, `created_by`, the order number or the dates.
// The ERP decides the order, so the site only needs the array as it comes. The
// objects are built field by field in `toPublicStripPhotos`
// (src/lib/domain/strip.ts, with tests), never by spreading a row. `id`,
// `sortOrder` and `createdAt` are fetched below ONLY to sort.
//
// Like the other two, the CDN keeps a response for 60s and may serve it once
// more while it refreshes it in the background (SWR, up to 300s more). So a
// change can take a few minutes to reach a caller that fetches this URL as is;
// a consumer that needs it sooner adds a changing query string, which is what
// the site already does for /v1/stock.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

export async function GET(): Promise<Response> {
  // Every row: 20 at most (MAX_STRIP_PHOTOS), and sorting in SQL would
  // duplicate the order rule that `sortStripPhotos` owns and tests.
  const rows = await db
    .select({
      id: siteStripPhotos.id,
      imagePath: siteStripPhotos.imagePath,
      width: siteStripPhotos.width,
      height: siteStripPhotos.height,
      alt: siteStripPhotos.alt,
      sortOrder: siteStripPhotos.sortOrder,
      createdAt: siteStripPhotos.createdAt,
    })
    .from(siteStripPhotos);

  return Response.json(
    {
      generated_at: new Date().toISOString(),
      photos: toPublicStripPhotos(rows, publicImageUrl),
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
