// Store Manager (Paket E): vollständiger Shopify-Entwurf als lokales Artefakt – ohne Kosten, Konditionen und Laufwerte.
// Alle Daten sind synthetisch (nur Test); GTINs fiktiv mit gültiger Prüfziffer. Kein Netzwerk, kein Shopify.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { demoMarkersOf } from "@/lib/shopify/guards";
import { DEMO_LISTINGS } from "@/lib/shopify/listings";
import { PUBLIC_DRAFT_METAFIELDS } from "@/lib/shopify/product-input";
import {
  compareQuotes,
  DEMO_QUERIES,
  demoQuotesFor,
  missing,
  selectCalculationBasis,
  supplierStated,
  type LiquidityAssessment,
  type ProductQuery,
  type SupplierQuote,
} from "@/lib/suppliers";
import { buildQuote, ok } from "@/lib/suppliers/quote-builder";
import type { CatalogProduct } from "./catalog";
import type { MarketCandidate } from "./model";
import type { SalePrice } from "./profit";
import { writeDraftArtifact } from "./server/market-store";
import { draftArtifactFile, draftFingerprint, draftStageOf, prepareDraft, type PrepareDraftInput } from "./store-manager";

const NOW = new Date("2026-10-31T08:00:00Z");

/** NUR TEST: gültige GS1-Prüfziffer an eine fiktive Ziffernfolge anhängen. */
function gtin(body: string): string {
  const sum = body
    .split("")
    .map(Number)
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}
const G1 = gtin("401234500001"); // NUR TEST

const LONG_TEXT =
  "<p>Selbstklebender Kabelkanal aus PVC für die ordentliche Verlegung von Kabeln an Wand und Schreibtisch. " +
  "Länge 1 m, Breite 2 cm, weiß, mit Klebestreifen auf der Rückseite. Lässt sich mit einer Säge kürzen und überstreichen. " +
  "Lieferumfang: 4 Stück.</p>";

/** NUR TEST: synthetisches Katalogprodukt mit vollständigen Shop-Angaben. */
const catalogProduct = (o: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: "kabelkanal",
  title: "Kabelkanal selbstklebend",
  category: "Büromaterial",
  salePrice: { gross: 24.9, basis: "plan", reference: "Planpreis (Test)", checkedAt: "2026-10-30" },
  variants: [{ shopSku: "KK-1", gtin: G1 }],
  listing: {
    handle: "kabelkanal",
    title: "Kabelkanal selbstklebend, 4 × 1 m",
    descriptionHtml: LONG_TEXT,
    productType: "Kabelmanagement",
    categoryTag: "buero",
    images: [{ url: "https://bilder.example/kabelkanal.jpg", alt: "Kabelkanal an einer Wand", rightsReference: "Eigene Aufnahme (Test)" }],
  },
  ...o,
});

/** NUR TEST: echtes Preislisten-Angebot mit belegten Angaben (Werte frei erfunden). */
const realQuote = (o: Partial<SupplierQuote> = {}): SupplierQuote => {
  const q = buildQuote({
    id: "echt-1",
    supplierName: "Echt GmbH",
    productId: "catalog:kabelkanal",
    demo: false,
    identity: { supplierSku: "EK-77", gtin: ok(G1), brand: ok("Kabelfix") },
    provenance: { kind: "price_list", file: "liste.csv" },
  });
  return { ...q, ...o };
};

const query: ProductQuery = { productId: "catalog:kabelkanal", productKey: "cat:kabelkanal:KK-1", title: "Kabelkanal", gtin: G1, quantity: 1, destinationCountry: "DE", safety: { ceRequired: false } };
const candidate: MarketCandidate = { key: "catalog:kabelkanal", title: "Kabelkanal selbstklebend", catalogId: "kabelkanal", discoveredVia: "Test", demo: false, signals: [] };
const price: SalePrice = { gross: 24.9, basis: "plan", reference: "Planpreis (Test)", checkedAt: "2026-10-30" };

