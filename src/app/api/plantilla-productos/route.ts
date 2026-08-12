import { getCurrentUser } from "@/lib/auth-helpers";
import { PRODUCTS_CSV_TEMPLATE } from "@/lib/domain/import";

// Canonical import template download (§9). Session required (the import
// screen is admin-only, but the template itself is harmless).
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }
  // BOM so Excel opens it as UTF-8; the parser tolerates it.
  return new Response("\uFEFF" + PRODUCTS_CSV_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="plantilla-productos.csv"',
      "Cache-Control": "no-store",
    },
  });
}
