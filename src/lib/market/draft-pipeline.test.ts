// Entwurfsstufe und Endzustand der Market-Pipeline (Paket E): Store Manager, „bereit zur Prüfung“, Demo bleibt Demo.
// Alle Daten sind synthetisch und nur im Speicher (nur Test); GTINs fiktiv mit gültiger Prüfziffer. Kein Netzwerk.

import { afterEach, describe, expect, it } from "vitest";
import { marketEvaluationDeps } from "@/lib/data";
import { PUBLIC_DRAFT_METAFIELDS } from "@/lib/shopify/product-input";
import { emptyOfferStore, type EvidenceEntry, type EvidenceField, type ImportedOfferData, type StoredOffer } from "@/lib/suppliers/import";
import { testSupplierData } from "@/test/setup";
import type { CatalogProduct } from "./catalog";
import type { MarketCandidate, MarketSignal } from "./model";
import { evaluateCandidate, runMarketScan } from "./pipeline";
import { REASON_META } from "./reasons";
import { createCatalogMarketSource, createDemoMarketSource, RequestBudget } from "./sources";
import { emptyMarketState, mergeRun } from "./state";

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

/** NUR TEST: echtes (nicht-synthetisches) Preislisten-Angebot im Speicher, Zahlungsziel 30 Tage. */
function offer(data: Partial<ImportedOfferData> = {}): StoredOffer {
  return {
    key: "a::1",
    data: {
      supplierId: "a",
      supplierName: "Lieferant a",
      supplierSku: "1",
      title: "Kabelkanal",
      brand: "Kabelfix",
      gtin: G1,
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
    provenance: { importId: "imp-1", importedAt: "2026-10-30T10:00:00.000Z", file: "liste.csv", fileSha256: "a".repeat(64), row: 2, synthetic: false },
    firstImportedAt: "2026-10-30T10:00:00.000Z",
    lastSeenImportId: "imp-1",
    history: [],
  };
}

/** NUR TEST: alle kritischen Angaben belegt, inkl. Marke und Einzelstückbezug. */
function fullEvidence(o: StoredOffer): EvidenceEntry[] {
  const e = (field: EvidenceField, value: unknown, extra: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
    offerKey: o.key,
    productGtin: G1,
    field,
    value,
    document: `Testnachweis ${field}`,
    checkedBy: "Prüfer Test",
    checkedAt: "2026-10-30",
    ...extra,
  });
  return [
    e("identity.match", "exact"),
    e("identity.brand", "Kabelfix"),
    e("safety.euResponsiblePerson", "Beispiel GmbH, Berlin"),
    e("safety.safetyInformationDe", true),
    e("safety.document", "Herstellerangaben", { docType: "gpsr" }),
    e("dropshipping.supported", true),
    e("pricing.unitPrice", o.data.unitPrice),
    e("pricing.shippingCost", o.data.shippingCostDe),
    e("pricing.minOrderQuantity", 1),
    e("pricing.minOrderValue", 0),
    e("fulfillment.shipsFrom", "DE"),
    e("fulfillment.deliversToDestination", true),
    e("fulfillment.deliveryDays", o.data.deliveryDays),
    e("fulfillment.stock", o.data.stock),
    e("payment.terms", o.data.paymentTerms),
    e("payment.requiresBusinessVerification", false),
  ];
}

/** NUR TEST: synthetisches Katalogprodukt mit vollständigen Shop-Angaben. */
const catalogProduct = (): CatalogProduct => ({
  id: "kabelkanal",
  title: "Kabelkanal selbstklebend",
  category: "Büromaterial",
  wikiTitle: "Kabelkanal",
  salePrice: { gross: 39.9, basis: "plan", reference: "Planpreis (Test)", checkedAt: "2026-10-30" },
  variants: [{ shopSku: "KK-1", gtin: G1 }],
  listing: {
    handle: "kabelkanal",
    title: "Kabelkanal selbstklebend, 4 × 1 m",
    descriptionHtml:
      "<p>Selbstklebender Kabelkanal aus PVC für die ordentliche Verlegung von Kabeln an Wand und Schreibtisch. Länge 1 m, " +
      "Breite 2 cm, weiß, mit Klebestreifen auf der Rückseite. Lässt sich mit einer Säge kürzen und überstreichen. Lieferumfang: 4 Stück.</p>",
    productType: "Kabelmanagement",
    categoryTag: "buero",
    images: [{ url: "https://bilder.example/kabelkanal.jpg", alt: "Kabelkanal an einer Wand", rightsReference: "Eigene Aufnahme (Test)" }],
  },
});

