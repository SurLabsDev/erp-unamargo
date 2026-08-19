import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/lib/auth-helpers";
import { todayInTimeZone } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { listCategories } from "../dinero/queries";
import { CatalogManager } from "./catalog-manager";
import { CategoriesManager } from "./categories-manager";
import { InstanceSettings } from "./instance-settings";
import { listProductCatalog, listUsers } from "./queries";
import { UsersManager } from "./users-manager";

export const metadata: Metadata = { title: "Configuración" };

export default async function ConfiguracionPage() {
  const admin = await requireAdminPage();
  const [settings, categories, catalog, users] = await Promise.all([
    getSettings(),
    listCategories(),
    listProductCatalog(),
    listUsers(),
  ]);

  const emailConfigured = Boolean(
    process.env.RESEND_API_KEY && process.env.EMAIL_FROM,
  );

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Configuración"
        description="Datos de la instancia, alertas, categorías y usuarios."
      />
      <InstanceSettings
        companyName={settings.companyName}
        currencyCode={settings.currencyCode}
        timezone={settings.timezone}
        initialBalance={settings.initialBalance}
        initialBalanceDate={settings.initialBalanceDate}
        todayISO={todayInTimeZone(settings.timezone)}
        alertRecipients={settings.alertRecipients}
        emailConfigured={emailConfigured}
      />
      <CategoriesManager
        categories={categories.map(({ id, name, kind, isActive, inUse }) => ({
          id,
          name,
          kind,
          isActive,
          inUse,
        }))}
      />
      <CatalogManager categories={catalog} />
      <UsersManager users={users} currentUserId={admin.id} />
    </div>
  );
}
