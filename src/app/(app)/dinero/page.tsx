import type { Metadata } from "next";
import { ModulePlaceholder, PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Dinero" };

export default async function DineroPage() {
  await requireUser();
  return (
    <div>
      <PageHeader
        title="Dinero"
        description="Control interno. No reemplaza la contabilidad formal."
      />
      <ModulePlaceholder
        hito="Hito 2"
        detail="Ingresos, egresos, balance por período y export CSV."
      />
    </div>
  );
}
