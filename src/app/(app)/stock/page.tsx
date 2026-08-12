import type { Metadata } from "next";
import { ModulePlaceholder, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Stock" };

export default async function StockPage() {
  await requireUser();
  return (
    <div>
      <PageHeader
        title="Stock"
        description="Catálogo de productos y movimientos de stock."
      />
      <ModulePlaceholder
        hito="Hito 1"
        detail="Catálogo, entradas, salidas, ajustes e historial."
      />
    </div>
  );
}
