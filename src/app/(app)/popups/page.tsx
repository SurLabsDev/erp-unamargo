import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireAdminPage } from "@/lib/auth-helpers";
import { describeSchedule } from "@/lib/domain/popups";
import { formatDateTime, todayInTimeZone } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { PopupsManager } from "./popups-manager";
import { listPopups } from "./queries";

export const metadata: Metadata = { title: "Pop-ups" };

export default async function PopupsPage() {
  await requireAdminPage();
  const settings = await getSettings();
  const popups = await listPopups(todayInTimeZone(settings.timezone));

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Pop-ups"
        description="Se muestra uno solo a la vez: el que está en vivo y se editó más recientemente. Cada visitante lo ve una vez, hasta que se vuelva a editar."
      />
      <PopupsManager
        popups={popups.map((popup) => ({
          id: popup.id,
          title: popup.title,
          schedule: describeSchedule(popup.startsOn, popup.endsOn),
          editedAt: formatDateTime(popup.updatedAt, settings.timezone),
          isActive: popup.isActive,
          state: popup.state,
          isShown: popup.isShown,
        }))}
      />
    </div>
  );
}
