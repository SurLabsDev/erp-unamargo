import { ArrowLeftRight, ClipboardCheck, History } from "lucide-react";
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
        <div className="flex flex-wrap gap-2">
          {/* Primero y en solido: es lo que mas se hace en el dia. */}
          <Button asChild size="sm">
            <Link href="/stock/movimiento">
              <ArrowLeftRight className="size-4" />
              Registrar movimiento
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/stock/conteo">
              <ClipboardCheck className="size-4" />
              Contar stock
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/stock/movimientos">
              <History className="size-4" />
              Historial de movimientos
            </Link>
          </Button>
        </div>
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
