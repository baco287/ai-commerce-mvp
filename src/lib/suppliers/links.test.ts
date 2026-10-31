import { describe, expect, it } from "vitest";
import { getProductAnalyses, getSupplierLinks } from "@/lib/data";
import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { DEMO_LISTINGS } from "@/lib/shopify/listings";
import { DEMO_QUERIES } from "./demo/demo-suppliers";
import { buildSupplierLinks } from "./links";

describe("Kopplung Produkt ↔ Scout ↔ Shopify", () => {
  it("koppelt alle Demo-Produkte vollständig (GTIN, Handle, SKUs, Angebots-ID der Kalkulationsbasis)", () => {
    const links = getSupplierLinks();
    expect(links).toHaveLength(5);
    for (const l of links) {
      expect(l.problems, l.productId).toEqual([]);
      expect(l.gtin).toMatch(/^2\d{12}$/);
      expect(l.shopifyHandle).toMatch(/^demo-/);
      expect(l.shopifySkus.length).toBeGreaterThan(0);
    }
    const analyses = new Map(getProductAnalyses().map((a) => [a.product.id, a]));
    for (const l of links) expect(l.supplierOfferId).toBe(analyses.get(l.productId)?.best?.offer.id);
  });

  it("weist Varianten ohne Lieferanten-Artikelnummer als offene Lücke aus", () => {
    const stand = getSupplierLinks().find((l) => l.productId === "p-stand")!;
    expect(stand.variantsWithoutSupplierSku).toEqual(stand.shopifySkus);
    const mapped = buildSupplierLinks({
      products: DEMO_PRODUCTS,
      queries: DEMO_QUERIES,
      listings: DEMO_LISTINGS,
      calculationBasis: {},
      supplierSkuByShopifySku: Object.fromEntries(stand.shopifySkus.map((s) => [s, `LIEF-${s}`])),
    }).find((l) => l.productId === "p-stand")!;
    expect(mapped.variantsWithoutSupplierSku).toEqual([]);
  });

  it("meldet fehlende Suchanfrage, fehlendes Listing, fehlende Kalkulationsbasis und doppelte SKUs", () => {
    const [led] = DEMO_LISTINGS;
    const links = buildSupplierLinks({
      products: DEMO_PRODUCTS.slice(0, 2),
      queries: { "p-led": DEMO_QUERIES["p-led"] },
      listings: [led, { ...led, productId: "p-stand", handle: "demo-x" }],
      calculationBasis: { "p-led": "demo-eu:eurolight:p-led" },
    });
    expect(links[0].problems).toEqual([expect.stringMatching(/SKU DEMO-LED-001 ist mehrfach/)]);
    expect(links[1].problems).toEqual(
      expect.arrayContaining([expect.stringMatching(/Keine Lieferanten-Suchanfrage/), expect.stringMatching(/Kein geeigneter Lieferant/)]),
    );
  });
});
