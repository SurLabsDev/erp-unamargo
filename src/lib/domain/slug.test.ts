import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("baja a minusculas y une con guiones", () => {
    expect(slugify("De Calabaza")).toBe("de-calabaza");
  });

  it("saca acentos y enies", () => {
    expect(slugify("Bombilla de Alpaca Ñandú")).toBe(
      "bombilla-de-alpaca-nandu",
    );
  });

  it("colapsa separadores y no deja guiones en los bordes", () => {
    expect(slugify("  ¡Mate / Termo!  ")).toBe("mate-termo");
  });

  it("devuelve vacio cuando no queda nada utilizable", () => {
    expect(slugify("¿¡...!?")).toBe("");
  });

  it("recorta a 60 sin dejar un guion colgando", () => {
    const s = slugify("a".repeat(58) + " bb");
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("devuelve el base cuando esta libre", () => {
    expect(uniqueSlug("de-metal", new Set())).toBe("de-metal");
  });

  it("sufija cuando choca", () => {
    expect(uniqueSlug("de-metal", new Set(["de-metal"]))).toBe("de-metal-2");
    expect(uniqueSlug("de-metal", new Set(["de-metal", "de-metal-2"]))).toBe(
      "de-metal-3",
    );
  });
});
