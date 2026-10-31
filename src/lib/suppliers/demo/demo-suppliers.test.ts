import { describe, expect, it } from "vitest";
import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { EU_COUNTRIES, factValue, type ProductQuery } from "../model";
import { DEMO_QUERIES, DEMO_SUPPLIER_QUOTES } from "./demo-suppliers";

const queries: ProductQuery[] = Object.values(DEMO_QUERIES);

/** Prüfziffer nach GS1 für GTIN-13 */
const validGtin13 = (gtin: string) => {
  if (!/^\d{13}$/.test(gtin)) return false;
  const sum = [...gtin.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(gtin[12]);
};

describe("Demo-Daten des Supplier Scouts", () => {
  it("haben gültige fiktive GTINs aus dem internen Präfixbereich", () => {
    for (const q of queries) {
      expect(q.gtin && validGtin13(q.gtin), q.productId).toBe(true);
      // Präfix 200–299: nur für interne Zwecke, nie an echte Handelsprodukte vergeben
      expect(q.gtin?.startsWith("2"), q.productId).toBe(true);
    }
  });

  it("verlangen CE genau dort, wo die Compliance-Hinweise des Produkts es nennen", () => {
    for (const p of DEMO_PRODUCTS) {
      const q = queries.find((x) => x.productId === p.id);
      expect(q?.safety.ceRequired, p.id).toBe(p.complianceNotes.some((n) => /\bCE\b/.test(n)));
    }
  });

  it("haben eindeutige IDs, echte Versandländer und sind alle als Demo gekennzeichnet", () => {
    expect(new Set(DEMO_SUPPLIER_QUOTES.map((q) => q.id)).size).toBe(DEMO_SUPPLIER_QUOTES.length);
    for (const q of DEMO_SUPPLIER_QUOTES) {
      expect(q.demo, q.id).toBe(true);
      const from = factValue(q.fulfillment.shipsFrom);
      expect(from === "CN" || EU_COUNTRIES.includes(from ?? ""), `${q.id}: ${from}`).toBe(true);
    }
  });
});
