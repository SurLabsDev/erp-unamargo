// NOTE: `listCampaignsWithTargets` below is imported by the anonymous,
// unauthenticated `src/app/api/public/v1/stock/route.ts`, even though this
// module lives under the authenticated `(app)` route group's folder. Keep
// every import in this file free of anything that depends on an authenticated
// session, or that public endpoint breaks at runtime.
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  discountCampaigns,
  discountTargets,
  productCategories,
  productSubtypes,
  products,
  stockMovements,
} from "@/lib/db/schema";
import { addDaysISO, diffDaysISO, zonedMidnightUtc } from "@/lib/domain/dates";
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
    // Product, then subtype, then category (same precedence order the detail
    // screen re-sorts by), and within a level by the columns that make up
    // that row's label, so two targets under the same level don't shuffle
    // between page loads. Ordering by the label text itself isn't practical
    // here: it's assembled in JS below, after the query runs.
    .orderBy(
      asc(sql`case
        when ${discountTargets.productId} is not null then 0
        when ${discountTargets.subtypeId} is not null then 1
        else 2
      end`),
      asc(
        sql`case when ${discountTargets.productId} is not null then ${products.sku} else ${productCategories.name} end`,
      ),
      asc(
        sql`case when ${discountTargets.productId} is not null then ${products.name} else ${productSubtypes.name} end`,
      ),
    );

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
 *
 * Ordered by `createdAt` then `id`: `resolveDiscount`'s tie-break keeps the
 * FIRST campaign in this array when two are tied on both specificity and
 * percentage, so without an explicit order "first" would be Postgres heap
 * order, which can change after any unrelated UPDATE to this table.
 */
export async function listCampaignsWithTargets(): Promise<
  CampaignWithTargets[]
> {
  const [campaigns, targets] = await Promise.all([
    db
      .select(campaignFields)
      .from(discountCampaigns)
      .orderBy(asc(discountCampaigns.createdAt), asc(discountCampaigns.id)),
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

export type EfectoCampana = {
  productosAlcanzados: number;
  unidadesDurante: number;
  unidadesAntes: number;
  diasDurante: number;
  diasAntes: number;
  enCurso: boolean;
  /** Unidades vendidas CON esta campana aplicada, y lo que se facturo. Solo
   *  cuenta lo que se registro como venta desde Dinero: una salida cargada a
   *  mano en Stock no sabe a que precio salio. */
  unidadesVendidas: number;
  facturado: string;
};

/**
 * Qué se movió mientras la campaña estuvo viva.
 *
 * **Lee esto antes de mirar el número.** El ERP no guarda a qué precio salió
 * cada unidad ni bajo qué campaña, así que la pregunta "cuántos vendí CON este
 * descuento" no se puede contestar con lo que hay anotado: contestarla pediría
 * anotar el precio y la campaña en cada salida de stock, que es un cambio de
 * esquema y de flujo de trabajo.
 *
 * Lo que sí se puede contestar, y es lo que devuelve esto: cuántas unidades
 * salieron de los productos alcanzados durante la campaña, contra las que
 * salieron en la misma cantidad de días justo antes. Sirve para ver si el
 * movimiento cambió; no prueba que lo haya causado la campaña, y una salida no
 * es necesariamente una venta -puede ser una rotura o un ajuste-.
 *
 * El período "antes" se toma de igual largo que el transcurrido, no que el
 * total: una campaña de 30 días mirada en el día 3 compararía 3 contra 30 y
 * mostraría un derrumbe inventado.
 */
export async function efectoDeCampana(
  campaignId: string,
  hoyISO: string,
  timezone: string,
): Promise<EfectoCampana> {
  const [campana] = await db
    .select({
      startsOn: discountCampaigns.startsOn,
      endsOn: discountCampaigns.endsOn,
    })
    .from(discountCampaigns)
    .where(eq(discountCampaigns.id, campaignId))
    .limit(1);
  if (!campana) {
    return {
      productosAlcanzados: 0,
      unidadesDurante: 0,
      unidadesAntes: 0,
      diasDurante: 0,
      diasAntes: 0,
      enCurso: false,
      unidadesVendidas: 0,
      facturado: "0",
    };
  }

  // Los objetivos se resuelven a productos concretos: una campaña puede
  // apuntar a un producto, a un subtipo o a una categoria entera.
  const alcanzados = await db
    .selectDistinct({ id: products.id })
    .from(products)
    .innerJoin(
      discountTargets,
      or(
        eq(discountTargets.productId, products.id),
        eq(discountTargets.subtypeId, products.subtypeId),
        eq(discountTargets.categoryId, products.categoryId),
      ),
    )
    .where(eq(discountTargets.campaignId, campaignId));

  const ids = alcanzados.map((p) => p.id);
  const desde = campana.startsOn;
  const hasta = campana.endsOn > hoyISO ? hoyISO : campana.endsOn;
  const diasDurante = desde > hasta ? 0 : diffDaysISO(desde, hasta) + 1;
  const hastaAntes = addDaysISO(desde, -1);
  const desdeAntes = addDaysISO(hastaAntes, -(diasDurante - 1));

  if (ids.length === 0 || diasDurante === 0) {
    return {
      productosAlcanzados: ids.length,
      unidadesDurante: 0,
      unidadesAntes: 0,
      diasDurante,
      diasAntes: diasDurante,
      enCurso: campana.endsOn >= hoyISO,
      unidadesVendidas: 0,
      facturado: "0",
    };
  }

  const salidas = async (d: string, h: string): Promise<number> => {
    const inicio = zonedMidnightUtc(d, timezone);
    const fin = zonedMidnightUtc(addDaysISO(h, 1), timezone);
    const [fila] = await db
      .select({ total: sql<number>`coalesce(sum(-${stockMovements.delta}), 0)::int` })
      .from(stockMovements)
      .where(
        and(
          inArray(stockMovements.productId, ids),
          eq(stockMovements.type, "out"),
          gte(stockMovements.createdAt, inicio),
          lt(stockMovements.createdAt, fin),
        ),
      );
    return fila?.total ?? 0;
  };

  const ventas = async () => {
    const [fila] = await db
      .select({
        unidades: sql<number>`coalesce(sum(-${stockMovements.delta}), 0)::int`,
        total: sql<string>`coalesce(sum(-${stockMovements.delta} * ${stockMovements.unitPrice}), 0)::text`,
      })
      .from(stockMovements)
      .where(eq(stockMovements.campaignId, campaignId));
    return { unidades: fila?.unidades ?? 0, total: fila?.total ?? "0" };
  };

  const [unidadesDurante, unidadesAntes, vendido] = await Promise.all([
    salidas(desde, hasta),
    salidas(desdeAntes, hastaAntes),
    ventas(),
  ]);

  return {
    unidadesVendidas: vendido.unidades,
    facturado: vendido.total,
    productosAlcanzados: ids.length,
    unidadesDurante,
    unidadesAntes,
    diasDurante,
    diasAntes: diasDurante,
    enCurso: campana.endsOn >= hoyISO,
  };
}
