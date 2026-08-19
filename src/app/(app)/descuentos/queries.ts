import { asc, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  discountCampaigns,
  discountTargets,
  productCategories,
  productSubtypes,
  products,
} from "@/lib/db/schema";
import {
  campaignState,
  type CampaignState,
  type CampaignWithTargets,
} from "@/lib/domain/discounts";
import { todayInTimeZone } from "@/lib/format";
import { getSettings } from "@/lib/settings";

// Exactly the shape `campaignState` (tested in the domain module) expects, so
// every query below reuses it instead of re-deriving state in SQL.
const campaignFields = {
  id: discountCampaigns.id,
  name: discountCampaigns.name,
  percentage: discountCampaigns.percentage,
  startsOn: discountCampaigns.startsOn,
  endsOn: discountCampaigns.endsOn,
  isActive: discountCampaigns.isActive,
};

export type CampaignListRow = {
  id: string;
  name: string;
  percentage: number;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
  state: CampaignState;
  targetCount: number;
};

/**
 * All campaigns, paused and ended included: this is the admin list, not the
 * pricing engine, so every row is shown with its derived `state` badge.
 */
export async function listCampaigns(
  todayISO: string,
): Promise<CampaignListRow[]> {
  const rows = await db
    .select({
      ...campaignFields,
      // Table name spelled out literally, NOT interpolated as
      // `${discountCampaigns.id}`: discount_targets has its own "id" column,
      // which would silently shadow the interpolated one and make every
      // count come back as 0 (see the identical note on `hasMovements` in
      // stock/queries.ts).
      targetCount: sql<number>`(select count(*)::int from discount_targets dt where dt.campaign_id = discount_campaigns.id)`,
    })
    .from(discountCampaigns)
    .orderBy(desc(discountCampaigns.createdAt));

  return rows.map((row) => ({ ...row, state: campaignState(row, todayISO) }));
}

export type TargetRow = {
  id: string;
  level: "product" | "subtype" | "category";
  targetId: string;
  label: string;
};

export type CampaignDetail = CampaignListRow & { targets: TargetRow[] };

/**
 * One campaign with its targets labelled for display. Unlike `listCampaigns`,
 * this does not take `todayISO`: a detail fetch is a single row, so reading
 * the instance timezone once via `getSettings()` is cheap enough to do here.
 */
export async function getCampaign(
  id: string,
): Promise<CampaignDetail | undefined> {
  const [campaign] = await db
    .select(campaignFields)
    .from(discountCampaigns)
    .where(eq(discountCampaigns.id, id))
    .limit(1);
  if (!campaign) return undefined;

  const rows = await db
    .select({
      id: discountTargets.id,
      productId: discountTargets.productId,
      subtypeId: discountTargets.subtypeId,
      categoryId: discountTargets.categoryId,
      productSku: products.sku,
      productName: products.name,
      subtypeName: productSubtypes.name,
      categoryName: productCategories.name,
    })
    .from(discountTargets)
    .leftJoin(products, eq(discountTargets.productId, products.id))
    .leftJoin(
      productSubtypes,
      eq(discountTargets.subtypeId, productSubtypes.id),
    )
    // A subtype-level target has discountTargets.categoryId = null, so the
    // category name for its label has to come through the subtype's OWN
    // categoryId, not the target's (that column matches only category-level
    // targets). Either side is null except for the row it applies to, so the
    // two conditions never both match the same joined row.
    .leftJoin(
      productCategories,
      or(
        eq(discountTargets.categoryId, productCategories.id),
        eq(productSubtypes.categoryId, productCategories.id),
      ),
    )
    .where(eq(discountTargets.campaignId, id))
    .orderBy(asc(discountTargets.id));

  const targets: TargetRow[] = rows.map((row): TargetRow => {
    if (row.productId !== null) {
      return {
        id: row.id,
        level: "product",
        targetId: row.productId,
        label: `${row.productSku} — ${row.productName}`,
      };
    }
    if (row.subtypeId !== null) {
      return {
        id: row.id,
        level: "subtype",
        targetId: row.subtypeId,
        label: `${row.categoryName} — ${row.subtypeName}`,
      };
    }
    // `discount_targets_exactly_one_check` guarantees categoryId is set here:
    // productId and subtypeId were both ruled out above.
    return {
      id: row.id,
      level: "category",
      targetId: row.categoryId as string,
      label: row.categoryName as string,
    };
  });

  const settings = await getSettings();
  const today = todayInTimeZone(settings.timezone);

  return {
    ...campaign,
    state: campaignState(campaign, today),
    targetCount: targets.length,
    targets,
  };
}

/**
 * Every campaign with its targets grouped by level, for `resolveDiscount`.
 * Paused and ended campaigns are included ON PURPOSE: they are a few dozen
 * rows at most, and filtering by vigencia here would duplicate the state
 * rule that `campaignState` already owns and already has tests for.
 */
export async function listCampaignsWithTargets(): Promise<
  CampaignWithTargets[]
> {
  const [campaigns, targets] = await Promise.all([
    db.select(campaignFields).from(discountCampaigns),
    db
      .select({
        campaignId: discountTargets.campaignId,
        productId: discountTargets.productId,
        subtypeId: discountTargets.subtypeId,
        categoryId: discountTargets.categoryId,
      })
      .from(discountTargets),
  ]);

  return campaigns.map((campaign) => {
    const rows = targets.filter((t) => t.campaignId === campaign.id);
    return {
      ...campaign,
      targets: {
        productIds: rows.flatMap((t) => (t.productId ? [t.productId] : [])),
        subtypeIds: rows.flatMap((t) => (t.subtypeId ? [t.subtypeId] : [])),
        categoryIds: rows.flatMap((t) =>
          t.categoryId ? [t.categoryId] : [],
        ),
      },
    };
  });
}

/** How many campaigns `campaignState` currently derives as "active". */
export async function countActiveCampaigns(todayISO: string): Promise<number> {
  const rows = await db.select(campaignFields).from(discountCampaigns);
  return rows.filter((row) => campaignState(row, todayISO) === "active")
    .length;
}
