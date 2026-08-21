import { describe, expect, it } from "vitest";
import {
  abreviarMonto,
  diasDeCobertura,
  escalaY,
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

describe("escalaY", () => {
  it("redondea el tope para arriba a un corte legible", () => {
    // El paso ideal seria 23,5; sube a 25 y el eje queda 0 / 25 / 50.
    const { tope, valores } = escalaY(47, 2);
    expect(tope).toBe(50);
    expect(valores).toEqual([0, 25, 50]);
  });

  it("no usa marcas fraccionarias: el eje cuenta unidades enteras", () => {
    for (const m of [3, 7, 9, 11, 23]) {
      for (const v of escalaY(m, 4).valores) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("usa pasos de 1, 2, 5 o 10 por decada", () => {
    expect(escalaY(15, 4).tope).toBe(20); // paso 5
    expect(escalaY(8, 4).tope).toBe(8); // paso 2
    expect(escalaY(400, 4).tope).toBe(400); // paso 100
  });

  it("nunca deja el maximo afuera del eje", () => {
    for (const m of [1, 3, 7, 13, 47, 99, 101, 512, 1234]) {
      expect(escalaY(m, 4).tope).toBeGreaterThanOrEqual(m);
    }
  });

  it("devuelve una escala usable con maximo cero, sin dividir por cero", () => {
    const { tope, valores } = escalaY(0, 4);
    expect(tope).toBe(4);
    expect(valores).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("abreviarMonto", () => {
  it("abrevia en miles y millones", () => {
    expect(abreviarMonto(83110)).toBe("83 mil");
    expect(abreviarMonto(2917467)).toBe("2,9 M");
    expect(abreviarMonto(12500000)).toBe("13 M");
  });

  it("deja los montos chicos como estan", () => {
    expect(abreviarMonto(0)).toBe("0");
    expect(abreviarMonto(950)).toBe("950");
  });

  it("conserva el signo", () => {
    expect(abreviarMonto(-4200)).toBe("-4 mil");
  });
});