const signal: MarketSignal = {
  sourceId: "wikimedia-pageviews",
  sourceName: "Wikipedia",
  kind: "public_interest",
  demo: false,
  retrievedAt: "2026-10-29T08:00:00.000Z",
  reference: "https://de.wikipedia.org/wiki/Kabelkanal",
  interest: { avg7: 250, avg30: 250, trend7: 0.2, trend30: 0.3, seasonalIndex: 1.1, days: 400, lastDate: "2026-10-28" },
};
const candidate = (signals: MarketSignal[]): MarketCandidate => ({
  key: "catalog:kabelkanal",
  title: "Kabelkanal selbstklebend",
  category: "Büromaterial",
  catalogId: "kabelkanal",
  discoveredVia: "Test",
  demo: false,
  signals,
});

function withFullOffer() {
  const o = offer();
  testSupplierData.store = { ...emptyOfferStore(), offers: { [o.key]: o } };
  testSupplierData.evidence = fullEvidence(o);
}

afterEach(() => {
  testSupplierData.store = emptyOfferStore();
  testSupplierData.evidence = [];
});

describe("Entwurfsstufe und Endzustand", () => {
  it("setzt einen vollständig belegten Katalogkandidaten mit zwischengespeichertem Signal auf „bereit zur Prüfung“ – nie freigegeben", async () => {
    withFullOffer();
    const run = await runMarketScan({
      ...marketEvaluationDeps(NOW, { catalog: [catalogProduct()] }),
      runId: "lauf-1",
      sources: [createCatalogMarketSource({ products: [catalogProduct()], invalid: [] })],
      allowNetwork: false,
      shouldStop: () => false,
      clock: () => NOW,
      cachedSignal: (key) => (key === "catalog:kabelkanal" ? [signal] : []),
    });
    const [r] = run.results;
    expect(r.stages.map((s) => [s.key, s.status]), r.stateReasons.join(" | ")).toEqual([
      ["market", "ok"],
      ["supplier", "ok"],
      ["profit", "blocked"],
      ["compliance", "blocked"],
      ["draft", "ok"],
    ]);
    expect(r.state).toBe("review_ready");
    expect(r.reasonCodes).toEqual(expect.arrayContaining(["MARKET_SIGNAL_CACHED", "LIQ_TERM_UNSECURED", "COMPLIANCE_HUMAN_REVIEW"]));
    expect(r.stateReasons.join(" ")).toMatch(/keine Freigabe/);
    expect(r.draft).toMatchObject({ status: "dry_run_prepared", wouldCreate: false, complete: true, missing: [], violations: [] });
    expect(r.draft.artifact?.file).toMatch(/^drafts\/catalog_kabelkanal\.[0-9a-f]{12}\.json$/);

    // Das Artefakt: keine Einkaufs-, Konditions- oder Laufwerte im Shopify-Teil
    const a = r.draftArtifact!;
    expect(a.runId).toBe("lauf-1");
    expect(a.shopifyInput.metafields.every((m) => (PUBLIC_DRAFT_METAFIELDS as readonly string[]).includes(m.key))).toBe(true);
    expect(JSON.stringify(a.shopifyInput)).not.toMatch(/a::1|supplier_|cost|unitPrice|lauf-1|pipeline_run_id|draft_fingerprint/);
    expect(a.shopifyInput.vendor).toBe("Kabelfix");
    expect(a.shopifyInput.descriptionHtml).toMatch(/Beispiel GmbH, Berlin/);
    expect(a.variantMap).toEqual([{ shopSku: "KK-1", basis: "gtin", gtin14: `0${G1}`, offerKey: "a::1", identity: "confirmed" }]);

    // state.json bekommt das Artefakt nicht – nur Datei und Fingerabdruck
    const stored = mergeRun(emptyMarketState(), run).candidates["catalog:kabelkanal"];
    expect(stored.latest).not.toHaveProperty("draftArtifact");
    expect(stored.latest.draft.artifact).toEqual(r.draft.artifact);
    expect(stored.history.at(-1)?.state).toBe("review_ready");
  });

  it("durchläuft ohne Signal alle Stufen mit Artefakt, stellt aber mit MARKET_NO_DEMAND zurück", () => {
    withFullOffer();
    const r = evaluateCandidate(candidate([]), marketEvaluationDeps(NOW, { catalog: [catalogProduct()] }));
    expect(r.stages.map((s) => s.key)).toEqual(["market", "supplier", "profit", "compliance", "draft"]);
    expect(r.stages.find((s) => s.key === "draft")?.status).toBe("ok");
    expect(r.draftArtifact?.completeness.complete).toBe(true);
    expect(r.state).toBe("deferred");
    expect(r.reasonCodes).toContain("MARKET_NO_DEMAND");
  });

  it("wird mit simulierter Uhr nie „bereit zur Prüfung“ (CLOCK_OVERRIDDEN)", () => {
    withFullOffer();
    const r = evaluateCandidate({ ...candidate([{ ...signal, cached: true }]) }, { ...marketEvaluationDeps(NOW, { catalog: [catalogProduct()] }), clockOverride: true });
    expect(r.state).toBe("blocked");
    expect(r.reasonCodes).toContain("CLOCK_OVERRIDDEN");
    expect(r.draftArtifact?.clockOverride).toBe(true);
  });

  it("stellt bei unvollständigem Entwurf zurück (DRAFT_INCOMPLETE + Einzelcode)", () => {
    withFullOffer();
    testSupplierData.evidence = testSupplierData.evidence.filter((e) => e.field !== "identity.brand");
    const r = evaluateCandidate(candidate([{ ...signal, cached: true }]), marketEvaluationDeps(NOW, { catalog: [catalogProduct()] }));
    expect(r.stages.find((s) => s.key === "draft")).toMatchObject({ status: "deferred", codes: ["DRAFT_INCOMPLETE", "DRAFT_BRAND_UNCONFIRMED"] });
    expect(r.state).toBe("deferred");
    expect(r.draft.complete).toBe(false);
  });

  it("führt ein Demo-Produkt bis zum vollständigen, gekennzeichneten Demo-Artefakt ohne Kosten – Endzustand gesperrt (DEMO_DATA)", async () => {
    const source = createDemoMarketSource(NOW);
    const topic = (await source.discover(new RequestBudget(0))).find((t) => t.productId === "p-led")!;
    const r = evaluateCandidate({ ...topic, signals: [(await source.measure(topic, new RequestBudget(0)))!] }, marketEvaluationDeps(NOW));
    expect(r.stages.find((s) => s.key === "draft")?.status).toBe("ok");
    expect(r.state).toBe("blocked");
    expect(r.reasonCodes).toContain("DEMO_DATA");
    const a = r.draftArtifact!;
    expect(a).toMatchObject({ demo: true, completeness: { complete: true }, violations: [] });
    expect(a.shopifyInput.title).toMatch(/^\[DEMO\] /);
    expect(a.shopifyInput.tags).toContain("ai-commerce-demo");
    expect(JSON.stringify(a)).not.toMatch(/"cost"|supplier_|expected_margin/);
  });

  it("nennt für jeden Kandidaten, der nicht „bereit zur Prüfung“ ist, einen Code mit Wirkung zurückstellen oder sperren", async () => {
    withFullOffer();
    const run = await runMarketScan({
      ...marketEvaluationDeps(NOW, { catalog: [catalogProduct()] }),
      runId: "lauf-2",
      sources: [createDemoMarketSource(NOW), createCatalogMarketSource({ products: [catalogProduct()], invalid: [] })],
      allowNetwork: false,
      shouldStop: () => false,
      clock: () => NOW,
    });
    for (const r of run.results.filter((x) => x.state !== "review_ready" && x.state !== "unreviewed")) {
      expect(r.reasonCodes?.some((c) => REASON_META[c].effect !== "hint"), r.candidate.key).toBe(true);
      expect(r.stateReasons.length, r.candidate.key).toBeGreaterThan(0);
    }
    expect(run.results.every((r) => r.state !== "approved" && r.state !== "draft_created")).toBe(true);
  });
});
