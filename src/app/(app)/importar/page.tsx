import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/lib/auth-helpers";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Importar" };

export default async function ImportarPage() {
  await requireAdminPage();
  return (
    <div>
      <PageHeader
        title="Importar productos"
        description="Carga inicial del catálogo desde la plantilla CSV de Surlabs, con previsualización fila por fila."
      />
      <ImportWizard />
    </div>
  );
}
