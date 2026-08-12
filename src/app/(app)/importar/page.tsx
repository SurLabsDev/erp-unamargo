import type { Metadata } from "next";
import { ModulePlaceholder, PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Importar" };

export default async function ImportarPage() {
  await requireAdminPage();
  return (
    <div>
      <PageHeader
        title="Importar productos"
        description="Carga inicial del catálogo desde la plantilla CSV de Surlabs."
      />
      <ModulePlaceholder
        hito="Hito 3"
        detail="Importación CSV con previsualización y validación por fila."
      />
    </div>
  );
}
