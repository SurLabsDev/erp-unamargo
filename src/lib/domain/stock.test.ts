import { describe, expect, it } from "vitest";
import {
  computeAdjustmentDelta,
  isLowStock,
  movementInputSchema,
  productCreateSchema,
  skuSchema,
} from "./stock";

const PRODUCT_ID = "5c0f8f7e-3a44-4a05-9d5a-0c9a4c9f4b1a";

describe("skuSchema", () => {
  it("normalizes to uppercase and trims", () => {
    expect(skuSchema.parse("  mate-imp-cue ")).toBe("MATE-IMP-CUE");
  });

  it("rejects invalid characters, empty and overlong values", () => {
    expect(skuSchema.safeParse("MATE CUE").success).toBe(false); // space
    expect(skuSchema.safeParse("MATÉ-1").success).toBe(false); // accent
    expect(skuSchema.safeParse("").success).toBe(false);
    expect(skuSchema.safeParse("A".repeat(41)).success).toBe(false);
    expect(skuSchema.safeParse("A".repeat(40)).success).toBe(true);
  });
});

describe("productCreateSchema", () => {
  it("accepts a valid product and defaults initialStock to 0", () => {
    const parsed = productCreateSchema.parse({
      sku: "mate-1",
      name: "Mate",
      minStock: "3",
    });
    expect(parsed).toMatchObject({ sku: "MATE-1", minStock: 3, initialStock: 0 });
  });

  it("rejects negative or non-integer stock values", () => {
    expect(
      productCreateSchema.safeParse({ sku: "A", name: "x", minStock: -1 })
        .success,
    ).toBe(false);
    expect(
      productCreateSchema.safeParse({
        sku: "A",
        name: "x",
        minStock: 1,
        initialStock: 2.5,
      }).success,
    ).toBe(false);
  });
});

describe("movementInputSchema", () => {
  it("requires quantity >= 1 for entrada/salida", () => {
    expect(
      movementInputSchema.safeParse({
        type: "salida",
        productId: PRODUCT_ID,
        quantity: 0,
      }).success,
    ).toBe(false);
    expect(
      movementInputSchema.safeParse({
        type: "entrada",
        productId: PRODUCT_ID,
        quantity: "3",
      }).success,
    ).toBe(true);
  });

  it("rejects empty/absent numeric fields instead of coercing them to 0", () => {
    // "" would coerce to 0 with plain z.coerce: an accidental "adjust to 0".
    const empty = movementInputSchema.safeParse({
      type: "ajuste",
      productId: PRODUCT_ID,
      countedStock: "",
      note: "Recuento",
    });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues[0].message).toContain("obligatorio");
    }
    expect(
      movementInputSchema.safeParse({
        type: "salida",
        productId: PRODUCT_ID,
        note: "x",
      }).success,
    ).toBe(false);
  });

  it("emits the Spanish note message even when note is absent", () => {
    const parsed = movementInputSchema.safeParse({
      type: "ajuste",
      productId: PRODUCT_ID,
      countedStock: 3,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain("nota");
    }
  });

  it("caps quantities at 1.000.000 (int4 protection)", () => {
    expect(
      movementInputSchema.safeParse({
        type: "entrada",
        productId: PRODUCT_ID,
        quantity: 3_000_000_000,
      }).success,
    ).toBe(false);
    expect(
      movementInputSchema.safeParse({
        type: "entrada",
        productId: PRODUCT_ID,
        quantity: 1_000_000,
      }).success,
    ).toBe(true);
  });

  it("requires a note for ajuste and allows counted stock 0", () => {
    expect(
      movementInputSchema.safeParse({
        type: "ajuste",
        productId: PRODUCT_ID,
        countedStock: 0,
        note: "",
      }).success,
    ).toBe(false);
    expect(
      movementInputSchema.safeParse({
        type: "ajuste",
        productId: PRODUCT_ID,
        countedStock: 0,
        note: "Recuento físico",
      }).success,
    ).toBe(true);
  });
});

describe("computeAdjustmentDelta", () => {
  it("derives the signed delta from counted stock (AC-STK-2)", () => {
    expect(computeAdjustmentDelta(18, 16)).toBe(-2);
    expect(computeAdjustmentDelta(0, 5)).toBe(5);
    expect(computeAdjustmentDelta(7, 7)).toBe(0); // "sin cambios"
  });
});

describe("isLowStock", () => {
  it("flags active products at or below their minimum", () => {
    expect(isLowStock({ isActive: true, currentStock: 5, minStock: 5 })).toBe(true);
    expect(isLowStock({ isActive: true, currentStock: 6, minStock: 5 })).toBe(false);
  });

  it("min_stock = 0 means no control: never low, even at 0", () => {
    expect(isLowStock({ isActive: true, currentStock: 0, minStock: 0 })).toBe(false);
  });

  it("inactive products are never flagged", () => {
    expect(isLowStock({ isActive: false, currentStock: 0, minStock: 5 })).toBe(false);
  });
});
