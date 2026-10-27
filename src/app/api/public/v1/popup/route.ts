import { db } from "@/lib/db/client";
import { sitePopups } from "@/lib/db/schema";
import { pickPopup, toPublicPopup } from "@/lib/domain/popups";
import { todayInTimeZone } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { publicImageUrl } from "@/lib/storage";

// The SECOND public endpoint, next to /v1/stock (see DECISIONS.md 2026-10-27
// for why it is its own endpoint and not a field of /v1/stock). Same rules as
// that one: read-only, for the client's site, no auth, no cookies; abuse is
// handled by CDN caching (s-maxage + SWR), not rate limiting. Versioned under
// /v1 because breaking it breaks the client's website: fields may only be
// ADDED, never renamed nor removed. Methods other than GET/OPTIONS get Next's
// 405.
//
// Contract: { generated_at, popup: null | { version, title, body, image, cta } }.
// `title` and `body` are plain text ("\n" line breaks), never HTML. `cta.url`
// is ONLY `https://…` or an in-page `#anchor`.
//
// NEVER expose: the internal id, `created_by`, the dates or the active flag.
// The ERP decides which single pop-up is showing, so the site needs none of
// them; `version` is all it needs to show each visitor a pop-up once until it
// is edited. The response object is built field by field in `toPublicPopup`
// (src/lib/domain/popups.ts, with tests), never by spreading a row.
//
// Like /v1/stock, the CDN keeps a response for 60s and, after that, may serve
// the old copy once more while it refreshes it in the background (SWR, up to
// 300s more). So switching a pop-up off can take a few minutes to reach a
// caller that fetches this URL as is; a consumer that needs it sooner adds a
// changing query string, which is what the site already does for /v1/stock.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
} as const;

export async function GET(): Promise<Response> {
  const [rows, settings] = await Promise.all([
    // Every row, switched off and ended included: a few dozen at most, and
    // filtering here would duplicate the state rule that `popupState` owns
    // and tests (same reasoning as `listCampaignsWithTargets`).
    db
      .select({
        id: sitePopups.id,
        title: sitePopups.title,
        body: sitePopups.body,
        imagePath: sitePopups.imagePath,
        ctaLabel: sitePopups.ctaLabel,
        ctaUrl: sitePopups.ctaUrl,
        startsOn: sitePopups.startsOn,
        endsOn: sitePopups.endsOn,
        isActive: sitePopups.isActive,
        updatedAt: sitePopups.updatedAt,
      })
      .from(sitePopups),
    getSettings(),
  ]);

  const shown = pickPopup(rows, todayInTimeZone(settings.timezone));

  return Response.json(
    {
      generated_at: new Date().toISOString(),
      popup: shown ? await toPublicPopup(shown, publicImageUrl) : null,
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
