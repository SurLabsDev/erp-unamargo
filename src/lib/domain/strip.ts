// Rules of the photo strip that runs under the hero of the client's website,
// as pure functions: no database, testable in isolation. Same shape as
// popups.ts. The admin screen (src/app/(app)/tira) and the public endpoint
// (src/app/api/public/v1/tira) both order through `sortStripPhotos`, so the
// ERP shows exactly the order the site gets.
//
// Client components import this module too (limits, labels), so it must stay
// free of server-only imports.

import { z } from "zod";
import "@/lib/zod-locale";

/**
 * At most 20 photos. Every visitor of the home page downloads all of them, and
 * the site draws the strip twice so the loop closes without a jump, so each
 * photo costs twice in the page. 20 is more than three times the six the site
 * runs today: room to rotate seasons without turning the strip into the
 * heaviest thing on the home page. A longer strip also takes so long to come
 * around that nobody sees the photos at the end, so more would not show more.
 */
export const MAX_STRIP_PHOTOS = 20;

/** The site's `alt`: a short description, not a caption. */
export const MAX_ALT_LENGTH = 120;

export const STRIP_LIMIT_ERROR = `La tira admite hasta ${MAX_STRIP_PHOTOS} fotos. Quitá una para subir otra.`;

/** Whether one more photo fits. Checked again under a lock on every upload. */
export function canAddStripPhoto(currentCount: number): boolean {
  return currentCount < MAX_STRIP_PHOTOS;
}

export type StripOrderable = { id: string; sortOrder: number; createdAt: Date };

/**
 * Display order: `sort_order`, then the oldest upload first. The ERP never
 * writes two photos with the same number (uploads go after the highest one,
 * under a lock, and moves renumber 0..n-1), but a row edited by hand can, and
 * `created_at` keeps the order stable then. An exact tie goes to the smaller
 * id: it only has to be deterministic, since Postgres returns rows in no
 * particular order. Removing a photo leaves a gap, which changes nothing.
 */
export function compareStripPhotos(
  a: StripOrderable,
  b: StripOrderable,
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const age = a.createdAt.getTime() - b.createdAt.getTime();
  if (age !== 0) return age;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A sorted copy; the input is not touched. */
export function sortStripPhotos<T extends StripOrderable>(
  photos: readonly T[],
): T[] {
  return [...photos].sort(compareStripPhotos);
}

/** `sort_order` for a new upload: after every photo there is, so it goes last. */
export function nextStripSortOrder(
  photos: readonly { sortOrder: number }[],
): number {
  let max = -1;
  for (const photo of photos) max = Math.max(max, photo.sortOrder);
  return max + 1;
}

export type StripMoveDirection = "up" | "down";

export function isStripMoveDirection(value: unknown): value is StripMoveDirection {
  return value === "up" || value === "down";
}

export type SortOrderChange = { id: string; sortOrder: number };

export type StripMoveResult =
  | {
      ok: true;
      /** Every photo, in the new order, numbered 0..n-1. */
      order: SortOrderChange[];
      /** Only the rows whose number changes: what has to be written. */
      changes: SortOrderChange[];
    }
  | { ok: false; reason: "not-found" | "at-edge" };

/**
 * Moves one photo a single place up or down. The whole order is renumbered
 * 0..n-1 instead of swapping two values, which breaks the moment two photos
 * share a number (same lesson as the shop shelves in Configuración); since
 * only `changes` gets written, a move in a tidy strip touches just two rows.
 */
export function moveStripPhoto(
  photos: readonly StripOrderable[],
  id: string,
  direction: StripMoveDirection,
): StripMoveResult {
  const ordered = sortStripPhotos(photos);
  const from = ordered.findIndex((photo) => photo.id === id);
  if (from === -1) return { ok: false, reason: "not-found" };
  const to = direction === "up" ? from - 1 : from + 1;
  if (to < 0 || to >= ordered.length) return { ok: false, reason: "at-edge" };

  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  const order = ordered.map((photo, index) => ({ id: photo.id, sortOrder: index }));
  const changes = order.filter((entry, index) => ordered[index].sortOrder !== entry.sortOrder);
  return { ok: true, order, changes };
}

/**
 * The short description, as the form sends it. Optional: an empty field is
 * stored as NULL, never as "". Trimmed, because the site puts it in an `alt`
 * and a description made of spaces is no description.
 */
export const stripAltSchema = z
  .string()
  .trim()
  .max(MAX_ALT_LENGTH, {
    error: `La descripción admite hasta ${MAX_ALT_LENGTH} caracteres.`,
  })
  .transform((value) => (value === "" ? null : value));

export type StripPhotoContent = StripOrderable & {
  imagePath: string;
  width: number;
  height: number;
  alt: string | null;
};

/** One item of `photos` in GET /api/public/v1/tira. */
export type PublicStripPhoto = {
  url: string;
  width: number;
  height: number;
  alt: string | null;
};

/**
 * The `photos` array of the public contract, in display order. Each item is
 * built field by field, never by spreading the row, so a column added to the
 * table cannot reach the site by accident: the id, `created_by`, the order
 * number and the dates stay in the ERP.
 *
 * `imageUrl` turns a storage path into its public URL and returns "" when
 * storage is not configured. A photo without a URL is left out instead of
 * travelling with an empty one: the contract promises an absolute URL, and
 * the site has nothing to draw without it.
 *
 * `alt` is trimmed again on the way out, for a row edited by hand: the
 * contract says string or null, and an empty string would tell the site the
 * photo is decorative.
 */
export function toPublicStripPhotos(
  photos: readonly StripPhotoContent[],
  imageUrl: (path: string) => string,
): PublicStripPhoto[] {
  const result: PublicStripPhoto[] = [];
  for (const photo of sortStripPhotos(photos)) {
    const url = imageUrl(photo.imagePath);
    if (url === "") continue;
    const alt = photo.alt?.trim() ?? "";
    result.push({
      url,
      width: photo.width,
      height: photo.height,
      alt: alt === "" ? null : alt,
    });
  }
  return result;
}
