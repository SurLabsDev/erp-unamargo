import { describe, expect, it } from "vitest";
import {
  campaignState,
  discountedPrice,
  resolveDiscount,
  type CampaignWithTargets,
  type DiscountCampaign,
  type ProductForDiscount,
} from "./discounts";

const base: DiscountCampaign = {
  id: "c1",
  name: "Día del Padre",
  percentage: 20,
  startsOn: "2026-08-10",
  endsOn: "2026-08-16",
  isActive: true,
};

describe("campaignState", () => {
  it("pausada gana sobre cualquier fecha", () => {
    expect(campaignState({ ...base, isActive: false }, "2026-08-12")).toBe(
      "paused",
    );
    expect(campaignState({ ...base, isActive: false }, "2026-09-01")).toBe(
      "paused",
    );
  });

  it("programada antes del inicio", () => {
    expect(campaignState(base, "2026-08-09")).toBe("scheduled");
  });

  it("terminada despues del fin", () => {
    expect(campaignState(base, "2026-08-17")).toBe("ended");
  });

  it("activa dentro del rango, incluidos los bordes", () => {
    expect(campaignState(base, "2026-08-10")).toBe("active");
    expect(campaignState(base, "2026-08-13")).toBe("active");
    expect(campaignState(base, "2026-08-16")).toBe("active");
  });

  it("una campana de un solo dia esta activa ese dia", () => {
    const oneDay = { ...base, startsOn: "2026-08-15", endsOn: "2026-08-15" };
    expect(campaignState(oneDay, "2026-08-15")).toBe("active");
    expect(campaignState(oneDay, "2026-08-16")).toBe("ended");
  });
});

describe("discountedPrice", () => {
  it("caso exacto sin redondeo", () => {
    expect(discountedPrice("1250.50", 20)).toBe("1000.40");
  });

  it("redondea medio-arriba al centavo", () => {
    // 99999 * 15 / 100 = 14999.85 cents -> 15000 -> 84999
    expect(discountedPrice("999.99", 15)).toBe("849.99");
  });

  it("no usa floats: 0.1 + 0.2 no puede filtrarse", () => {
    expect(discountedPrice("0.30", 10)).toBe("0.27");
  });

  it("un descuento del 90 por ciento deja el 10 por ciento", () => {
    expect(discountedPrice("100.00", 90)).toBe("10.00");
  });

  it("precio con un solo decimal se normaliza a dos", () => {
    expect(discountedPrice("10.5", 10)).toBe("9.45");
  });

  // `products.price` has no `>= 0` CHECK, so a manual SQL edit could put a
  // negative price in the database. Unreachable through the app today, but
  // `fromCents` must not produce a malformed string like "-7.-21" if it ever
  // is: BigInt `%` keeps the dividend's sign, so the naive
  // `(cents % 100n).toString().padStart(2, "0")` puts the minus sign inside
  // the fractional part instead of in front of the whole string.
  it("centavos negativos dan un string decimal bien formado, no '-N.-N'", () => {
    expect(discountedPrice("-8.00", 10)).toBe("-7.21");
    expect(discountedPrice("-8.00", 10)).toMatch(/^-?\d+\.\d{2}$/);
  });
});

const TODAY = "2026-08-12";

function campaign(
  id: string,
  percentage: number,
  targets: Partial<CampaignWithTargets["targets"]>,
  extra: Partial<CampaignWithTargets> = {},
): CampaignWithTargets {
  return {
    id,
    name: `Campaign ${id}`,
    percentage,
    startsOn: "2026-08-10",
    endsOn: "2026-08-16",
    isActive: true,
    targets: {
      productIds: targets.productIds ?? [],
      subtypeIds: targets.subtypeIds ?? [],
      categoryIds: targets.categoryIds ?? [],
    },
    ...extra,
  };
}

const product: ProductForDiscount = {
  id: "p1",
  price: "1000.00",
  categoryId: "cat-mate",
  subtypeId: "sub-calabaza",
};

