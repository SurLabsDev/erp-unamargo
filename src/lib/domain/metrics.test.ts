import { describe, expect, it } from "vitest";
import {
  diasDeCobertura,
  reparto,
  salidasPorDia,
  valorInventarioCentavos,
  variacion,
} from "./metrics";

describe("salidasPorDia", () => {
  it("rellena con cero los dias sin movimiento", () => {
    const serie = salidasPorDia(
      [{ productoId: "a", cantidad: 3, fecha: "2026-08-03" }],
      "2026-08-01",
      "2026-08-04",
    );
    expect(serie).toEqual([
      { fecha: "2026-08-01", valor: 0 },
      { fecha: "2026-08-02", valor: 0 },
      { fecha: "2026-08-03", valor: 3 },
      { fecha: "2026-08-04", valor: 0 },
    ]);
  });

  it("suma varias salidas del mismo dia", () => {
    const serie = salidasPorDia(
      [
        { productoId: "a", cantidad: 2, fecha: "2026-08-01" },
        { productoId: "b", cantidad: 5, fecha: "2026-08-01" },
      ],
      "2026-08-01",
      "2026-08-01",
    );
    expect(serie).toEqual([{ fecha: "2026-08-01", valor: 7 }]);
  });
});

describe("diasDeCobertura", () => {
  it("divide el stock por el ritmo diario", () => {
    // 10 unidades, 15 salidas en 30 dias -> medio por dia -> 20 dias
    expect(diasDeCobertura(10, 15, 30)).toBe(20);
  });

  it("devuelve null sin salidas, en vez de un infinito que ordenaria mal", () => {
    expect(diasDeCobertura(10, 0, 30)).toBeNull();
  });

  it("da cero cuando no queda stock", () => {
    expect(diasDeCobertura(0, 30, 30)).toBe(0);
  });
});

describe("valorInventarioCentavos", () => {
  it("multiplica en centavos con BigInt, sin floats", () => {
    expect(
      valorInventarioCentavos([
        { stock: 3, precioCentavos: 199000n },
        { stock: 2, precioCentavos: 49000n },
      ]),
    ).toBe(695000n);
  });

  it("ignora el stock negativo y el precio ausente", () => {
    expect(
      valorInventarioCentavos([
        { stock: 5, precioCentavos: null },
        { stock: -2, precioCentavos: 100n },
      ]),
    ).toBe(0n);
  });
});

describe("variacion", () => {
  it("calcula el porcentaje", () => {
    expect(variacion(150, 100)).toBe(50);
    expect(variacion(50, 100)).toBe(-50);
  });

  it("devuelve null desde cero: no es infinito, es que no habia nada", () => {
    expect(variacion(10, 0)).toBeNull();
  });
});

describe("reparto", () => {
  it("agrega porcentaje y ordena de mayor a menor", () => {
    expect(
      reparto([
        { etiqueta: "b", valor: 25 },
        { etiqueta: "a", valor: 75 },
      ]),
    ).toEqual([
      { etiqueta: "a", valor: 75, porcentaje: 75 },
      { etiqueta: "b", valor: 25, porcentaje: 25 },
    ]);
  });

  it("no divide por cero cuando no hay nada", () => {
    expect(reparto([{ etiqueta: "a", valor: 0 }])[0].porcentaje).toBe(0);
  });
});
