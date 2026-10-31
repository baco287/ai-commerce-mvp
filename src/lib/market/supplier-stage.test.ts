// Supplier-Stufe der Market-Pipeline (Paket B): Katalogvarianten, getrennte Preislistenwege, eine Kalkulationsbasis.
// Alle Daten sind synthetisch und nur im Speicher (nur Test); GTINs fiktiv mit gültiger Prüfziffer. Kein Netzwerk.

import { afterEach, describe, expect, it } from "vitest";
import { marketEvaluationDeps } from "@/lib/data";
import { DEMO_QUERIES } from "@/lib/suppliers";
import { emptyOfferStore, type EvidenceEntry, type EvidenceField, type ImportedOfferData, type StoredOffer } from "@/lib/suppliers/import";
import { testSupplierData } from "@/test/setup";
import type { CatalogProduct } from "./catalog";
import type { MarketCandidate, MarketSignal } from "./model";
import { evaluateCandidate } from "./pipeline";
import { createDemoMarketSource, RequestBudget } from "./sources";

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
const G2 = gtin("401234500002"); // NUR TEST

/** NUR TEST: echtes (nicht-synthetisches) Preislisten-Angebot im Speicher. */
function offer(supplierId: string, sku: string, data: Partial<ImportedOfferData> = {}, synthetic = false): StoredOffer {
  return {
    key: `${supplierId}::${sku}`,
    data: {
      supplierId,
      supplierName: `Lieferant ${supplierId}`,
      supplierSku: sku,
      title: "Kabelkanal",
      unitPrice: 4,
      currency: "EUR",
      shippingCostDe: 3,
      minOrderQuantity: 1,
      minOrderValue: 0,
      stock: 300,
      shipsFrom: "DE",
      deliveryDays: { min: 2, max: 3 },
      dropshipping: true,
      blindShipping: true,
      paymentTerms: { kind: "net_terms", days: 30 },
      ...data,
    },
    provenance: { importId: "imp-1", importedAt: "2026-10-30T10:00:00.000Z", file: "liste.csv", fileSha256: "a".repeat(64), row: 2, synthetic },
    firstImportedAt: "2026-10-30T10:00:00.000Z",
    lastSeenImportId: "imp-1",
    history: [],
  };
}

/** NUR TEST: alle kritischen Angaben eines Angebots für eine Variante belegt (Werte wie in offer()). */
function fullEvidence(o: StoredOffer, product: { productGtin?: string; productKey?: string }): EvidenceEntry[] {
  const e = (field: EvidenceField, value: unknown, extra: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
    offerKey: o.key,
    ...product,
    field,
    value,
    document: `Testnachweis ${field}`,
    checkedBy: "Prüfer Test",
    checkedAt: "2026-10-30",
    ...extra,
  });
  return [
    e("identity.match", "exact"),
    e("safety.euResponsiblePerson", "Beispiel GmbH, Berlin"),
    e("safety.safetyInformationDe", true),
    e("safety.document", "Herstellerangaben", { docType: "gpsr" }),
    e("dropshipping.supported", true),
    e("pricing.unitPrice", o.data.unitPrice),
    e("pricing.shippingCost", o.data.shippingCostDe),
    e("fulfillment.shipsFrom", "DE"),
    e("fulfillment.deliversToDestination", true),
    e("fulfillment.deliveryDays", o.data.deliveryDays),
    e("fulfillment.stock", o.data.stock),
    e("payment.terms", o.data.paymentTerms),
    e("payment.requiresBusinessVerification", false),
  ];
}

/** NUR TEST: synthetisches Katalogprodukt. */
const catalogProduct = (o: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: "kabelkanal",
  title: "Kabelkanal selbstklebend",
  category: "Büromaterial",
  salePrice: { gross: 19.9, basis: "plan", reference: "Planpreis (Test)", checkedAt: "2026-10-30" },
  variants: [{ shopSku: "KK-1", gtin: G1 }],
  listing: { handle: "kabelkanal", title: "Kabelkanal", descriptionHtml: "<p>Test</p>", productType: "Kabelmanagement", categoryTag: "buero" },
  ...o,
});

