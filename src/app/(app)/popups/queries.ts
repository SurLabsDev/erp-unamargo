import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sitePopups } from "@/lib/db/schema";
import { pickPopup, popupState, type PopupState } from "@/lib/domain/popups";

// Exactly what `popupState` and `pickPopup` (tested in the domain module) read,
// so these screens apply the same rule as the public endpoint instead of
// re-deriving it in SQL.
const candidateFields = {
  id: sitePopups.id,
  isActive: sitePopups.isActive,
  startsOn: sitePopups.startsOn,
  endsOn: sitePopups.endsOn,
  updatedAt: sitePopups.updatedAt,
};

export type PopupListRow = {
  id: string;
  title: string;
  isActive: boolean;
  startsOn: string | null;
  endsOn: string | null;
  updatedAt: Date;
  state: PopupState;
  /** The one the site is showing right now. At most one row has it. */
  isShown: boolean;
};

/**
 * Every pop-up, switched off and ended included: this is the admin list, so
 * each row carries its derived state. `isShown` marks the single one the site
 * shows, so "only one at a time" is visible on the screen instead of being a
 * surprise on the site.
 */
export async function listPopups(todayISO: string): Promise<PopupListRow[]> {
  const rows = await db
    .select({ ...candidateFields, title: sitePopups.title })
    .from(sitePopups)
    .orderBy(desc(sitePopups.createdAt), desc(sitePopups.id));

  const shownId = pickPopup(rows, todayISO)?.id ?? null;
  return rows.map((row) => ({
    ...row,
    state: popupState(row, todayISO),
    isShown: row.id === shownId,
  }));
}

export type PopupDetail = PopupListRow & {
  body: string | null;
  imagePath: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

export async function getPopup(
  id: string,
  todayISO: string,
): Promise<PopupDetail | undefined> {
  const [popup] = await db
    .select({
      ...candidateFields,
      title: sitePopups.title,
      body: sitePopups.body,
      imagePath: sitePopups.imagePath,
      ctaLabel: sitePopups.ctaLabel,
      ctaUrl: sitePopups.ctaUrl,
    })
    .from(sitePopups)
    .where(eq(sitePopups.id, id))
    .limit(1);
  if (!popup) return undefined;

  // Whether THIS one is on the site depends on every other pop-up as well.
  const candidates = await db.select(candidateFields).from(sitePopups);

  return {
    ...popup,
    state: popupState(popup, todayISO),
    isShown: pickPopup(candidates, todayISO)?.id === popup.id,
  };
}
