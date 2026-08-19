import { z } from "zod";
import "@/lib/zod-locale";
import { fromCents, toCents } from "./cents";
import { addDaysISO, isValidISODate } from "./dates";

// Business rules for the shared operating balance as PURE functions/schemas.
// Money is handled as decimal STRINGS end to end (Postgres numeric) — never
// float arithmetic in JS; sums are computed by SQL aggregates.

export const CASH_KIND_LABELS: Record<"income" | "expense", string> = {
  income: "Ingreso",
  expense: "Egreso",
};

/**
 * Amount: > 0, up to two decimals, comma or dot accepted from the UI,
 * normalized to a "1234.56" string (numeric(12,2) fits 10 integer digits).
 */
export const amountSchema = z
  .string({ error: "El monto es obligatorio." })
  .trim()
  .min(1, { error: "El monto es obligatorio." })
  .transform((value) => value.replace(",", "."))
  .pipe(
    z
      .string()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, {
        error:
          "El monto debe ser un número positivo con hasta dos decimales (máx. 9.999.999.999,99).",
      })
      .refine((value) => Number(value) > 0, {
        error: "El monto debe ser mayor a cero.",
      })
      .transform((value) => Number(value).toFixed(2)),
  );

export const cashMovementSchema = z.object({
  date: z
    .string({ error: "La fecha es obligatoria." })
    .refine(isValidISODate, { error: "La fecha no es válida." }),
  kind: z.enum(["income", "expense"], { error: "Elegí ingreso o egreso." }),
  categoryId: z.uuid({ error: "Elegí una categoría." }),
  concept: z
    .string({ error: "El concepto es obligatorio." })
    .trim()
    .min(1, { error: "El concepto es obligatorio." })
    .max(200, { error: "El concepto admite hasta 200 caracteres." }),
  amount: amountSchema,
});

export const voidReasonSchema = z
  .string({ error: "El motivo de anulación es obligatorio." })
  .trim()
  .min(1, { error: "El motivo de anulación es obligatorio." })
  .max(300, { error: "El motivo admite hasta 300 caracteres." });

export const categoryNameSchema = z
  .string({ error: "El nombre es obligatorio." })
  .trim()
  .min(1, { error: "El nombre es obligatorio." })
  .max(60, { error: "El nombre admite hasta 60 caracteres." });

export const passwordSchema = z
  .string({ error: "La contraseña es obligatoria." })
  .min(8, { error: "La contraseña debe tener al menos 8 caracteres." })
  .max(100, { error: "La contraseña admite hasta 100 caracteres." });

/**
 * Operative-date rule (PROMPT_ERP.md §7.1): not in the future (in the
 * instance timezone) and not before the initial balance date.
 * Returns a Spanish error message, or null when valid.
 */
export function validateCashDate(
  dateISO: string,
  todayISO: string,
  initialBalanceDateISO: string,
): string | null {
  if (dateISO > todayISO) {
    return "La fecha no puede ser futura.";
  }
  if (dateISO < initialBalanceDateISO) {
    return `La fecha no puede ser anterior al saldo inicial (${initialBalanceDateISO
      .split("-")
      .reverse()
      .join("/")}).`;
  }
  return null;
}

// --- Period selection -------------------------------------------------------

export type PeriodPreset = "mes" | "mes-anterior" | "30-dias" | "custom";

export type Period = {
  preset: PeriodPreset;
  fromISO: string;
  toISO: string; // inclusive
};

/** First day of the month containing `dateISO`. */
function monthStart(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}

