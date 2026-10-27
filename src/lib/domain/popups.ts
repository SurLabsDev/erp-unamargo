// Pop-up rules as pure functions: no database, testable in isolation. Same
// shape as discounts.ts: the state is DERIVED from the switch and the dates,
// never stored, so it cannot drift from them.
//
// Client components import this module too (labels, limits, schedule text),
// so it must stay free of server-only imports. That is why the version hash
// below uses Web Crypto, which exists both in the browser and in Node, and not
// `node:crypto`.

import { z } from "zod";
import "@/lib/zod-locale";
import { isValidISODate } from "./dates";
import { formatDate } from "@/lib/format";

export const MAX_TITLE_LENGTH = 80;
export const MAX_BODY_LENGTH = 500;
export const MAX_CTA_LABEL_LENGTH = 40;
export const MAX_CTA_URL_LENGTH = 2000;

export type PopupState = "off" | "scheduled" | "live" | "ended";

// Co-located with the type it labels, same convention as STATE_LABELS in
// discounts.ts.
export const POPUP_STATE_LABELS: Record<PopupState, string> = {
  live: "En vivo",
  scheduled: "Programado",
  ended: "Terminado",
  off: "Apagado",
};

export type PopupSchedule = {
  isActive: boolean;
  /** "YYYY-MM-DD", inclusive. Null: no lower bound. */
  startsOn: string | null;
  /** "YYYY-MM-DD", inclusive. Null: no upper bound. */
  endsOn: string | null;
};

/**
 * Derived state, never stored. Conditions are evaluated IN ORDER and the first
 * match wins, same as `campaignState`: a pop-up that is switched off and also
 * past its end date shows only "off".
 *
 * Both dates are optional, unlike a discount campaign's: an open-ended notice
 * ("we ship nationwide") is the normal case, and the switch is what turns it
 * off. `todayISO` comes from `todayInTimeZone(settings.timezone)`, never from
 * the server's UTC: with Montevideo at UTC-3, a pop-up ending "today" would
 * otherwise disappear three hours early.
 */
export function popupState(popup: PopupSchedule, todayISO: string): PopupState {
  if (!popup.isActive) return "off";
  if (popup.startsOn !== null && todayISO < popup.startsOn) return "scheduled";
  if (popup.endsOn !== null && todayISO > popup.endsOn) return "ended";
  return "live";
}

export type PopupCandidate = PopupSchedule & { id: string; updatedAt: Date };

/**
 * The ONE pop-up the site shows: among the live ones, the most recently
 * updated. Every write path bumps `updated_at` (content, image and the switch
 * alike), so switching one on puts it in front, which is what the admin
 * expects after pressing the button.
 *
 * The flip side, said here so nobody reads it as a bug: a pop-up scheduled to
 * start on Monday does NOT jump ahead on Monday of one that is already live and
 * was edited after it. The admin screen shows which one is on the site for that
 * reason.
 *
 * An exact tie on `updatedAt` goes to the greater id. It only has to be
 * deterministic: without it the winner would depend on row order, which in
 * Postgres changes after any unrelated UPDATE.
 */
export function pickPopup<T extends PopupCandidate>(
  popups: readonly T[],
  todayISO: string,
): T | null {
  let winner: T | null = null;
  for (const popup of popups) {
    if (popupState(popup, todayISO) !== "live") continue;
    if (winner === null || isNewer(popup, winner)) winner = popup;
  }
  return winner;
}

function isNewer(a: PopupCandidate, b: PopupCandidate): boolean {
  const diff = a.updatedAt.getTime() - b.updatedAt.getTime();
  return diff !== 0 ? diff > 0 : a.id > b.id;
}

/** An in-page anchor of the site: "#" plus ASCII letters, digits and hyphens. */
const ANCHOR = /^#[A-Za-z0-9-]+$/;

/**
 * Characters that never appear raw in a valid link (they travel
 * percent-encoded) and that are each a known way to make a link misbehave:
 * whitespace and control characters, which browsers strip while parsing an
 * href ("java\tscript:" runs as "javascript:"); invisible formatting
 * characters, which make a link read differently from where it goes; and the
 * double quote, angle brackets, backslash and backtick, which break out of an
 * HTML attribute when someone builds markup by hand.
 *
 * The single quote is NOT here, on purpose: it is a legal URL character (an
 * RFC 3986 sub-delimiter), so refusing it would reject real links. Escaping
 * attribute values is the renderer's job (React does it); what this guard
 * owns is the scheme.
 */
const UNSAFE_CHARS = /[\s\p{Cc}\p{Cf}"<>\\`]/u;

/**
 * XSS guard for the pop-up button. The URL ends up in an `href` on the public
 * site, and an `href` that starts with `javascript:` runs code in the visitor's
 * browser, so the rule is an allowlist and not a blocklist: ONLY `https://…`
 * or an in-page anchor (`#tienda`). `javascript:`, `data:`, `vbscript:`,
 * `http:`, `mailto:`, protocol-relative `//host` and relative paths are all
 * refused, whatever their case or surrounding spaces.
 *
 * The scheme is matched on the raw string, lowercase, before parsing: the URL
 * parser is forgiving (it accepts "HTTPS:", "https:evil.com" and leading
 * spaces) and what the site receives is the raw string, so the raw string is
 * what has to be right. Credentials in the URL are refused too:
 * "https://shop.example@evil.example" reads as the shop and goes to evil.
 */
export function isSafeCtaUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_CTA_URL_LENGTH) return false;
  if (ANCHOR.test(value)) return true;
  if (UNSAFE_CHARS.test(value)) return false;
  if (!value.startsWith("https://")) return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === ""
  );
}

