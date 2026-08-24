import { History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/settings";
import { StockCatalog } from "./stock-catalog";
import { listCatalog, listClassificationOptions } from "./queries";

export const metadata: Metadata = { title: "Stock" };

export default async function StockPage() {
  const user = await requireUser();
  const [rows, opciones, settings] = await Promise.all([
    listCatalog(),
    listClassificationOptions(),
    getSettings(),
  ]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Stock"
          description="Catálogo de productos y movimientos del depósito."
        />
        <Button asChild variant="outline" size="sm">
          <Link href="/stock/movimientos">
            <History className="size-4" />
            Historial de movimientos
          </Link>
        </Button>
      </div>
      <StockCatalog
        rows={rows}
        isAdmin={user.role === "admin"}
        opciones={opciones}
        moneda={settings.currencyCode}
      />
    </div>
  );
}
