// es-UY formatting helpers. Pure functions: locale is fixed, currency and
// timezone always come from the instance settings (never hardcoded).
const LOCALE = "es-UY";

/** "1234.5" | 1234.5 -> "$ 1.234,50" (symbol depends on currencyCode). */
export function formatMoney(
  amount: string | number,
  currencyCode: string,
): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** 1234 -> "1.234" */
export function formatInteger(value: number): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(
    value,
  );
}

/** "2026-08-12" (DB `date` column) -> "12/08/2026". No timezone involved. */
export function formatDate(dateISO: string): string {
  const [year, month, day] = dateISO.split("-");
  return `${day}/${month}/${year}`;
}

/** System timestamp -> "12/08/2026 14:35" in the instance timezone. */
export function formatDateTime(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(value);
}

/**
 * "Today" as YYYY-MM-DD computed in the INSTANCE timezone, never in server
 * UTC (PROMPT_ERP.md §2): at 21:00 in Montevideo, UTC is already tomorrow.
 */
export function todayInTimeZone(
  timezone: string,
  now: Date = new Date(),
): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Con que nombre se muestra un movimiento firmado por la cuenta de soporte de
 * Surlabs. La cuenta puede operar, pero no existe como usuario para el cliente:
 * no esta en Configuracion, no cuenta en el tope de 5 y no aparece en los
 * filtros. Mostrar su nombre real en el historial la delataria igual.
 *
 * El enmascarado se hace EN LA CONSULTA (un CASE en SQL), no en los
 * componentes: asi una pantalla nueva no puede olvidarse de aplicarlo.
 */
export const SUPPORT_DISPLAY_NAME = "Sistema";
