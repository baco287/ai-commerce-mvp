import { describe, expect, it } from "vitest";
import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { DEMO_OFFERS } from "@/lib/demo/suppliers";
import { EU_COUNTRIES, factValue, type SupplierQuote } from "../model";
import { scoutSuppliers } from "../scout";
import { DEMO_ADAPTERS, DEMO_QUERIES } from "./demo-suppliers";

async function allQuotes(): Promise<SupplierQuote[]> {
  const lists = await Promise.all(
    Object.values(DEMO_QUERIES).flatMap((q) => DEMO_ADAPTERS.map((a) => a.findQuotes(q))),
  );
  return lists.flat();
}

/** Prüfziffer nach GS1 für GTIN-13 */
const validGtin13 = (gtin: string) => {
  if (!/^\d{13}$/.test(gtin)) return false;
  const sum = [...gtin.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(gtin[12]);
};

describe("Demo-Daten des Supplier Scouts", () => {
  it("decken alle Dashboard-Produkte ab, mit gültigen fiktiven GTINs", () => {
    expect(Object.keys(DEMO_QUERIES).sort()).toEqual(DEMO_PRODUCTS.map((p) => p.id).sort());
    for (const q of Object.values(DEMO_QUERIES)) {
      expect(q.gtin && validGtin13(q.gtin), q.productId).toBe(true);
      // Präfix 200–299: nur für interne Zwecke, nie an echte Handelsprodukte vergeben
      expect(q.gtin?.startsWith("2"), q.productId).toBe(true);
    }
  });

  it("verlangen CE nur dort, wo die Compliance-Hinweise des Produkts es nennen", () => {
    const ce = Object.values(DEMO_QUERIES)
      .filter((q) => q.safety.ceRequired)
      .map((q) => q.productId);
    expect(ce).toEqual(["p-led"]);
  });

  it("übernehmen alle Kernzahlen 1:1 aus den Dashboard-Demodaten – keine abweichenden Werte", async () => {
    const quotes = await allQuotes();
    for (const o of DEMO_OFFERS) {
      const q = quotes.find((x) => x.productId === o.productId && x.supplierName === o.supplierName);
      expect(q, `${o.supplierName} / ${o.productId}`).toBeDefined();
      const days = factValue(q!.fulfillment.deliveryDays);
      expect(
        {
          unitPrice: factValue(q!.pricing.unitPrice),
          shippingCost: factValue(q!.pricing.shippingCost),
          importCost: factValue(q!.pricing.importCost),
          deliveryDaysMin: days?.min,
          deliveryDaysMax: days?.max,
          rating: factValue(q!.reliability.rating),
          stock: factValue(q!.fulfillment.stock),
          prepayment: factValue(q!.payment.terms)?.kind === "prepayment",
        },
        o.supplierName,
      ).toEqual({
        unitPrice: o.unitPrice,
        shippingCost: o.shippingCost,
        importCost: o.importCost,
        deliveryDaysMin: o.deliveryDaysMin,
        deliveryDaysMax: o.deliveryDaysMax,
        rating: o.rating,
        stock: o.stock,
        prepayment: o.paymentTerms === "vorkasse",
      });
    }
  });

  it("haben eindeutige IDs, echte Versandländer und sind alle als Demo gekennzeichnet", async () => {
    const quotes = await allQuotes();
    expect(new Set(quotes.map((q) => q.id)).size).toBe(quotes.length);
    for (const q of quotes) {
      expect(q.demo, q.id).toBe(true);
      const from = factValue(q.fulfillment.shipsFrom);
      expect(from === "CN" || EU_COUNTRIES.includes(from ?? ""), `${q.id}: ${from}`).toBe(true);
    }
  });

  it("zeigen je Produkt mindestens ein geeignetes und ein ausgeschlossenes Angebot", async () => {
    for (const q of Object.values(DEMO_QUERIES)) {
      const r = await scoutSuppliers(q, DEMO_ADAPTERS);
      expect(r.eligible.length, q.productId).toBeGreaterThan(0);
      expect(r.excluded.length, q.productId).toBeGreaterThan(0);
    }
  });
});
