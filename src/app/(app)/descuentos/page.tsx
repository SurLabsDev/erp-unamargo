import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/lib/auth-helpers";
import { todayInTimeZone } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { CampaignsManager } from "./campaigns-manager";
import { listCampaigns } from "./queries";

export const metadata: Metadata = { title: "Descuentos" };

export default async function DescuentosPage() {
  await requireAdminPage();
  const settings = await getSettings();
  const campaigns = await listCampaigns(todayInTimeZone(settings.timezone));

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Descuentos"
        description="Campañas de descuento por porcentaje sobre productos, subtipos o categorías."
      />
      <CampaignsManager campaigns={campaigns} />
    </div>
  );
}