// "" -> null: an empty optional field is stored as NULL, never as "".
const emptyToNull = (value: string): string | null =>
  value === "" ? null : value;

const optionalDate = (error: string) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || isValidISODate(value), { error })
    .transform(emptyToNull);

/**
 * What the create and edit forms send, validated. Every field arrives as a
 * string (the action passes `formData.get(x) ?? ""`); optional ones come out
 * as null when empty. The CHECK constraints on `site_popups` are the safety
 * net, not the validation: they would answer with a constraint error instead
 * of a sentence in Spanish.
 */
export const popupInputSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, { error: "El título es obligatorio." })
      .max(MAX_TITLE_LENGTH, {
        error: `El título admite hasta ${MAX_TITLE_LENGTH} caracteres.`,
      }),
    // Plain text. Line breaks are normalized to "\n" because a browser posts
    // textarea content with "\r\n", and the site should receive one form.
    body: z
      .string()
      .overwrite((value) => value.replace(/\r\n?/g, "\n"))
      .trim()
      .max(MAX_BODY_LENGTH, {
        error: `El texto admite hasta ${MAX_BODY_LENGTH} caracteres.`,
      })
      .transform(emptyToNull),
    ctaLabel: z
      .string()
      .trim()
      .max(MAX_CTA_LABEL_LENGTH, {
        error: `El texto del botón admite hasta ${MAX_CTA_LABEL_LENGTH} caracteres.`,
      })
      .transform(emptyToNull),
    ctaUrl: z
      .string()
      .trim()
      .max(MAX_CTA_URL_LENGTH, {
        error: `El link del botón admite hasta ${MAX_CTA_URL_LENGTH} caracteres.`,
      })
      .refine((value) => value === "" || isSafeCtaUrl(value), {
        error:
          "El link del botón tiene que empezar con https:// o ser una sección de la web, como #tienda.",
      })
      .transform(emptyToNull),
    startsOn: optionalDate("La fecha de inicio no es válida."),
    endsOn: optionalDate("La fecha de fin no es válida."),
  })
  .refine((value) => (value.ctaLabel === null) === (value.ctaUrl === null), {
    error:
      "El botón necesita texto y link. Si no querés botón, dejá los dos vacíos.",
    path: ["ctaUrl"],
  })
  .refine(
    (value) =>
      value.startsOn === null ||
      value.endsOn === null ||
      value.endsOn >= value.startsOn,
    {
      error: "La fecha de fin no puede ser anterior a la de inicio.",
      path: ["endsOn"],
    },
  );

export type PopupInput = z.infer<typeof popupInputSchema>;

/** "01/11/2026 a 30/11/2026", "Desde el 01/11/2026", ... for the admin list. */
export function describeSchedule(
  startsOn: string | null,
  endsOn: string | null,
): string {
  if (startsOn !== null && endsOn !== null) {
    return `${formatDate(startsOn)} a ${formatDate(endsOn)}`;
  }
  if (startsOn !== null) return `Desde el ${formatDate(startsOn)}`;
  if (endsOn !== null) return `Hasta el ${formatDate(endsOn)}`;
  return "Sin fechas";
}

/**
 * Opaque version of a pop-up: the first 16 hex characters of
 * SHA-256(id + updatedAt ISO). It changes whenever the shown pop-up changes
 * (another id) or is edited (every write bumps `updated_at`), which is what the
 * site needs to show it to each visitor once. A hash and not the raw values
 * because the public contract exposes neither the id nor the dates.
 */
export async function popupVersion(id: string, updatedAt: Date): Promise<string> {
  const bytes = new TextEncoder().encode(id + updatedAt.toISOString());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.subarray(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export type PopupContent = {
  id: string;
  updatedAt: Date;
  title: string;
  body: string | null;
  imagePath: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

/** The `popup` object of GET /api/public/v1/popup. */
export type PublicPopup = {
  version: string;
  title: string;
  body: string | null;
  image: string | null;
  cta: { label: string; url: string } | null;
};

/**
 * The public shape of the pop-up being shown: the five fields of the /v1
 * contract and nothing else. Built field by field, never by spreading the row,
 * so a column added to the table cannot reach the site by accident: the id,
 * `created_by`, the dates and the switch stay in the ERP.
 *
 * `imageUrl` turns a storage path into its public URL. It returns "" when
 * storage is not configured, and that becomes null: the contract promises an
 * absolute URL or null, never an empty string.
 *
 * The button URL is checked AGAIN here although every write path already
 * validates it: this is the last stop before it lands in an `href` on the
 * site, and a row edited by hand must not be able to put `javascript:` there.
 * An unsafe URL drops the button, not the whole pop-up.
 */
export async function toPublicPopup(
  popup: PopupContent,
  imageUrl: (path: string) => string,
): Promise<PublicPopup> {
  const image = popup.imagePath !== null ? imageUrl(popup.imagePath) : "";
  const cta =
    popup.ctaLabel !== null &&
    popup.ctaLabel.trim() !== "" &&
    popup.ctaUrl !== null &&
    isSafeCtaUrl(popup.ctaUrl)
      ? { label: popup.ctaLabel, url: popup.ctaUrl }
      : null;

  return {
    version: await popupVersion(popup.id, popup.updatedAt),
    title: popup.title,
    body: popup.body,
    image: image === "" ? null : image,
    cta,
  };
}
