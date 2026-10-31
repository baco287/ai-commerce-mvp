import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateMargin } from "./calc/pricing";
import { getDashboardMetrics, getOrderRows, getProductAnalyses, getSupplierScoutReports } from "./data";
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

describe("Supplier Scout im Dashboard", () => {
  it("liefert für jedes Demo-Produkt einen Bericht mit drei Empfehlungen, die nichts freigeben", async () => {
    const items = await getSupplierScoutReports();
    expect(items.map((i) => i.product.id)).toEqual(DEMO_PRODUCTS.map((p) => p.id));
    for (const { product, report } of items) {
      expect(report, product.id).not.toBeNull();
      expect(report!.containsDemoData, product.id).toBe(true);
      for (const rec of Object.values(report!.recommendations)) {
        expect(rec, product.id).toMatchObject({ approval: "none", demo: true });
      }
    }
  });

  it("rechnet den Deckungsbeitrag für jedes geeignete Angebot mit dem Zielpreis", async () => {
    for (const { product, report, margins } of await getSupplierScoutReports()) {
      expect(Object.keys(margins).sort(), product.id).toEqual(report!.eligible.map((e) => e.quote.id).sort());
      for (const e of report!.eligible) {
        expect(margins[e.quote.id], e.quote.id).toEqual(calculateMargin(product.targetPriceGross, e.cost!.perUnit));
      }
      // Ausgeschlossene Angebote bekommen keine Marge – sie sollen nicht wie eine Option wirken
      for (const e of report!.excluded) expect(margins[e.quote.id], e.quote.id).toBeUndefined();
    }
  });

  it("stimmt beim günstigsten geeigneten Lieferanten mit der bisherigen Produktanalyse überein", async () => {
    const legacy = new Map(getProductAnalyses().map((a) => [a.product.id, a.best]));
    for (const { product, report } of await getSupplierScoutReports()) {
      const cheapest = report!.recommendations.cheapest;
      expect(cheapest?.supplierName, product.id).toBe(legacy.get(product.id)?.offer.supplierName);
      expect(cheapest?.perUnit, product.id).toBe(legacy.get(product.id)?.landedCost);
    }
  });

  it("ist reproduzierbar", async () => {
    expect(await getSupplierScoutReports()).toEqual(await getSupplierScoutReports());
  });

  it("ruft aus Seiten, Komponenten und dem Scout-Datenzugriff nie die Einkaufssperre auf", () => {
    const src = join(__dirname, "..");
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
      );
    const ui = [...files(join(src, "app")), ...files(join(src, "components"))];
    expect(ui.length).toBeGreaterThan(0);
    for (const f of ui) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\bevaluateAutoPurchase\b|\btoPurchaseGuardTerms\b|purchase-bridge|guards\/purchase/);
    }
    // data.ts nutzt die Einkaufssperre nur für die simulierte Bestellliste, nie mit Scout-Empfehlungen
    expect(readFileSync(join(src, "lib", "data.ts"), "utf8")).not.toMatch(/\btoPurchaseGuardTerms\b|purchase-bridge/);
  });
});
