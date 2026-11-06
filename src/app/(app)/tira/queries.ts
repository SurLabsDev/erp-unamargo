import { db } from "@/lib/db/client";
import { siteStripPhotos } from "@/lib/db/schema";
import { sortStripPhotos } from "@/lib/domain/strip";

export type StripPhotoListRow = {
  id: string;
  imagePath: string;
  width: number;
  height: number;
  alt: string | null;
  sortOrder: number;
  createdAt: Date;
};

/**
 * Every photo of the strip, in display order. Sorted by `sortStripPhotos`
 * (tested in the domain module) and not by an ORDER BY, so this screen applies
 * the same rule as the public endpoint instead of re-deriving it in SQL.
 */
export async function listStripPhotos(): Promise<StripPhotoListRow[]> {
  const rows = await db
    .select({
      id: siteStripPhotos.id,
      imagePath: siteStripPhotos.imagePath,
      width: siteStripPhotos.width,
      height: siteStripPhotos.height,
      alt: siteStripPhotos.alt,
      sortOrder: siteStripPhotos.sortOrder,
      createdAt: siteStripPhotos.createdAt,
    })
    .from(siteStripPhotos);
  return sortStripPhotos(rows);
}
