import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatInteger,
  formatMoney,
  todayInTimeZone,
} from "./format";

describe("formatMoney", () => {
  it("formats es-UY with thousands dot and decimal comma", () => {
    expect(formatMoney("1234.5", "UYU")).toContain("1.234,50");
    expect(formatMoney(0, "UYU")).toContain("0,00");
  });

  it("uses the instance currency, never a hardcoded one", () => {
    expect(formatMoney(10, "USD")).toContain("10,00");
  });
});

describe("formatInteger", () => {
  it("formats with es-UY thousands separator", () => {
    expect(formatInteger(1234)).toBe("1.234");
  });
});

describe("formatDate", () => {
  it("renders DB dates as DD/MM/AAAA", () => {
    expect(formatDate("2026-08-12")).toBe("12/08/2026");
  });
});

describe("formatDateTime", () => {
  it("renders timestamps in the instance timezone", () => {
    const value = new Date("2026-08-12T18:05:00Z"); // 15:05 in Montevideo
    const formatted = formatDateTime(value, "America/Montevideo");
    expect(formatted).toContain("12/08/2026");
    expect(formatted).toContain("15:05");
  });
});

describe("todayInTimeZone", () => {
  it("computes 'today' in the instance timezone, not server UTC", () => {
    // 01:30 UTC on the 13th is still 22:30 on the 12th in Montevideo.
    const now = new Date("2026-08-13T01:30:00Z");
    expect(todayInTimeZone("America/Montevideo", now)).toBe("2026-08-12");
    expect(todayInTimeZone("UTC", now)).toBe("2026-08-13");
  });
});
