import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Panel" };

const MODULES = [
  {
    href: "/stock",
    title: "Stock",
    description:
      "Catálogo, entradas, salidas y ajustes con historial auditable.",
  },
  {
    href: "/dinero",
    title: "Dinero",
    description:
      "Ingresos y egresos compartidos, balance por período y export CSV.",
  },
] as const;

export default async function PanelPage() {
  const user = await requireUser();

  return (
    <div>
      <PageHeader
        title={`Hola, ${user.name.split(" ")[0]}`}
        description="Resumen general de la operación."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {MODULES.map((mod) => (
          <Link key={mod.href} href={mod.href} className="group">
            <Card className="h-full transition-colors group-hover:border-foreground/30">
              <CardHeader>
                <CardTitle className="text-base">{mod.title}</CardTitle>
                <CardDescription>{mod.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        El resumen del panel (stock bajo, saldo del mes, últimos movimientos)
        se completa junto con los módulos de stock y dinero.
      </p>
    </div>
  );
}
