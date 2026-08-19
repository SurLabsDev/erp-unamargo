import { describe, expect, it } from "vitest";
import { fromCents, toCents } from "./cents";

describe("toCents", () => {
  it("convierte un valor positivo", () => {
    expect(toCents("12.34")).toBe(1234n);
  });

  it("convierte un multiplo exacto de 100", () => {
    expect(toCents("5.00")).toBe(500n);
  });

  it("convierte un valor sub-unidad (7 centavos)", () => {
    expect(toCents("0.07")).toBe(7n);
  });

  it("convierte un valor negativo", () => {
    expect(toCents("-12.34")).toBe(-1234n);
  });

  it("mantiene el signo entre -1 y 0 (caso que estaba roto)", () => {
    // BigInt("-0") colapsa a 0n: parsear el signo junto con la parte entera
    // pierde el signo si la parte entera es "0". El signo se separa antes.
    expect(toCents("-0.05")).toBe(-5n);
  });

  it("convierte cero sin signo", () => {
    expect(toCents("0.00")).toBe(0n);
    expect(toCents("-0.00")).toBe(0n);
  });

  it("rechaza mas de 2 decimales en vez de truncar en silencio", () => {
    expect(() => toCents("10.999")).toThrow();
    expect(() => toCents("-0.123")).toThrow();
  });
});

describe("fromCents", () => {
  it("formatea centavos positivos", () => {
    expect(fromCents(1234n)).toBe("12.34");
  });

  it("formatea centavos negativos sin romper el formato (no '-N.-N')", () => {
    expect(fromCents(-1234n)).toBe("-12.34");
    expect(fromCents(-801n)).toBe("-8.01");
  });

  it("cero nunca se renderiza como '-0.00'", () => {
    expect(fromCents(0n)).toBe("0.00");
  });
});

describe("round trip", () => {
  it("toCents(fromCents(x)) === x para valores positivos y negativos", () => {
    for (const cents of [0n, 1n, 100n, 1234n, -1234n, -5n, 999999n]) {
      expect(toCents(fromCents(cents))).toBe(cents);
    }
  });
});