/** Last day of the month containing `dateISO`. */
function monthEnd(dateISO: string): string {
  const [y, m] = dateISO.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${dateISO.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Resolves the period selector (§7.2) against "today" IN THE INSTANCE
 * TIMEZONE. Invalid custom ranges fall back to the current month.
 */
export function resolvePeriod(
  input: {
    preset?: string;
    fromISO?: string;
    toISO?: string;
  },
  todayISO: string,
): Period {
  const { preset, fromISO, toISO } = input;
  if (
    preset === "custom" &&
    fromISO &&
    toISO &&
    isValidISODate(fromISO) &&
    isValidISODate(toISO) &&
    fromISO <= toISO
  ) {
    return { preset: "custom", fromISO, toISO };
  }
  if (preset === "mes-anterior") {
    const prev = addDaysISO(monthStart(todayISO), -1); // last day of prev month
    return { preset: "mes-anterior", fromISO: monthStart(prev), toISO: prev };
  }
  if (preset === "30-dias") {
    return { preset: "30-dias", fromISO: addDaysISO(todayISO, -29), toISO: todayISO };
  }
  return { preset: "mes", fromISO: monthStart(todayISO), toISO: monthEnd(todayISO) };
}

// --- Period summary (§7.2) --------------------------------------------------

export type PeriodTotals = {
  /** Σ income / Σ expense with date < period start (non-voided). */
  incomeBefore: string;
  expenseBefore: string;
  /** Σ income / Σ expense within the period (non-voided). */
  incomePeriod: string;
  expensePeriod: string;
};

export type PeriodSummary = {
  openingBalance: string;
  income: string;
  expense: string;
  result: string;
  closingBalance: string;
};

/**
 * §7.2 exact semantics:
 *   opening = initial_balance + Σ(income − expense) with date < period start
 *   result  = income − expense of the period
 *   closing = opening + result
 * AC-BAL-2 (closing of a period == opening of the next) follows by
 * construction.
 */
export function computePeriodSummary(
  initialBalance: string,
  totals: PeriodTotals,
): PeriodSummary {
  const opening =
    toCents(initialBalance) +
    toCents(totals.incomeBefore) -
    toCents(totals.expenseBefore);
  const income = toCents(totals.incomePeriod);
  const expense = toCents(totals.expensePeriod);
  const result = income - expense;
  return {
    openingBalance: fromCents(opening),
    income: fromCents(income),
    expense: fromCents(expense),
    result: fromCents(result),
    closingBalance: fromCents(opening + result),
  };
}

// --- CSV export (§7.3) ------------------------------------------------------

export type CashCsvRow = {
  dateISO: string;
  kind: "income" | "expense";
  categoryName: string;
  concept: string;
  amount: string; // "1234.56"
  userName: string;
};

function csvField(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * User-controlled text destined for Excel: OWASP CSV-injection mitigation.
 * A leading =, +, -, @, tab or CR would be evaluated as a formula, so it gets
 * an apostrophe prefix (rendered as plain text by Excel).
 */
function csvText(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return csvField(guarded);
}

/** "1234.56" -> "1234,56" (decimal comma, NO thousands separator). */
function csvAmount(amount: string): string {
  return amount.replace(".", ",");
}

/**
 * Excel es-UY friendly CSV: UTF-8 with BOM, `;` separator, decimal comma,
 * DD/MM/AAAA dates. Voided movements must be excluded by the caller.
 */
export function buildCashCsv(rows: CashCsvRow[]): string {
  const BOM = "\uFEFF";
  const header = "fecha;tipo;categoria;concepto;monto;usuario";
  const lines = rows.map((row) =>
    [
      row.dateISO.split("-").reverse().join("/"),
      CASH_KIND_LABELS[row.kind],
      csvText(row.categoryName),
      csvText(row.concept),
      csvAmount(row.amount),
      csvText(row.userName),
    ].join(";"),
  );
  return BOM + [header, ...lines].join("\r\n") + "\r\n";
}

/** balance_YYYYMMDD-YYYYMMDD.csv */
export function cashCsvFilename(period: Period): string {
  const compact = (iso: string) => iso.replaceAll("-", "");
  return `balance_${compact(period.fromISO)}-${compact(period.toISO)}.csv`;
}
