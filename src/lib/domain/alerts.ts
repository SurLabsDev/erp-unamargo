// Low-stock alert rules as PURE functions (PROMPT_ERP.md §8). The state
// machine lives in products.low_stock_alerted_at: null = armed, set =
// triggered (email already sent for this stockout event).

export type AlertProductState = {
  isActive: boolean;
  currentStock: number;
  minStock: number;
  lowStockAlertedAt: Date | null;
};

export type AlertTransition = "trigger" | "rearm" | "none";

/**
 * §8 semantics:
 *  - min_stock = 0 → no control at all (and clears a stale triggered state).
 *  - trigger: armed AND active AND min > 0 AND stock <= min → ONE email.
 *  - rearm: triggered AND stock > min (strict) → silent, no email.
 *  - inactive products never trigger; their triggered state is kept so
 *    reactivation does not duplicate the event's email.
 */
export function decideAlertTransition(state: AlertProductState): AlertTransition {
  const inBreach =
    state.minStock > 0 && state.currentStock <= state.minStock;
  const triggered = state.lowStockAlertedAt !== null;

  if (triggered && (state.minStock === 0 || !inBreach)) return "rearm";
  if (!triggered && state.isActive && inBreach) return "trigger";
  return "none";
}

// --- Email content (pure builders, tested) ----------------------------------

export type AlertEmailProduct = {
  sku: string;
  name: string;
  currentStock: number;
  minStock: number;
  productId: string;
};

export function buildAlertEmail(input: {
  companyName: string;
  appUrl: string;
  products: AlertEmailProduct[];
}): { subject: string; text: string } {
  const { companyName, appUrl, products } = input;

  if (products.length === 1) {
    const p = products[0];
    return {
      subject: `[${companyName}] Stock bajo: ${p.sku} — ${p.name}`,
      text: [
        `El producto ${p.sku} — ${p.name} quedó en o por debajo de su mínimo.`,
        "",
        `Stock actual: ${p.currentStock}`,
        `Stock mínimo: ${p.minStock}`,
        "",
        `Ver producto: ${appUrl}/stock/${p.productId}`,
        "",
        `Este aviso se envía una sola vez por quiebre; se reactiva al reponer por encima del mínimo.`,
      ].join("\n"),
    };
  }

  // Batch (§8.6): one summary email, never N individual ones.
  return {
    subject: `[${companyName}] Stock bajo: ${products.length} productos`,
    text: [
      `${products.length} productos quedaron en o por debajo de su mínimo:`,
      "",
      ...products.map(
        (p) =>
          `- ${p.sku} — ${p.name}: stock ${p.currentStock} (mínimo ${p.minStock})`,
      ),
      "",
      `Ver stock: ${appUrl}/stock`,
      "",
      `Este aviso se envía una sola vez por quiebre; se reactiva al reponer por encima del mínimo.`,
    ].join("\n"),
  };
}
