// Shared helpers to read untrusted searchParams safely.

/** First value of a possibly-repeated query param; "" collapses to undefined. */
export function singleParam(
  value: string | string[] | undefined,
): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "" ? undefined : v;
}

/**
 * Page number for OFFSET pagination. Rejects fractions ("1.1" would produce a
 * non-integer SQL OFFSET), overflow ("1e300" is not a safe integer) and
 * anything below 1 — all collapse to page 1.
 */
export function parsePageParam(value: string | string[] | undefined): number {
  const n = Math.floor(Number(singleParam(value)));
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}