const signal: MarketSignal = {
  sourceId: "wikimedia-pageviews",
  sourceName: "Wikipedia",
  kind: "public_interest",
  demo: false,
  retrievedAt: NOW.toISOString(),
  reference: "https://de.wikipedia.org/wiki/Kabelkanal",
  interest: { avg7: 250, avg30: 250, trend7: 0.2, trend30: 0.3, seasonalIndex: 1.1, days: 400, lastDate: "2026-10-30" },
};
const catalogCandidate = (id = "kabelkanal"): MarketCandidate => ({ key: `catalog:${id}`, title: "Kabelkanal selbstklebend", category: "Büromaterial", catalogId: id, discoveredVia: "Test", demo: false, signals: [signal] });
const storeWith = (...offers: StoredOffer[]) => ({ ...emptyOfferStore(), offers: Object.fromEntries(offers.map((o) => [o.key, o])) });

afterEach(() => {
  testSupplierData.store = emptyOfferStore();
  testSupplierData.evidence = [];
});

describe("Supplier-Stufe: Katalogvarianten", () => {
  it("ordnet eine Katalogvariante über die GTIN zu und wählt eine Kalkulationsbasis aus echten Angeboten", () => {
    const a = offer("a", "1", { gtin: G1 });
    testSupplierData.store = storeWith(a, offer("t", "9", { gtin: G1 }, true));
    testSupplierData.evidence = fullEvidence(a, { productGtin: G1 });
    const r = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [catalogProduct()] }));
    expect(r.stages.find((s) => s.key === "supplier")?.status).toBe("ok");
    expect(r.supplier).toMatchObject({ supplierName: "Lieferant a", demo: false, offerKeys: ["a::1"], liquidityStatus: "terms_unsecured", matchBasis: "gtin", requiresPrefinancing: false });
    // Planpreis 19,90 € gegen 4 + 3 + 1 € Stückkosten: zu wenig Deckungsbeitrag → Profit Controller stellt zurück
    expect(r.profit).toMatchObject({ priceGross: 19.9, priceSource: "plan" });
    expect(r.reasonCodes).toEqual(expect.arrayContaining(["MARGIN_LOW", "MARGIN_BELOW_MIN", "LIQ_TERM_UNSECURED"]));
    expect(r.state).toBe("deferred");
    expect(["approved", "draft_created"]).not.toContain(r.state);
  });

  it("ordnet ohne GTIN über Artikelnummer + MPN zu; der Nachweis gilt über den Varianten-Schlüssel", () => {
    const a = offer("a", "1", { mpn: "KK-100" });
    testSupplierData.store = storeWith(a);
    testSupplierData.evidence = fullEvidence(a, { productKey: "cat:kabelkanal:KK-1" });
    const product = catalogProduct({ variants: [{ shopSku: "KK-1", supplierOffers: ["a::1"], mpn: "KK100" }] });
    const r = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [product] }));
    expect(r.supplier).toMatchObject({ offerKeys: ["a::1"], matchBasis: "supplier_sku_mpn" });
    // Ohne Nachweis bleibt die Identität nur „angegeben“ → Angebot ausgeschlossen
    testSupplierData.evidence = [];
    const without = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [product] }));
    expect(without.reasonCodes).toContain("SUPPLIER_ALL_EXCLUDED");
    expect(without.stages.find((s) => s.key === "supplier")?.details.join(" ")).toMatch(/Produktidentität nicht bestätigt/);
  });

  it("stellt bei mehrdeutiger oder fehlender Zuordnung zurück", () => {
    testSupplierData.store = storeWith(offer("a", "1", { gtin: G1 }), offer("a", "2", { gtin: G1 }));
    const ambiguous = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [catalogProduct()] }));
    expect(ambiguous).toMatchObject({ state: "deferred" });
    expect(ambiguous.reasonCodes).toContain("IDENTITY_AMBIGUOUS");
    testSupplierData.store = emptyOfferStore();
    expect(evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [catalogProduct()] })).reasonCodes).toContain("IDENTITY_NO_OFFER");
  });

  it("verlangt einen Lieferanten für ALLE Varianten", () => {
    const a1 = offer("a", "1", { gtin: G1 });
    const a2 = offer("a", "2", { gtin: G2 });
    const b1 = offer("b", "1", { gtin: G1, unitPrice: 2 });
    const variants = [
      { shopSku: "KK-S", optionValue: "Schwarz", gtin: G1 },
      { shopSku: "KK-W", optionValue: "Weiß", gtin: G2 },
    ];
    const product = catalogProduct({ variants, listing: { ...catalogProduct().listing, option: "Farbe" } });
    testSupplierData.store = storeWith(a1, a2, b1);
    testSupplierData.evidence = [...fullEvidence(a1, { productGtin: G1 }), ...fullEvidence(a2, { productGtin: G2 }), ...fullEvidence(b1, { productGtin: G1 })];
    const r = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [product] }));
    // b ist günstiger, deckt aber nur eine Variante ab → Basis a für beide Varianten
    expect(r.supplier).toMatchObject({ supplierName: "Lieferant a", offerKeys: ["a::1", "a::2"] });

    testSupplierData.store = storeWith(a1, offer("b", "2", { gtin: G2 }));
    testSupplierData.evidence = [...fullEvidence(a1, { productGtin: G1 }), ...fullEvidence(offer("b", "2", { gtin: G2 }), { productGtin: G2 })];
    const split = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [product] }));
    expect(split.reasonCodes).toContain("SUPPLIER_VARIANTS_INCOMPLETE");
    expect(split.state).toBe("deferred");
  });
});

