// Discount rules as pure functions: no database, testable in isolation.
// Money is handled in cents using BigInt, same as the money module
// (see DECISIONS.md): float arithmetic rounds incorrectly and here the result is a price.

export const MIN_PERCENTAGE = 1;
/** One unit too much converts 10 into 100 and gives away the catalog. To give
 * something away, the price is set to 0 manually, which is a visible decision. */
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
 * Derived state, never stored. Conditions are evaluated IN ORDER and the first
 * match wins: a paused campaign that is also expired shows only one state.
 *
 * `todayISO` comes from `todayInTimeZone(settings.timezone)`, never from the
 * server's UTC: with Montevideo in UTC-3, a campaign ending "today" would
 * shut off three hours early.
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

/** Price with discount applied, returned as a decimal string with two decimals. */
export function discountedPrice(price: string, percentage: number): string {
  const cents = toCents(price);
  // Half-up rounding: 14999.85 cents of discount rounds to 15000.
  const discount = (cents * BigInt(percentage) * 2n + 100n) / 200n;
  return fromCents(cents - discount);
}

function toCents(price: string): bigint {
  const [intPart, fracPart = ""] = price.split(".");
  return BigInt(intPart) * 100n + BigInt(fracPart.padEnd(2, "0").slice(0, 2));
}

function fromCents(cents: bigint): string {
  const intPart = cents / 100n;
  const fracPart = (cents % 100n).toString().padStart(2, "0");
  return `${intPart}.${fracPart}`;
}

export type CampaignTargets = {
  productIds: string[];
  subtypeIds: string[];
  categoryIds: string[];
};

export type CampaignWithTargets = DiscountCampaign & {
  targets: CampaignTargets;
};

export type ProductForDiscount = {
  id: string;
  price: string | null;
  categoryId: string | null;
  subtypeId: string | null;
};

export type AppliedDiscount = {
  campaignId: string;
  campaignName: string;
  percentage: number;
  priceFinal: string;
};

/**
 * Winning campaign for a product: product > subtype > category.
 *
 * If a campaign directly targets a product, it wins and category campaigns are
 * not even considered, even if they offer higher discounts. This enables saying
 * "all mates 30%, but the imperial only 10%".
 *
 * At equal specificity, the higher percentage wins: precedence alone does not
 * resolve the tie and a deterministic rule is needed.
 */
export function resolveDiscount(
  product: ProductForDiscount,
  campaigns: CampaignWithTargets[],
  todayISO: string,
): AppliedDiscount | null {
  if (product.price === null) return null;

  const active = campaigns.filter(
    (c) => campaignState(c, todayISO) === "active",
  );

  const levels: Array<(c: CampaignWithTargets) => boolean> = [
    (c) => c.targets.productIds.includes(product.id),
    (c) =>
      product.subtypeId !== null &&
      c.targets.subtypeIds.includes(product.subtypeId),
    (c) =>
      product.categoryId !== null &&
      c.targets.categoryIds.includes(product.categoryId),
  ];

  for (const matcher of levels) {
    const candidates = active.filter(matcher);
    if (candidates.length === 0) continue;
    const winner = candidates.reduce((best, c) =>
      c.percentage > best.percentage ? c : best,
    );
    return {
      campaignId: winner.id,
      campaignName: winner.name,
      percentage: winner.percentage,
      priceFinal: discountedPrice(product.price, winner.percentage),
    };
  }
  return null;
}
