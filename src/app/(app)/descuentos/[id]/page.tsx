import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { listCatalog, listClassificationOptions } from "@/app/(app)/stock/queries";
import { Badge } from "@/components/ui/badge";
import { requireAdminPage } from "@/lib/auth-helpers";
import type { CampaignState } from "@/lib/domain/discounts";
import { formatDate } from "@/lib/format";
import { getCampaign } from "../queries";
import { CampaignEditForm } from "./campaign-edit-form";
import { TargetsManager } from "./targets-manager";

export const metadata: Metadata = { title: "Campaña" };

const STATE_LABELS: Record<CampaignState, string> = {
  active: "Activa",
  scheduled: "Programada",
  ended: "Terminada",
  paused: "Pausada",
};

export default async function CampaignDetailPage(
  props: PageProps<"/descuentos/[id]">,
) {
  await requireAdminPage();
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();

  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const [opciones, catalogo] = await Promise.all([
    listClassificationOptions(),
    listCatalog(),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/descuentos"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver a descuentos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {campaign.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {campaign.percentage}% de descuento · {formatDate(campaign.startsOn)}{" "}
              a {formatDate(campaign.endsOn)}
            </p>
          </div>
          <Badge variant={campaign.state === "active" ? "default" : "secondary"}>
            {STATE_LABELS[campaign.state]}
          </Badge>
        </div>
      </div>

      <CampaignEditForm
        campaignId={campaign.id}
        name={campaign.name}
        percentage={campaign.percentage}
        startsOn={campaign.startsOn}
        endsOn={campaign.endsOn}
      />

      <TargetsManager
        campaignId={campaign.id}
        targets={campaign.targets}
        // Only active categories/subtypes/products are offered for NEW
        // targets, same rationale as `listClassificationOptions`: existing
        // targets on since-deactivated entries keep showing (their label
        // already resolved server-side in `getCampaign`), they're just not
        // offered again from these pickers.
        opciones={opciones}
        productos={catalogo
          .filter((product) => product.isActive)
          .map((product) => ({
            id: product.id,
            sku: product.sku,
            name: product.name,
          }))}
      />
    </div>
  );
}
