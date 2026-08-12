import type { Metadata } from "next";
import { ModulePlaceholder, PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/lib/auth-helpers";

export const metadata: Metadata = { title: "Configuración" };

export default async function ConfiguracionPage() {
  await requireAdminPage();
  return (
    <div>
      <PageHeader
        title="Configuración"
        description="Datos de la instancia, usuarios, categorías y alertas."
      />
      <ModulePlaceholder
        hito="Hito 2"
        detail="Saldo inicial, destinatarios de alertas, categorías y usuarios."
      />
    </div>
  );
}
