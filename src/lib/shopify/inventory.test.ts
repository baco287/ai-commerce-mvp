import { describe, expect, it } from "vitest";
import { classifyStock, LOW_STOCK_THRESHOLD, summarizeInventory } from "./inventory";
import type { LocationQuantity, ShopifyProduct } from "./reconcile";

const loc = (id: string, available: number, onHand = available): LocationQuantity => ({
  locationId: id,
  locationName: `Lager ${id.toUpperCase()}`,
  locationActive: true,
  available,
  onHand,
  committed: onHand - available,
  incoming: 0,
});

function product(handle: string, variants: { sku: string; tracked?: boolean; locations?: LocationQuantity[]; read?: boolean }[], tags: string[] = []): ShopifyProduct {
  return {
    id: handle,
    title: handle,
    handle,
    status: "DRAFT",
    vendor: "",
    productType: "",
    tags,
    featuredMedia: null,
    variants: variants.map((v) => ({
      id: v.sku,
      title: v.sku,
      sku: v.sku,
      price: "1.00",
      inventoryPolicy: "DENY",
      selectedOptions: [],
      inventory:
        v.read === false
          ? undefined
          : {
              tracked: v.tracked ?? true,
              quantity: v.locations?.length ? v.locations.reduce((s, l) => s + l.available, 0) : null,
              unitCost: null,
              locations: v.locations ?? [],
              locationsTruncated: false,
            },
    })),
  };
}

describe("Bestandsstatus", () => {
  it("unterscheidet verfügbar, niedrig, ausverkauft, überverkauft und nicht verfolgt", () => {
    expect(classifyStock(true, LOW_STOCK_THRESHOLD + 1)).toBe("ok");
    expect(classifyStock(true, LOW_STOCK_THRESHOLD)).toBe("low");
    expect(classifyStock(true, 1)).toBe("low");
    expect(classifyStock(true, 0)).toBe("out");
    expect(classifyStock(true, null)).toBe("out");
    expect(classifyStock(true, -2)).toBe("oversold");
    expect(classifyStock(false, 100)).toBe("untracked");
  });
});

describe("Bestandsübersicht", () => {
  const products = [
    product("lampe", [
      { sku: "L-1", locations: [loc("a", 12, 14), loc("b", 3)] },
      { sku: "L-2", locations: [loc("a", 2)] },
      { sku: "L-3", tracked: false },
    ]),
    product("demo-led-lichtleiste", [{ sku: "DEMO-LED", locations: [loc("a", 0)] }], ["ai-commerce-demo"]),
    product("ohne-recht", [{ sku: "X-1", read: false }]),
  ];

  it("summiert Mengen je Standort", () => {
    const o = summarizeInventory(products);
    expect(o.source).toBe("shopify");
    expect(o.locations).toEqual([
      { id: "a", name: "Lager A", active: true, available: 14, onHand: 16, committed: 2, incoming: 0 },
      { id: "b", name: "Lager B", active: true, available: 3, onHand: 3, committed: 0, incoming: 0 },
    ]);
  });

  it("zählt Zustände und lässt nicht gelesene Varianten weg", () => {
    const o = summarizeInventory(products);
    expect(o.rows.map((r) => r.sku)).toEqual(["L-1", "L-2", "L-3", "DEMO-LED"]);
    expect(o.counts).toEqual({ ok: 1, low: 1, untracked: 1, out: 1, oversold: 0 });
  });

  it("kennzeichnet Demo-Produkte, deren Bestand 0 beabsichtigt ist", () => {
    const demo = summarizeInventory(products).rows.find((r) => r.sku === "DEMO-LED");
    expect(demo).toMatchObject({ demo: true, state: "out", available: 0 });
  });

  it("gibt jeder Zeile die Varianten-ID als eindeutigen Schlüssel – auch bei gleicher oder leerer SKU", () => {
    const p = product("shirt", [{ sku: "S" }, { sku: "M" }]);
    p.variants[0].sku = "";
    p.variants[1].sku = "";
    p.variants[1].id = "M-id";
    const ids = summarizeInventory([p]).rows.map((r) => r.variantId);
    expect(new Set(ids).size).toBe(2);
  });

  it("übernimmt die Zahl der Varianten ohne Bestandsdaten", () => {
    expect(summarizeInventory(products).missingVariants).toBe(0);
    expect(summarizeInventory(products, { missingVariants: 3 }).missingVariants).toBe(3);
  });

  it("meldet abgeschnittene Standortlisten", () => {
    const p = product("viele", [{ sku: "V-1", locations: [loc("a", 1)] }]);
    p.variants[0].inventory!.locationsTruncated = true;
    expect(summarizeInventory([p]).truncated).toBe(true);
    expect(summarizeInventory(products).truncated).toBe(false);
  });
});
