import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_USERS,
  alertRecipientsSchema,
  canActivateUser,
} from "./limits";
import {
  IMPORT_EXISTS_REASON,
  importLimitReason,
  planImportRows,
  type ParsedImportRow,
} from "./import";
import { MAX_ACTIVE_PRODUCTS } from "./stock";

describe("user limit (AC-USR-1)", () => {
  it("allows the 5th active user and rejects the 6th", () => {
    expect(canActivateUser(MAX_ACTIVE_USERS - 1)).toBe(true);
    expect(canActivateUser(MAX_ACTIVE_USERS)).toBe(false);
  });
});

describe("alertRecipientsSchema (3-recipient limit)", () => {
  it("accepts up to 3 valid emails and rejects a 4th", () => {
    expect(
      alertRecipientsSchema.safeParse(["a@x.uy", "b@x.uy", "c@x.uy"]).success,
    ).toBe(true);
    const four = alertRecipientsSchema.safeParse([
      "a@x.uy",
      "b@x.uy",
      "c@x.uy",
      "d@x.uy",
    ]);
    expect(four.success).toBe(false);
    if (!four.success) {
      expect(four.error.issues[0].message).toContain("3 destinatarios");
    }
  });

  it("rejects invalid emails", () => {
    expect(alertRecipientsSchema.safeParse(["no-es-email"]).success).toBe(false);
  });
});

describe("planImportRows (150-active limit + existing SKUs)", () => {
  const row = (line: number, sku: string): ParsedImportRow => ({
    line,
    sku,
    name: `Producto ${sku}`,
    stock: 1,
    minStock: 0,
  });

  it("rejects existing SKUs and rows beyond remaining capacity, in file order", () => {
    const plan = planImportRows(
      [row(2, "A"), row(3, "EXISTE"), row(4, "B"), row(5, "C")],
      new Set(["EXISTE"]),
      2, // only 2 slots left out of 150
      MAX_ACTIVE_PRODUCTS,
    );
    expect(plan.creatable.map((r) => r.sku)).toEqual(["A", "B"]);
    expect(plan.rejected).toEqual([
      { line: 3, sku: "EXISTE", reason: IMPORT_EXISTS_REASON },
      { line: 5, sku: "C", reason: importLimitReason(MAX_ACTIVE_PRODUCTS) },
    ]);
    expect(plan.rejected[1].reason).toContain("150");
  });

  it("with zero capacity everything new is rejected by the limit", () => {
    const plan = planImportRows(
      [row(2, "A")],
      new Set(),
      0,
      MAX_ACTIVE_PRODUCTS,
    );
    expect(plan.creatable).toHaveLength(0);
    expect(plan.rejected[0].reason).toContain("150");
  });
});
