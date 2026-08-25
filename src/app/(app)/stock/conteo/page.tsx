import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth-helpers";
import { db } from "@/lib/db/client";
import { productImages, products } from "@/lib/db/schema";
import { publicImageUrl } from "@/lib/storage";
import { ConteoForm } from "./conteo-form";

export const metadata: Metadata = { title: "Contar stock" };

export default async function ConteoPage() {
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
      .select({
        productId: productImages.productId,
        path: productImages.path,
        sortOrder: productImages.sortOrder,
      })
      .from(productImages)
      .orderBy(asc(productImages.sortOrder), asc(productImages.id)),
  ]);

  // Solo la primera foto de cada uno: acá la foto sirve para reconocer el
  // producto en la mano, no para lucirlo.
  const principal = new Map<string, string>();
  for (const f of fotos) {
    if (!principal.has(f.productId)) principal.set(f.productId, publicImageUrl(f.path));
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Contar stock"
        description="Anotá lo que hay de cada producto. Lo que dejes vacío no se toca."
      />
      <ConteoForm
        productos={filas.map((f) => ({
          ...f,
          foto: principal.get(f.id) ?? null,
        }))}
      />
    </div>
  );
}
