import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth-helpers";
import { db } from "@/lib/db/client";
import { productImages, products } from "@/lib/db/schema";
import { publicImageUrl } from "@/lib/storage";
import { LoteForm } from "./lote-form";

export const metadata: Metadata = { title: "Registrar movimiento" };

export default async function MovimientoPage() {
  await requireUser();

  const [filas, fotos] = await Promise.all([
    db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        currentStock: products.currentStock,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.sku)),
    db
      .select({ productId: productImages.productId, path: productImages.path })
      .from(productImages)
      .orderBy(asc(productImages.sortOrder), asc(productImages.id)),
  ]);

  const principal = new Map<string, string>();
  for (const f of fotos) {
    if (!principal.has(f.productId))
      principal.set(f.productId, publicImageUrl(f.path));
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Registrar movimiento"
        description="Entrada o salida de mercadería, varios productos de una vez."
      />
      <LoteForm
        productos={filas.map((f) => ({
          ...f,
          foto: principal.get(f.id) ?? null,
        }))}
      />
    </div>
  );
}
