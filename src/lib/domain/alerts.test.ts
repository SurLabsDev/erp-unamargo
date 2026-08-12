import { describe, expect, it } from "vitest";
import { buildAlertEmail, decideAlertTransition } from "./alerts";

const armed = null;
const triggered = new Date("2026-08-01T12:00:00Z");

describe("decideAlertTransition", () => {
  it("AC-ALR-1: crossing the minimum while armed triggers; further drops do not", () => {
    expect(
      decideAlertTransition({ isActive: true, currentStock: 5, minStock: 5, lowStockAlertedAt: armed }),
    ).toBe("trigger");
    expect(
      decideAlertTransition({ isActive: true, currentStock: 3, minStock: 5, lowStockAlertedAt: triggered }),
    ).toBe("none"); // still in breach, already notified
  });

  it("AC-ALR-2: restocking strictly above the minimum rearms silently", () => {
    expect(
      decideAlertTransition({ isActive: true, currentStock: 6, minStock: 5, lowStockAlertedAt: triggered }),
    ).toBe("rearm");
    // equal to min is still in breach: no rearm
    expect(
      decideAlertTransition({ isActive: true, currentStock: 5, minStock: 5, lowStockAlertedAt: triggered }),
    ).toBe("none");
  });

  it("AC-ALR-3: raising the minimum above current stock triggers", () => {
    expect(
      decideAlertTransition({ isActive: true, currentStock: 8, minStock: 10, lowStockAlertedAt: armed }),
    ).toBe("trigger");
  });

  it("AC-ALR-4: min_stock = 0 means no control (and clears stale state)", () => {
    expect(
      decideAlertTransition({ isActive: true, currentStock: 0, minStock: 0, lowStockAlertedAt: armed }),
    ).toBe("none");
    expect(
      decideAlertTransition({ isActive: true, currentStock: 0, minStock: 0, lowStockAlertedAt: triggered }),
    ).toBe("rearm");
  });

  it("inactive products never trigger but keep their triggered state", () => {
    expect(
      decideAlertTransition({ isActive: false, currentStock: 1, minStock: 5, lowStockAlertedAt: armed }),
    ).toBe("none");
    expect(
      decideAlertTransition({ isActive: false, currentStock: 1, minStock: 5, lowStockAlertedAt: triggered }),
    ).toBe("none");
  });
});

describe("buildAlertEmail", () => {
  const base = { companyName: "Unamargo", appUrl: "https://erp.test" };

  it("single product: contractual subject and full body", () => {
    const email = buildAlertEmail({
      ...base,
      products: [
        { sku: "MATE-1", name: "Mate campero", currentStock: 2, minStock: 4, productId: "abc" },
      ],
    });
    expect(email.subject).toBe("[Unamargo] Stock bajo: MATE-1 — Mate campero");
    expect(email.text).toContain("Stock actual: 2");
    expect(email.text).toContain("Stock mínimo: 4");
    expect(email.text).toContain("https://erp.test/stock/abc");
  });

  it("batch: ONE summary email listing every product (§8.6)", () => {
    const email = buildAlertEmail({
      ...base,
      products: [
        { sku: "A", name: "Uno", currentStock: 0, minStock: 2, productId: "1" },
        { sku: "B", name: "Dos", currentStock: 1, minStock: 3, productId: "2" },
      ],
    });
    expect(email.subject).toBe("[Unamargo] Stock bajo: 2 productos");
    expect(email.text).toContain("- A — Uno: stock 0 (mínimo 2)");
    expect(email.text).toContain("- B — Dos: stock 1 (mínimo 3)");
  });
});
