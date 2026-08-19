// Reglas de descuentos como funciones puras: sin base, testeables solas.
// La aritmetica de plata va en centavos con BigInt, igual que el modulo Dinero
// (ver DECISIONS.md): un float redondea mal y aca el resultado es un precio.

export const MIN_PERCENTAGE = 1;
/** Un dedo de mas convierte 10 en 100 y regala el catalogo. Para regalar algo
 * se pone precio 0 a mano, que es una decision visible. */
export const MAX_PERCENTAGE = 90;

export type CampaignState = "paused" | "scheduled" | "ended" | "active";

export type DiscountCampaign = {
  id: string;
  name: string;
  percentage: number;
  startsOn: string; // "YYYY-MM-DD"
  endsOn: string; // "YYYY-MM-DD"
  isActive: boolean;
};

/**
 * Estado derivado, nunca almacenado. Las condiciones se evaluan EN ORDEN y gana
 * la primera: una campana pausada y ademas vencida muestra un solo estado.
 *
 * `todayISO` viene de `todayInTimeZone(settings.timezone)`, nunca del UTC del
 * servidor: con Montevideo en UTC-3 una campana que termina "hoy" se apagaria
 * tres horas antes de tiempo.
 */
export function campaignState(
  campaign: DiscountCampaign,
  todayISO: string,
): CampaignState {
  if (!campaign.isActive) return "paused";
  if (todayISO < campaign.startsOn) return "scheduled";
  if (todayISO > campaign.endsOn) return "ended";
  return "active";
}

/** Precio con el descuento aplicado, como string decimal de dos decimales. */
export function discountedPrice(price: string, percentage: number): string {
  const centavos = toCents(price);
  // Redondeo medio-arriba: 14999.85 centavos de descuento van a 15000.
  const descuento = (centavos * BigInt(percentage) * 2n + 100n) / 200n;
  return fromCents(centavos - descuento);
}

function toCents(price: string): bigint {
  const [enteros, decimales = ""] = price.split(".");
  return BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, "0").slice(0, 2));
}

function fromCents(centavos: bigint): string {
  const entero = centavos / 100n;
  const resto = (centavos % 100n).toString().padStart(2, "0");
  return `${entero}.${resto}`;
}
