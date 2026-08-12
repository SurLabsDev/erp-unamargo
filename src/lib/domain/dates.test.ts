import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  isValidISODate,
  zonedDateRangeToUtc,
  zonedMidnightUtc,
} from "./dates";

describe("isValidISODate", () => {
  it("accepts well-formed calendar dates and rejects impossible ones", () => {
    expect(isValidISODate("2026-02-28")).toBe(true);
    expect(isValidISODate("2026-02-30")).toBe(false); // passes regex, invalid
    expect(isValidISODate("2026-13-45")).toBe(false);
    expect(isValidISODate("12/08/2026")).toBe(false);
  });
});

describe("addDaysISO", () => {
  it("crosses month and year boundaries", () => {
    expect(addDaysISO("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("zonedMidnightUtc", () => {
  it("maps Montevideo midnight (UTC-3) to 03:00 UTC", () => {
    expect(
      zonedMidnightUtc("2026-08-12", "America/Montevideo").toISOString(),
    ).toBe("2026-08-12T03:00:00.000Z");
  });

  it("is identity for UTC", () => {
    expect(zonedMidnightUtc("2026-08-12", "UTC").toISOString()).toBe(
      "2026-08-12T00:00:00.000Z",
    );
  });

  it("rejects malformed and calendar-invalid dates", () => {
    expect(() => zonedMidnightUtc("12/08/2026", "UTC")).toThrow();
    expect(() => zonedMidnightUtc("2026-02-30", "UTC")).toThrow();
  });
});

describe("zonedDateRangeToUtc", () => {
  it("builds [inclusive from, exclusive next-day to] in the instance tz", () => {
    const range = zonedDateRangeToUtc(
      "2026-08-01",
      "2026-08-31",
      "America/Montevideo",
    );
    expect(range.from?.toISOString()).toBe("2026-08-01T03:00:00.000Z");
    // exclusive upper bound: midnight of Sep 1 in Montevideo
    expect(range.to?.toISOString()).toBe("2026-09-01T03:00:00.000Z");
  });

  it("supports open-ended ranges", () => {
    expect(zonedDateRangeToUtc(undefined, undefined, "UTC")).toEqual({
      from: undefined,
      to: undefined,
    });
  });
});
