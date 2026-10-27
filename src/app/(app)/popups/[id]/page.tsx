import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAdminPage } from "@/lib/auth-helpers";
import { describeSchedule } from "@/lib/domain/popups";
import { formatDateTime, todayInTimeZone } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { publicImageUrl, storageConfigured } from "@/lib/storage";
import { PopupActiveButton } from "../popup-active-button";
import { PopupForm } from "../popup-form";
import { PopupStateBadge } from "../popup-state-badge";
import { getPopup } from "../queries";
import { PopupImage } from "./popup-image";

export const metadata: Metadata = { title: "Pop-up" };

// Props typed by hand and not as `PageProps<"/popups/[id]">`: that helper only
// learns a new route when `.next/types` is regenerated (build or dev), and
// `npm run verify` typechecks BEFORE building, so a checkout with older
// generated types would fail the gate on this route for no reason in the code.
export default async function PopupDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();

  const settings = await getSettings();
  const popup = await getPopup(id, todayInTimeZone(settings.timezone));
  if (!popup) notFound();

  // "" when storage is not configured: no image to draw in that case.
  const imageUrl = popup.imagePath ? publicImageUrl(popup.imagePath) : "";

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/popups"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver a pop-ups
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <h1 className="type-display text-2xl">{popup.title}</h1>
            <p className="text-sm text-muted-foreground">
              {describeSchedule(popup.startsOn, popup.endsOn)} · Editado el{" "}
              {formatDateTime(popup.updatedAt, settings.timezone)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PopupStateBadge state={popup.state} isShown={popup.isShown} />
            <PopupActiveButton
              popupId={popup.id}
              isActive={popup.isActive}
              variant="outline"
            />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Editar pop-up</CardTitle>
          <CardDescription>
            Cualquier cambio cuenta como edición, también la imagen y el
            encendido: se le vuelve a mostrar a quien ya lo había visto y, si
            está en vivo, pasa a ser el que muestra la web.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PopupForm
            popupId={popup.id}
            initial={{
              title: popup.title,
              body: popup.body,
              ctaLabel: popup.ctaLabel,
              ctaUrl: popup.ctaUrl,
              startsOn: popup.startsOn,
              endsOn: popup.endsOn,
            }}
          />
        </CardContent>
      </Card>

      <PopupImage
        popupId={popup.id}
        url={imageUrl || null}
        storageConfigured={storageConfigured()}
      />
    </div>
  );
}
