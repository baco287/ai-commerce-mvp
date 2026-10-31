import { describe, expect, it } from "vitest";
import { getActivities, getDashboardMetrics, getOrderRows, getProductAnalyses } from "./data";
import { DEMO_AGENTS } from "./demo/agents";
import { DEMO_PRODUCTS } from "./demo/products";

describe("Demo-Datenbasis", () => {
  it("enthält genau fünf Demo-Produkte mit je mindestens drei Angeboten", () => {
    const a = getProductAnalyses();
    expect(a).toHaveLength(5);
    for (const p of a) expect(p.offers.length).toBeGreaterThanOrEqual(3);
  });

  it("hat für jedes Produkt genau einen günstigsten geeigneten Lieferanten", () => {
    for (const p of getProductAnalyses()) expect(p.offers.filter((o) => o.isBest)).toHaveLength(1);
  });

  it("enthält alle sechs geforderten Agenten", () => {
    expect(DEMO_AGENTS.map((a) => a.name)).toEqual([
      "Market Research Agent",
      "Supplier Scout Agent",
      "Profit Calculator Agent",
      "Store Manager Agent",
      "Ads Manager Agent",
      "Order Fulfillment Agent",
    ]);
  });

  it("liefert eine reproduzierbare Simulation", () => {
    expect(getOrderRows().map((r) => r.order.id)).toEqual(getOrderRows().map((r) => r.order.id));
  });

  it("gibt im Demo-Modus keine einzige Bestellung zum Einkauf frei", () => {
    const m = getDashboardMetrics();
    expect(m.orders).toBeGreaterThan(0);
    expect(m.blockedPurchases).toBe(m.orders);
  });

  it("verteilt alle Bestellungen auf den Demo-Zeitraum", () => {
    const m = getDashboardMetrics();
    expect(m.daily).toHaveLength(14);
    expect(m.daily.reduce((s, d) => s + d.orders, 0)).toBe(m.orders);
  });

  it("nutzt nur bekannte Produkte in Bestellungen", () => {
    const ids = new Set(DEMO_PRODUCTS.map((p) => p.id));
    for (const r of getOrderRows()) expect(ids.has(r.order.productId)).toBe(true);
  });
});

describe("Demo-Daten widerspruchsfrei", () => {
  it("nennt im Aktivitäten-Feed dieselben Angebotszahlen wie der Supplier Scout", () => {
    const analyses = getProductAnalyses();
    const total = analyses.reduce((s, a) => s + a.offers.length, 0);
    const excluded = analyses.reduce((s, a) => s + a.offers.filter((o) => !o.eligible).length, 0);
    const scoutActivity = getActivities().find((a) => a.id === "a3");
    expect(scoutActivity?.message).toBe(`${total} Demo-Angebote bewertet, ${excluded} erfüllen die Mindestanforderungen nicht.`);
  });

  it("leitet die Kalkulationsbasis aus dem Scout ab (günstigster geeigneter)", () => {
    for (const a of getProductAnalyses()) {
      expect(a.best?.offer.id, a.product.id).toBe(a.scout.recommendations.cheapest?.quoteId);
      expect(a.offers.every((o) => o.offer.paymentTerms === "vorkasse"), a.product.id).toBe(true);
    }
  });
});