describe("resolveDiscount", () => {
  it("el producto le gana al subtipo y a la categoria", () => {
    const r = resolveDiscount(
      product,
      [
        campaign("cat", 50, { categoryIds: ["cat-mate"] }),
        campaign("sub", 40, { subtypeIds: ["sub-calabaza"] }),
        campaign("prod", 10, { productIds: ["p1"] }),
      ],
      TODAY,
    );
    expect(r?.percentage).toBe(10);
    expect(r?.campaignId).toBe("prod");
  });

  it("el subtipo le gana a la categoria", () => {
    const r = resolveDiscount(
      product,
      [
        campaign("cat", 50, { categoryIds: ["cat-mate"] }),
        campaign("sub", 40, { subtypeIds: ["sub-calabaza"] }),
      ],
      TODAY,
    );
    expect(r?.percentage).toBe(40);
  });

  it("a misma especificidad gana el porcentaje mayor", () => {
    const r = resolveDiscount(
      product,
      [
        campaign("a", 15, { categoryIds: ["cat-mate"] }),
        campaign("b", 25, { categoryIds: ["cat-mate"] }),
      ],
      TODAY,
    );
    expect(r?.percentage).toBe(25);
    expect(r?.campaignId).toBe("b");
  });

  it("a misma especificidad y mismo porcentaje gana la primera campana del arreglo, de forma deterministica", () => {
    const r = resolveDiscount(
      product,
      [
        campaign("a", 20, { categoryIds: ["cat-mate"] }),
        campaign("b", 20, { categoryIds: ["cat-mate"] }),
      ],
      TODAY,
    );
    expect(r?.percentage).toBe(20);
    expect(r?.campaignId).toBe("a");

    // El orden importa: invertir el arreglo invierte la ganadora, que es
    // justo por lo que el caller (`listCampaignsWithTargets`) tiene que
    // devolver las campanas siempre en el mismo orden.
    const reversed = resolveDiscount(
      product,
      [
        campaign("b", 20, { categoryIds: ["cat-mate"] }),
        campaign("a", 20, { categoryIds: ["cat-mate"] }),
      ],
      TODAY,
    );
    expect(reversed?.campaignId).toBe("b");
  });

  it("una campana pausada no aplica aunque las fechas coincidan", () => {
    const r = resolveDiscount(
      product,
      [campaign("a", 25, { categoryIds: ["cat-mate"] }, { isActive: false })],
      TODAY,
    );
    expect(r).toBeNull();
  });

  it("una campana terminada no aplica", () => {
    const r = resolveDiscount(
      product,
      [campaign("a", 25, { categoryIds: ["cat-mate"] })],
      "2026-08-17",
    );
    expect(r).toBeNull();
  });

  it("una campana programada todavia no aplica", () => {
    const r = resolveDiscount(
      product,
      [campaign("a", 25, { categoryIds: ["cat-mate"] })],
      "2026-08-09",
    );
    expect(r).toBeNull();
  });

  it("un producto sin precio no recibe descuento en ningun nivel", () => {
    const r = resolveDiscount(
      { ...product, price: null },
      [campaign("a", 25, { categoryIds: ["cat-mate"] })],
      TODAY,
    );
    expect(r).toBeNull();
  });

  it("un producto sin clasificar solo recibe descuentos apuntados a el", () => {
    const unclassified: ProductForDiscount = {
      id: "p9",
      price: "1000.00",
      categoryId: null,
      subtypeId: null,
    };
    expect(
      resolveDiscount(
        unclassified,
        [campaign("a", 25, { categoryIds: ["cat-mate"] })],
        TODAY,
      ),
    ).toBeNull();
  });

  it("un producto sin clasificar si recibe un descuento apuntado directamente a su id", () => {
    const unclassified: ProductForDiscount = {
      id: "p9",
      price: "1000.00",
      categoryId: null,
      subtypeId: null,
    };
    const r = resolveDiscount(
      unclassified,
      [campaign("a", 25, { productIds: ["p9"] })],
      TODAY,
    );
    expect(r?.percentage).toBe(25);
    expect(r?.campaignId).toBe("a");
  });

  it("devuelve el precio final ya calculado", () => {
    const r = resolveDiscount(
      product,
      [campaign("a", 20, { categoryIds: ["cat-mate"] })],
      TODAY,
    );
    expect(r?.priceFinal).toBe("800.00");
    expect(r?.campaignName).toBe("Campaign a");
  });
});