describe("Profit Controller: Stückrechnung + Liquidität für Katalogkandidaten (Paket C)", () => {
  /** NUR TEST: Angebot mit genügend Abstand zum Planpreis; Mindestabnahme/-wert per Nachweis bestätigt. */
  const priced = (data: Partial<ImportedOfferData> = {}) => offer("a", "1", { gtin: G1, unitPrice: 4, shippingCostDe: 2, ...data });
  const withSingleUnit = (o: StoredOffer) => [
    ...fullEvidence(o, { productGtin: G1 }),
    { offerKey: o.key, productGtin: G1, field: "pricing.minOrderQuantity" as const, value: 1, document: "Testnachweis MOQ", checkedBy: "Prüfer Test", checkedAt: "2026-10-30" },
    { offerKey: o.key, productGtin: G1, field: "pricing.minOrderValue" as const, value: 0, document: "Testnachweis MOV", checkedBy: "Prüfer Test", checkedAt: "2026-10-30" },
  ];
  const product = () => catalogProduct({ salePrice: { gross: 29.9, basis: "plan", reference: "Planpreis (Test)", checkedAt: "2026-10-30" } });

  it("sperrt ein bestätigtes 30-Tage-Ziel nur (LIQ_TERM_UNSECURED) – nie vorfinanzierungsfrei gesichert, Menge 0", () => {
    const a = priced();
    testSupplierData.store = storeWith(a);
    testSupplierData.evidence = withSingleUnit(a);
    const r = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [product()] }));
    const profit = r.stages.find((s) => s.key === "profit")!;
    expect(profit.status).toBe("blocked");
    expect(profit.codes).toEqual(expect.arrayContaining(["MARGIN_UNRELIABLE", "LIQ_TERM_UNSECURED", "AVAILABILITY_ZERO"]));
    expect(profit.codes?.some((c) => ["MARGIN_LOW", "MARGIN_BELOW_MIN", "MARGIN_STRESS_NEGATIVE", "SINGLE_UNIT_UNPROVEN", "LIQ_CAPACITY_ZERO"].includes(c))).toBe(false);
    expect(r.profit).toMatchObject({ priceSource: "plan", singleUnit: { status: "proven" } });
    // Liquidität aus Stufe 2 übernommen (nicht neu gerechnet), mit Verkaufspreis für das Erstattungsrisiko
    expect(r.liquidity).toMatchObject({ status: "terms_unsecured", securedWithoutPrefinancing: false, maxOpenOrders: 0, refundExposurePerOrder: 3.49 });
    expect(r.supplier?.liquidityStatus).toBe(r.liquidity?.status);
    expect(r.availability).toEqual([{ shopSku: "KK-1", plannedAvailable: 0 }]);
    // Die Kette läuft weiter (Compliance), freigegeben wird nie
    expect(r.stages.find((s) => s.key === "compliance")?.status).not.toBe("skipped");
    expect(["approved", "draft_created"]).not.toContain(r.state);
  });

  it("stellt Vorkasse ohne Mittelnachweis zurück und überspringt Compliance und Entwurf", () => {
    const a = priced({ paymentTerms: { kind: "prepayment" } });
    testSupplierData.store = storeWith(a);
    testSupplierData.evidence = withSingleUnit(a);
    const r = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [product()] }));
    expect(r.state).toBe("deferred");
    expect(r.stages.find((s) => s.key === "profit")).toMatchObject({ status: "deferred" });
    expect(r.reasonCodes).toEqual(expect.arrayContaining(["LIQ_PREFINANCING_UNFUNDED", "LIQ_CAPACITY_ZERO"]));
    expect(r.stages.filter((s) => s.key === "compliance" || s.key === "draft").map((s) => s.status)).toEqual(["skipped", "skipped"]);
    expect(r.stages.find((s) => s.key === "profit")?.details).toContain("0 offene vorfinanzierte Bestellungen – Mittel unbelegt.");
    expect(r.liquidity?.securedWithoutPrefinancing).toBe(false);
  });

  it("stellt ohne Einzelstück-Beleg zurück (SINGLE_UNIT_UNPROVEN) und rechnet ohne bestätigte Rücknahme den Warenwert als Verlust", () => {
    const a = priced({ minOrderQuantity: undefined, minOrderValue: undefined });
    testSupplierData.store = storeWith(a);
    testSupplierData.evidence = fullEvidence(a, { productGtin: G1 });
    const r = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW, { catalog: [product()] }));
    expect(r.reasonCodes).toContain("SINGLE_UNIT_UNPROVEN");
    expect(r.reasonCodes).toContain("LIQ_REFUND_UNKNOWN");
    expect(r.state).toBe("deferred");
  });
});

