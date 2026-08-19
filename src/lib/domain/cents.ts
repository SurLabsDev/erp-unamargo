// Shared decimal-string <-> integer-cents conversion. Money throughout this
// codebase is a decimal STRING end to end (Postgres numeric) — never float
// arithmetic in JS. `money.ts` (the Dinero module) and `discounts.ts` both
// need to cross that string/BigInt boundary, so the conversion lives here
// once instead of as two private copies that can drift out of sync.

/**
 * Decimal string ("1234.56", "-0.05", "10") -> integer cents as a BigInt.
 *
 * The sign is stripped BEFORE the integer part is parsed, so a value
 * strictly between -1 and 0 (e.g. "-0.05") still negates correctly: parsing
 * "-0" directly would go through `BigInt("-0")`, which collapses to `0n` and
 * silently drops the sign.
 *
 * Precondition: `decimal` has at most 2 fractional digits. Every current
 * write path enforces this before a value reaches `toCents` (a Zod regex
 * plus a `numeric(12,2)` column), so this is unreachable today. It is
 * guarded with a thrown error rather than silently truncated, because a
 * silent truncation in money code is exactly the kind of bug that should
 * fail loudly the moment the precondition is ever violated, not quietly
 * drop a digit.
 */
export function toCents(decimal: string): bigint {
  const negative = decimal.startsWith("-");
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [intPart, fracPart = ""] = unsigned.split(".");
  if (fracPart.length > 2) {
    throw new Error(
      `toCents: "${decimal}" has more than 2 decimal places.`,
    );
  }
  const cents = BigInt(intPart || "0") * 100n + BigInt(fracPart.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/**
 * Integer cents (BigInt) -> decimal string ("1234.56", "-0.05").
 *
 * The sign is split off first and the absolute value formatted, then the
 * sign is reattached: BigInt `%` keeps the sign of its operand, so
 * formatting a negative value directly would put the minus sign inside the
 * fractional part too (e.g. "-8.-1" for -801n) instead of in front of the
 * whole string. `0n` is never negative, so this never renders "-0.00".
 */
export function fromCents(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const intPart = abs / 100n;
  const fracPart = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${intPart}.${fracPart}`;
}
