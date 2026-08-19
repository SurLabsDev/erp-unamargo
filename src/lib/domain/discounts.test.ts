import { describe, expect, it } from "vitest";
import {
  campaignState,
  discountedPrice,
  type DiscountCampaign,
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
    const unDia = { ...base, startsOn: "2026-08-15", endsOn: "2026-08-15" };
    expect(campaignState(unDia, "2026-08-15")).toBe("active");
    expect(campaignState(unDia, "2026-08-16")).toBe("ended");
  });
});

describe("discountedPrice", () => {
  it("caso exacto sin redondeo", () => {
    expect(discountedPrice("1250.50", 20)).toBe("1000.40");
  });

  it("redondea medio-arriba al centavo", () => {
    // 99999 * 15 / 100 = 14999.85 centavos -> 15000 -> 84999
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
});