describe("Supplier-Stufe: Demo bleibt Demo", () => {
  it("ordnet einem Demo-Produkt nie eine echte Preislistenzeile mit Demo-GTIN zu", async () => {
    const led = DEMO_QUERIES["p-led"];
    const source = createDemoMarketSource(NOW);
    const topic = (await source.discover(new RequestBudget(0))).find((t) => t.productId === "p-led")!;
    const candidate: MarketCandidate = { ...topic, signals: [(await source.measure(topic, new RequestBudget(0)))!] };
    testSupplierData.store = storeWith(offer("echt", "1", { gtin: led.gtin, unitPrice: 0.5 }), offer("test", "2", { gtin: led.gtin }, true));
    const r = evaluateCandidate(candidate, marketEvaluationDeps(NOW));
    const supplierStage = r.stages.find((s) => s.key === "supplier")!;
    expect(supplierStage.status).toBe("ok");
    expect(JSON.stringify(r)).not.toMatch(/echt::1|Lieferant echt/);
  });

  it("stellt ein echtes Thema, das nur mit einem Demo-Produkt verknüpft ist, ohne Identität zurück", () => {
    const candidate: MarketCandidate = { key: "wiki:de.wikipedia:Trinkflasche", title: "Trinkflasche", productId: "p-bottle", discoveredVia: "Test", demo: false, signals: [signal] };
    const r = evaluateCandidate(candidate, marketEvaluationDeps(NOW));
    expect(r.reasonCodes).toContain("IDENTITY_MISSING");
    expect(r.stateReasons.join(" ")).toMatch(/mit Demo-Produkt verknüpft/);
    expect(r.supplier).toBeNull();
  });

  it("lädt ohne Katalog-Option keine Katalogdaten: Katalogkandidaten bleiben ohne Identität", () => {
    testSupplierData.store = storeWith(offer("a", "1", { gtin: G1 }));
    const r = evaluateCandidate(catalogCandidate(), marketEvaluationDeps(NOW));
    expect(r.reasonCodes).toContain("IDENTITY_MISSING");
  });
});