function realInput(o: { quote?: SupplierQuote; catalog?: CatalogProduct; price?: SalePrice; runId?: string; liquidity?: Partial<LiquidityAssessment> } = {}): PrepareDraftInput {
  const selection = selectCalculationBasis([{ shopSku: "KK-1", comparison: compareQuotes(query, [o.quote ?? realQuote()]) }]);
  if (!selection.basis || !selection.liquidity) throw new Error("Testaufbau: keine Kalkulationsbasis");
  return {
    candidate,
    catalog: o.catalog ?? catalogProduct(),
    price: o.price ?? price,
    basis: selection.basis,
    liquidity: { ...selection.liquidity, ...o.liquidity },
    compliance: { status: "human_review" },
    runId: o.runId ?? "lauf-1",
    now: NOW,
    demo: false,
    clockOverride: false,
  };
}

function demoInput(productId: "p-led" | "p-stand"): PrepareDraftInput {
  const q = DEMO_QUERIES[productId];
  const selection = selectCalculationBasis([{ shopSku: productId, comparison: compareQuotes(q, demoQuotesFor(productId)) }]);
  return {
    candidate: { key: `demo:${productId}`, title: q.title, productId, discoveredVia: "Demo", demo: true, signals: [] },
    demoListing: DEMO_LISTINGS.find((l) => l.productId === productId)!,
    price: { gross: 29.9, basis: "demo_target", reference: "Demo-Zielpreis" },
    basis: selection.basis!,
    liquidity: selection.liquidity!,
    compliance: { status: "human_review" },
    runId: "lauf-1",
    now: NOW,
    demo: true,
    clockOverride: false,
  };
}

