// Timezone-aware date helpers. Rule (PROMPT_ERP.md §2): "today", "not in the
// future" and period boundaries are computed in the INSTANCE timezone, never
// in the server's UTC clock. No date library: two-pass Intl algorithm.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for well-formed AND calendar-valid dates. Round-trip check:
 * V8 parses "2026-02-30" by rolling it over to March 2, so a NaN test is not
 * enough. Use this to sanitize untrusted params.
 */
export function isValidISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  // JS accepts year 0000 but Postgres has no year zero: reject it here.
  if (value < "0001-01-01") return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** "2026-08-12" + 1 → "2026-08-13" (pure calendar arithmetic, UTC-based). */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/**
 * UTC instant at which `dateISO` starts (00:00:00) in `timeZone`.
 * Two-pass correction converges for real-world offsets (incl. DST edges).
 */
/**
 * Dias entre dos fechas ISO, contando de la primera a la segunda.
 *
 * Se calcula en UTC a proposito: las dos fechas son dias calendario, no
 * instantes, asi que el horario de verano no tiene por que meterse. Hacerlo en
 * hora local daria 0 o 2 en el dia en que cambia la hora.
 */
export function diffDaysISO(fromISO: string, toISO: string): number {
  const a = Date.UTC(
    Number(fromISO.slice(0, 4)),
    Number(fromISO.slice(5, 7)) - 1,
    Number(fromISO.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(toISO.slice(0, 4)),
    Number(toISO.slice(5, 7)) - 1,
    Number(toISO.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

export function zonedMidnightUtc(dateISO: string, timeZone: string): Date {
  if (!isValidISODate(dateISO)) {
    throw new Error(`Fecha inválida: ${dateISO}`);
  }
  const target = Date.parse(`${dateISO}T00:00:00Z`);
  let guess = new Date(target);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(guess);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    const hour = get("hour") === 24 ? 0 : get("hour"); // Intl quirk: 24:00
    const rendered = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      hour,
      get("minute"),
      get("second"),
    );
    guess = new Date(guess.getTime() + (target - rendered));
  }
  return guess;
}

/**
 * Converts an inclusive [from, to] pair of calendar dates (as picked by the
 * user, in the instance timezone) into a UTC timestamp range for querying
 * `timestamptz` columns: from = zoned midnight, to = zoned midnight of the
 * NEXT day (exclusive upper bound).
 */
export function zonedDateRangeToUtc(
  fromISO: string | undefined,
  toISO: string | undefined,
  timeZone: string,
): { from?: Date; to?: Date } {
  return {
    from: fromISO ? zonedMidnightUtc(fromISO, timeZone) : undefined,
    to: toISO ? zonedMidnightUtc(addDaysISO(toISO, 1), timeZone) : undefined,
  };
}
