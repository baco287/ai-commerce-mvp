// Entwurfseingabe (Paket E): ein Entwurf über buildDraftInput, Demo-Weg nur als Erweiterung, Guard-Regeln für echte
// Entwürfe. Alle Daten sind synthetisch (nur Test). Kein Netzwerk, kein Shopify.

import { describe, expect, it } from "vitest";
import { getProductAnalyses, type ProductAnalysis } from "@/lib/data";
import { toShopifyCsv } from "./csv";
import { demoMarkersOf, productInputViolations } from "./guards";
import { DEMO_LISTINGS } from "./listings";
import { evaluatePipeline } from "./pipeline";
import { buildDraftInput, buildProductSetInput, PUBLIC_DRAFT_METAFIELDS, type DraftSpec, type ProductSetInput } from "./product-input";

/** NUR TEST: echter Entwurf eines fiktiven Produkts. */
const spec = (o: Partial<DraftSpec> = {}): DraftSpec => ({
  demo: false,
  productRef: "catalog:kabelkanal",
  listing: { handle: "kabelkanal", title: "Kabelkanal selbstklebend", descriptionHtml: "<p>Kabelkanal.</p>", productType: "Kabelmanagement", categoryTag: "buero" },
  variants: [{ shopSku: "KK-1", priceGross: 24.9 }],
  images: [{ url: "https://bilder.example/kabelkanal.jpg", alt: "Kabelkanal" }],
  vendor: "Kabelfix",
  ...o,
});

const real = (): ProductSetInput => buildDraftInput(spec());

describe("buildDraftInput", () => {
  it("baut einen echten Entwurf ohne Kosten, nur mit öffentlichen Metafeldern und ohne Demo-Kennzeichen", () => {
    const p = real();
    expect(p.status).toBe("DRAFT");
    expect(p.variants[0]).toEqual({
      optionValues: [{ optionName: "Title", name: "Default Title" }],
      price: "24.90",
      inventoryPolicy: "DENY",
      inventoryItem: { sku: "KK-1", tracked: true, requiresShipping: true },
      taxable: true,
    });
    expect(p.metafields.map((m) => m.key)).toEqual([...PUBLIC_DRAFT_METAFIELDS]);
    expect(p.tags).toEqual(["ai-commerce-pipeline", "buero"]);
    expect(p.vendor).toBe("Kabelfix");
    expect(demoMarkersOf(p)).toEqual({ demo: false, mixed: false });
    expect(productInputViolations(p)).toEqual([]);
  });

  it("hängt den GPSR-Block an die Beschreibung", () => {
    expect(buildDraftInput(spec({ gpsrHtml: "<h3>Produktsicherheit</h3>" })).descriptionHtml).toBe("<p>Kabelkanal.</p><h3>Produktsicherheit</h3>");
  });
});

describe("Guard-Regeln für echte Entwürfe", () => {
  it("verbietet interne Metafelder (z. B. supplier_stock) und Einkaufskosten", () => {
    const p = real();
    const bad: ProductSetInput = {
      ...p,
      variants: p.variants.map((v) => ({ ...v, inventoryItem: { ...v.inventoryItem, cost: "4.00" } })),
      metafields: [...p.metafields, { namespace: "ai_commerce", key: "supplier_stock", type: "number_integer", value: "300" }],
    };
    const reasons = productInputViolations(bad).join(" ");
    expect(reasons).toMatch(/Metafeld supplier_stock ist nicht für echte Entwürfe freigegeben/);
    expect(reasons).toMatch(/Einkaufskosten \(cost\)/);
  });

  it("meldet gemischte Demo-Kennzeichen (Demo-Tag ohne Demo-Handle) und prüft wie einen echten Entwurf", () => {
    const p = real();
    const mixed = { ...p, tags: ["ai-commerce-demo", ...p.tags] };
    expect(demoMarkersOf(mixed)).toEqual({ demo: false, mixed: true });
    const reasons = productInputViolations(mixed).join(" ");
    expect(reasons).toMatch(/Gemischte Demo-Kennzeichen/);
    expect(reasons).toMatch(/Demo-Kennzeichen in den Tags/);
  });

  it("verbietet Demo-Kennzeichen in Titel, Handle, SKU, Produkttyp und Beschreibung eines echten Entwurfs", () => {
    const p = real();
    const reasons = productInputViolations({
      ...p,
      title: "Demo Kabelkanal",
      handle: "kabelkanal-demo",
      productType: "Demo-Zubehör",
      descriptionHtml: "<p><strong>Demo-Produkt – nicht zum Verkauf freigegeben.</strong></p>",
    }).join(" ");
    for (const where of ["Titel", "Handle", "Produkttyp", "Beschreibung"]) expect(reasons).toMatch(new RegExp(where));
    const sku = productInputViolations({ ...p, variants: p.variants.map((v) => ({ ...v, inventoryItem: { ...v.inventoryItem, sku: "DEMO-KK-1" } })) }).join(" ");
    expect(sku).toMatch(/Gemischte Demo-Kennzeichen/);
    expect(sku).toMatch(/Demo-Kennzeichen in der SKU/);
  });

  it("lässt vollständig gekennzeichnete Demo-Eingaben mit Kosten und Kalkulations-Metafeldern zu", () => {
    const analyses = getProductAnalyses();
    for (const listing of DEMO_LISTINGS) {
      const p = buildProductSetInput(analyses.find((a) => a.product.id === listing.productId)!, listing);
      expect(demoMarkersOf(p)).toEqual({ demo: true, mixed: false });
      expect(productInputViolations(p)).toEqual([]);
    }
  });
});

describe("Demo-Weg buildProductSetInput", () => {
  const withRealBest = (a: ProductAnalysis): ProductAnalysis => ({
    ...a,
    scout: { ...a.scout, eligible: a.scout.eligible.map((e) => (e.quote.id === a.best!.offer.id ? { ...e, quote: { ...e.quote, demo: false } } : e)) },
  });

  it("wirft, wenn die Kalkulationsbasis ein echtes Preislisten-Angebot ist – Konditionen gelangen nie über den Demo-Weg nach Shopify", () => {
    const a = getProductAnalyses().find((x) => x.product.id === "p-led")!;
    const listing = DEMO_LISTINGS.find((l) => l.productId === "p-led")!;
    expect(() => buildProductSetInput(withRealBest(a), listing)).toThrow(/kein Demo-Angebot/);
    // Die Dashboard-Vorschau stürzt nicht ab: Entwurfsstufe gesperrt, kein Entwurf
    const pipeline = evaluatePipeline(withRealBest(a), listing);
    expect(pipeline.input).toBeUndefined();
    expect(pipeline.steps.find((s) => s.key === "draft")?.state).not.toBe("ok");
  });
});

describe("CSV ohne Kosten", () => {
  it("lässt die Zelle „Cost per item“ leer, wenn keine Kosten gesetzt sind", () => {
    const [header, row] = toShopifyCsv([real()]).trim().split("\n");
    // Zellen trennen (Anführungszeichen-Felder wie „Tags“ enthalten Kommas)
    const cells = [...row.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map((m) => m[1]);
    expect(cells[header.split(",").indexOf("Cost per item")]).toBe("");
    expect(cells[header.split(",").indexOf("Price")]).toBe("24.90");
  });
});