describe("Store Manager: echter Entwurf", () => {
  it("enthält nur öffentliche, laufunabhängige Angaben – keine Kosten, Konditionen, Angebots-Schlüssel oder Laufwerte", () => {
    const a = prepareDraft(realInput());
    const json = JSON.stringify(a.shopifyInput);
    for (const forbidden of ["unitPrice", "perUnit", "shippingCost", "supplier_shipping", "offerKey", "EK-77", "supplier_", "expected_margin", "cost", "pipeline_run_id", "draft_fingerprint", "lauf-1", a.fingerprint]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    expect(a.shopifyInput.metafields.map((m) => m.key).every((k) => (PUBLIC_DRAFT_METAFIELDS as readonly string[]).includes(k))).toBe(true);
    expect(a.shopifyInput.metafields.map((m) => [m.key, m.value])).toEqual([
      ["dashboard_product_id", "catalog:kabelkanal"],
      ["compliance_status", "offen"],
      ["approval_status", "entwurf"],
    ]);
    expect(a.shopifyInput.status).toBe("DRAFT");
    for (const v of a.shopifyInput.variants) {
      expect(v).toMatchObject({ inventoryPolicy: "DENY", price: "24.90", inventoryItem: { sku: "KK-1", tracked: true } });
      expect(v.inventoryItem).not.toHaveProperty("cost");
    }
    expect(demoMarkersOf(a.shopifyInput)).toEqual({ demo: false, mixed: false });
    expect(a.shopifyInput.tags).toEqual(["ai-commerce-pipeline", "buero"]);
    expect(a.shopifyInput.vendor).toBe("Kabelfix");
    expect(a.shopifyInput.files).toEqual([{ originalSource: "https://bilder.example/kabelkanal.jpg", alt: "Kabelkanal an einer Wand", contentType: "IMAGE" }]);
    expect(a.shopifyInput.descriptionHtml).toMatch(/Verantwortliche Person in der EU: Demo Verantwortliche GmbH \(fiktiv\)/);
    expect(a).toMatchObject({ version: 1, kind: "dry_run_draft", demo: false, clockOverride: false, violations: [], approval: { status: "none", wouldCreate: false } });
    expect(a.completeness).toEqual({ complete: true, missing: [], notes: [] });
    expect(draftStageOf(a)).toEqual({ status: "ok", codes: [] });
  });

  it("führt den Angebots-Schlüssel nur in der Variantenzuordnung – und das Artefakt enthält nie Beträge", () => {
    const a = prepareDraft(realInput());
    expect(a.variantMap).toEqual([{ shopSku: "KK-1", basis: "gtin", gtin14: `0${G1}`, offerKey: "echt-1::EK-77", identity: "confirmed" }]);
    const json = JSON.stringify(a);
    for (const forbidden of ["unitPrice", "perUnit", "shippingCost", "creditLimit", "net_terms", "contribution", "margin", "upfront", "refundExposure", "goodsFunds"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    // Planmenge nur im Artefakt: ohne belegte Mittel 0
    expect(a.availability).toEqual([{ shopSku: "KK-1", plannedAvailable: 0 }]);
  });

  it("ergibt DRAFT_INCOMPLETE bei fehlendem GPSR-Block, fehlendem Bild, unbestätigter Marke oder zu kurzer Beschreibung", () => {
    // Eignung und Compliance-Stufe stellen ohne GPSR-Angaben schon vorher zurück – hier direkt am Basisangebot geprüft
    const base = realInput();
    const entry = base.basis.perVariant[0];
    const withoutPerson = { ...entry.evaluation.quote, safety: { ...entry.evaluation.quote.safety, euResponsiblePerson: missing<string>() } };
    const noGpsr = prepareDraft({ ...base, basis: { ...base.basis, perVariant: [{ ...entry, evaluation: { ...entry.evaluation, quote: withoutPerson } }] } });
    expect(noGpsr.completeness.missing).toEqual(["DRAFT_GPSR_MISSING"]);
    expect(noGpsr.shopifyInput.descriptionHtml).not.toMatch(/Produktsicherheit/);
    expect(draftStageOf(noGpsr)).toEqual({ status: "deferred", codes: ["DRAFT_INCOMPLETE", "DRAFT_GPSR_MISSING"] });

    const noImage = prepareDraft(realInput({ catalog: catalogProduct({ listing: { ...catalogProduct().listing, images: undefined } }) }));
    expect(noImage.completeness).toMatchObject({ complete: false, missing: ["DRAFT_INCOMPLETE"] });
    expect(noImage.completeness.notes.join(" ")).toMatch(/Produktbild/);
    expect(noImage.shopifyInput.files).toEqual([]);

    const stated = realQuote();
    const brandStated = prepareDraft(realInput({ quote: { ...stated, identity: { ...stated.identity, brand: supplierStated("Kabelfix", "Preisliste") } } }));
    expect(brandStated.shopifyInput.vendor).toBe("Kabelfix");
    expect(draftStageOf(brandStated)).toEqual({ status: "deferred", codes: ["DRAFT_INCOMPLETE", "DRAFT_BRAND_UNCONFIRMED"] });

    const noBrand = prepareDraft(realInput({ quote: { ...stated, identity: { ...stated.identity, brand: missing() } } }));
    expect(noBrand.shopifyInput.vendor).toBe("—");
    expect(noBrand.completeness.missing).toEqual(["DRAFT_BRAND_UNCONFIRMED"]);

    const short = prepareDraft(realInput({ catalog: catalogProduct({ listing: { ...catalogProduct().listing, descriptionHtml: "<p>Kurz.</p>" } }) }));
    expect(short.completeness.notes.join(" ")).toMatch(/Beschreibung zu kurz \(5 von mindestens 200 Zeichen\)/);
  });

  it("sperrt bei einem Guard-Verstoß (Preis 0,00) mit Verstoßtext", () => {
    const a = prepareDraft(realInput({ price: { ...price, gross: 0 } }));
    expect(a.violations.join(" ")).toMatch(/ungültiger Preis "0\.00"/);
    expect(draftStageOf(a)).toEqual({ status: "blocked", codes: ["DRAFT_GUARD_VIOLATION"] });
  });

  it("mischt nie Demo und echt und entwirft nur nach vollständiger Compliance-Prüfung", () => {
    expect(() => prepareDraft({ ...realInput(), demoListing: DEMO_LISTINGS[0] })).toThrow(/nie gemischt/);
    expect(() => prepareDraft({ ...realInput(), demo: true })).toThrow(/nie gemischt/);
    expect(() => prepareDraft({ ...realInput(), compliance: { status: "deferred" } })).toThrow(/Compliance/);
  });
});

describe("Store Manager: Demo-Entwurf", () => {
  it("ist vollständig als Demo gekennzeichnet und trägt keine Kosten", () => {
    const a = prepareDraft(demoInput("p-stand"));
    expect(a.demo).toBe(true);
    expect(demoMarkersOf(a.shopifyInput)).toEqual({ demo: true, mixed: false });
    expect(a.shopifyInput.title).toMatch(/^\[DEMO\] /);
    expect(a.shopifyInput.tags).toContain("ai-commerce-demo");
    expect(a.shopifyInput.descriptionHtml).toMatch(/^<p><strong>Demo-Produkt/);
    expect(JSON.stringify(a)).not.toMatch(/"cost"|supplier_|expected_margin|unitPrice|perUnit/);
    expect(a.variantMap.map((v) => [v.shopSku, v.basis, v.identity])).toEqual([
      ["DEMO-STAND-SLV", "demo_product_level", "confirmed"],
      ["DEMO-STAND-GRY", "demo_product_level", "confirmed"],
    ]);
    expect(a.violations).toEqual([]);
    expect(a.completeness.complete).toBe(true);
  });
});

describe("Store Manager: Fingerabdruck und Artefakt-Datei", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("ist laufunabhängig: zwei Lauf-IDs mit gleichen Daten ergeben denselben Fingerabdruck und keine zweite Datei", () => {
    const first = prepareDraft(realInput({ runId: "lauf-1" }));
    const second = prepareDraft({ ...realInput({ runId: "lauf-2" }), now: new Date("2026-10-31T09:00:00Z") });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.fingerprint).toBe(draftFingerprint(second));
    expect(draftArtifactFile(first)).toBe(`drafts/catalog_kabelkanal.${first.fingerprint.slice(0, 12)}.json`);

    dir = mkdtempSync(join(tmpdir(), "market-drafts-"));
    expect(writeDraftArtifact(first, dir).status).toBe("written");
    expect(writeDraftArtifact(second, dir).status).toBe("exists");
    expect(readdirSync(join(dir, "drafts"))).toEqual([`catalog_kabelkanal.${first.fingerprint.slice(0, 12)}.json`]);

    // Geänderter Inhalt ergibt eine neue Datei
    const other = prepareDraft(realInput({ price: { ...price, gross: 26.9 } }));
    expect(other.fingerprint).not.toBe(first.fingerprint);
    expect(writeDraftArtifact(other, dir).status).toBe("written");
    expect(readdirSync(join(dir, "drafts"))).toHaveLength(2);
  });

  it("ändert sich nicht mit der geplanten Menge oder der simulierten Uhr", () => {
    const base = prepareDraft(realInput());
    const withCapacity = prepareDraft(realInput({ liquidity: { maxOpenOrders: 3 } }));
    expect(withCapacity.availability).toEqual([{ shopSku: "KK-1", plannedAvailable: 3 }]);
    expect(withCapacity.fingerprint).toBe(base.fingerprint);
    const simulated = prepareDraft({ ...realInput(), clockOverride: true });
    expect(simulated.clockOverride).toBe(true);
    expect(simulated.fingerprint).toBe(base.fingerprint);
  });
});
