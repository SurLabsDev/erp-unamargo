import { describe, expect, it } from "vitest";
import {
  amountSchema,
  buildCashCsv,
  cashCsvFilename,
  cashMovementSchema,
  computePeriodSummary,
  resolvePeriod,
  validateCashDate,
} from "./money";

describe("amountSchema", () => {
  it("accepts dot or comma decimals and normalizes to 2-decimal string", () => {
    expect(amountSchema.parse("1234.5")).toBe("1234.50");
    expect(amountSchema.parse("1234,56")).toBe("1234.56");
    expect(amountSchema.parse("850")).toBe("850.00");
  });

  it("rejects zero, negatives, empty and more than 2 decimals", () => {
    expect(amountSchema.safeParse("0").success).toBe(false);
    expect(amountSchema.safeParse("0,00").success).toBe(false);
    expect(amountSchema.safeParse("-5").success).toBe(false);
    expect(amountSchema.safeParse("").success).toBe(false);
    expect(amountSchema.safeParse("1.234,56").success).toBe(false); // thousands sep
    expect(amountSchema.safeParse("10.999").success).toBe(false);
  });
});

describe("cashMovementSchema", () => {
  it("validates a complete movement", () => {
    const parsed = cashMovementSchema.safeParse({
      date: "2026-08-10",
      kind: "expense",
      categoryId: "5c0f8f7e-3a44-4a05-9d5a-0c9a4c9f4b1a",
      concept: "Envíos DAC",
      amount: "850,00",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.amount).toBe("850.00");
  });

  it("rejects invalid calendar dates", () => {
    expect(
      cashMovementSchema.safeParse({
        date: "2026-02-30",
        kind: "income",
        categoryId: "5c0f8f7e-3a44-4a05-9d5a-0c9a4c9f4b1a",
        concept: "x",
        amount: "1",
      }).success,
    ).toBe(false);
  });
});

describe("validateCashDate", () => {
  const today = "2026-08-12";
  const initial = "2026-07-01";

  it("accepts today and past dates within range", () => {
    expect(validateCashDate("2026-08-12", today, initial)).toBeNull();
    expect(validateCashDate("2026-07-01", today, initial)).toBeNull();
  });

  it("rejects future dates and dates before the initial balance (AC-BAL-4)", () => {
    expect(validateCashDate("2026-08-13", today, initial)).toContain("futura");
    expect(validateCashDate("2026-06-30", today, initial)).toContain(
      "saldo inicial",
    );
  });
});

describe("resolvePeriod", () => {
  const today = "2026-08-12";

  it("defaults to the full current month", () => {
    expect(resolvePeriod({}, today)).toEqual({
      preset: "mes",
      fromISO: "2026-08-01",
      toISO: "2026-08-31",
    });
  });

  it("resolves previous month across year boundaries", () => {
    expect(resolvePeriod({ preset: "mes-anterior" }, "2026-01-15")).toEqual({
      preset: "mes-anterior",
      fromISO: "2025-12-01",
      toISO: "2025-12-31",
    });
  });

  it("resolves last 30 days inclusive of today", () => {
    expect(resolvePeriod({ preset: "30-dias" }, today)).toEqual({
      preset: "30-dias",
      fromISO: "2026-07-14",
      toISO: "2026-08-12",
    });
  });

  it("accepts valid custom ranges and falls back on invalid ones", () => {
    expect(
      resolvePeriod(
        { preset: "custom", fromISO: "2026-07-05", toISO: "2026-07-20" },
        today,
      ).preset,
    ).toBe("custom");
    // from > to and invalid dates fall back to current month
    expect(
      resolvePeriod(
        { preset: "custom", fromISO: "2026-07-20", toISO: "2026-07-05" },
        today,
      ).preset,
    ).toBe("mes");
    expect(
      resolvePeriod(
        { preset: "custom", fromISO: "2026-02-30", toISO: "2026-03-05" },
        today,
      ).preset,
    ).toBe("mes");
  });
});

describe("computePeriodSummary", () => {
  it("AC-BAL-1: initial 1000 (01/07), +500 on 05/07, -200 on 10/08 → August opens 1500, result -200, closes 1300", () => {
    const summary = computePeriodSummary("1000.00", {
      incomeBefore: "500.00",
      expenseBefore: "0.00",
      incomePeriod: "0.00",
      expensePeriod: "200.00",
    });
    expect(summary.openingBalance).toBe("1500.00");
    expect(summary.result).toBe("-200.00");
    expect(summary.closingBalance).toBe("1300.00");
  });

  it("AC-BAL-2: closing of one period equals opening of the next", () => {
    // July period for the same fixture
    const july = computePeriodSummary("1000.00", {
      incomeBefore: "0.00",
      expenseBefore: "0.00",
      incomePeriod: "500.00",
      expensePeriod: "0.00",
    });
    expect(july.closingBalance).toBe("1500.00"); // == August opening
  });

  it("is exact with cent arithmetic (no float drift)", () => {
    const summary = computePeriodSummary("0.10", {
      incomeBefore: "0.00",
      expenseBefore: "0.00",
      incomePeriod: "0.20",
      expensePeriod: "0.00",
    });
    expect(summary.closingBalance).toBe("0.30"); // 0.1 + 0.2 exact
  });
});

describe("buildCashCsv", () => {
  it("emits BOM, ';' separator, decimal comma and DD/MM/AAAA (AC-BAL-5)", () => {
    const csv = buildCashCsv([
      {
        dateISO: "2026-08-10",
        kind: "expense",
        categoryName: "Envíos",
        concept: "Envíos DAC",
        amount: "850.00",
        userName: "Operación Demo",
      },
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("fecha;tipo;categoria;concepto;monto;usuario");
    expect(csv).toContain("10/08/2026;Egreso;Envíos;Envíos DAC;850,00;Operación Demo");
  });

  it("neutralizes Excel formula injection in user-controlled fields", () => {
    const csv = buildCashCsv([
      {
        dateISO: "2026-08-01",
        kind: "expense",
        categoryName: "Gastos",
        concept: "=HYPERLINK(\"http://evil\")",
        amount: "1.00",
        userName: "@Ana",
      },
    ]);
    expect(csv).toContain(";\"'=HYPERLINK(\"\"http://evil\"\")\";");
    expect(csv).toContain(";'@Ana");
    // System-generated amounts stay numeric (no apostrophe)
    expect(csv).toContain(";1,00;");
  });

  it("escapes separators, quotes and newlines in free text", () => {
    const csv = buildCashCsv([
      {
        dateISO: "2026-08-01",
        kind: "income",
        categoryName: "Ventas",
        concept: 'Feria; puesto "central"\nsegunda línea',
        amount: "10.00",
        userName: "Ana",
      },
    ]);
    expect(csv).toContain('"Feria; puesto ""central""\nsegunda línea"');
  });
});

describe("cashCsvFilename", () => {
  it("builds balance_YYYYMMDD-YYYYMMDD.csv", () => {
    expect(
      cashCsvFilename({ preset: "mes", fromISO: "2026-08-01", toISO: "2026-08-31" }),
    ).toBe("balance_20260801-20260831.csv");
  });
});
