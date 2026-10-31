import { afterEach, describe, expect, it } from "vitest";
import { getProductAnalyses, getSupplierImportStatus, getSupplierScoutReports } from "@/lib/data";
import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { testSupplierData } from "@/test/setup";
import { compareQuotes } from "../compare";
import { buildSupplierView, type OfferView } from "../dashboard";
import { DEMO_QUERIES, DEMO_REQUIRED_DOCUMENTS, demoQuotesFor } from "../demo/demo-suppliers";
import { assessFinancing } from "../financing";
import { assessFunding, type FundingContext } from "../funding";
import { factLevel } from "../model";
import { createPriceListAdapter, outdatedOfferKeys, priceListQuotesFor } from "./adapter";
import type { EvidenceEntry, EvidenceField } from "./evidence";
import { emptyOfferStore, type ImportedOfferData, type OfferStore, type StoredOffer } from "./types";

/** NUR TEST: gültige GS1-Prüfziffer an eine fiktive Ziffernfolge anhängen. */
const testGtin = (body: string) => {
  const sum = body.split("").map(Number).reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
};
/**
 * Paket I: Echte Preislistenzeilen erreichen Demo-Produkte nie (auch nicht über Demo-GTINs). Die Prüfungen des echten
 * Wegs laufen daher gegen eine echte Abfrage mit fiktiver, global eindeutiger GTIN (NUR TEST) und `allowReal: true`.
 */
const DEMO_STAND = DEMO_QUERIES["p-stand"];
const STAND = { ...DEMO_STAND, productId: "test-stand", gtin: testGtin("401234599990") };
const LED = { ...DEMO_QUERIES["p-led"], productId: "test-led", gtin: testGtin("401234599991") };
const STAND_PRODUCT = DEMO_PRODUCTS.find((p) => p.id === "p-stand")!;
const KEY = "grosshandel-beispiel::GB-STAND-1";
/** Echter Weg: nur nicht-synthetische Angebote, Zuordnung über die globale GTIN */
const quotesFor = (store: OfferStore, query: typeof STAND, evidence: EvidenceEntry[] = []) => priceListQuotesFor(store, query, evidence, { allowReal: true });

function offer(data: Partial<ImportedOfferData> = {}, synthetic = false): StoredOffer {
  return {
    key: KEY,
    data: {
      supplierId: "grosshandel-beispiel",
      supplierName: "Großhandel Beispiel",
      supplierSku: "GB-STAND-1",
      gtin: STAND.gtin,
      title: "Laptopständer Aluminium",
      unitPrice: 9.5,
      currency: "EUR",
      shippingCostDe: 3.5,
      minOrderQuantity: 1,
      minOrderValue: 0,
      stock: 400,
      shipsFrom: "DE",
      deliveryDays: { min: 2, max: 3 },
      dropshipping: true,
      blindShipping: true,
      paymentTerms: { kind: "prepayment" },
      supplierUpdatedAt: "2026-10-30",
      dataSource: "Preisliste per E-Mail",
      ...data,
    },
    provenance: { importId: "imp-1", importedAt: "2026-10-31T10:00:00.000Z", file: "liste.csv", fileSha256: "a".repeat(64), row: 2, synthetic },
    firstImportedAt: "2026-10-31T10:00:00.000Z",
    lastSeenImportId: "imp-1",
    history: [],
  };
}
const storeWith = (...offers: StoredOffer[]): OfferStore => ({ ...emptyOfferStore(), offers: Object.fromEntries(offers.map((o) => [o.key, o])) });

const proof = (field: EvidenceField, value: unknown, productGtin = STAND.gtin!): EvidenceEntry => ({
  offerKey: KEY,
  productGtin,
  field,
  value,
  document: `Testnachweis ${field}`,
  checkedBy: "Prüfer Test",
  checkedAt: "2026-10-31",
});
/** Alle kritischen Angaben des Laptopständers unabhängig belegt. */
const FULL_EVIDENCE: EvidenceEntry[] = [
  proof("identity.match", "exact"),
  proof("safety.euResponsiblePerson", "Beispiel GmbH, Berlin"),
  proof("safety.safetyInformationDe", true),
  // Unterlagen erfüllen eine Pflicht nur mit festem Dokumenttyp (documents.ts)
  { ...proof("safety.document", DEMO_REQUIRED_DOCUMENTS.gpsr), docType: "gpsr" },
  proof("dropshipping.supported", true),
  proof("pricing.unitPrice", 9.5),
  proof("pricing.shippingCost", 3.5),
  proof("fulfillment.shipsFrom", "DE"),
  proof("fulfillment.deliversToDestination", true),
  proof("fulfillment.deliveryDays", { min: 2, max: 3 }),
  proof("fulfillment.stock", 400),
  proof("payment.terms", { kind: "prepayment" }),
];

/** Echte Abfrage: Demo-Angebote zählen für echte Kandidaten nie – der Vergleich enthält nur die Preislisten-Angebote. */
function standView(store: OfferStore, evidence: EvidenceEntry[] = []) {
  return buildSupplierView(STAND_PRODUCT, compareQuotes(STAND, quotesFor(store, STAND, evidence)));
}
const importedOf = (store: OfferStore, evidence: EvidenceEntry[] = []): OfferView => {
  const v = standView(store, evidence);
  return [...v.eligible, ...v.excluded].find((o) => o.quoteId.startsWith("price-list:"))!;
};

afterEach(() => {
  testSupplierData.store = emptyOfferStore();
  testSupplierData.evidence = [];
});

describe("Scout: importierte Preislisten-Angebote", () => {
  it("führt jede Preislisten-Angabe als „vom Lieferanten angegeben“ – nie als geprüft", () => {
    const [quote] = quotesFor(storeWith(offer()), STAND);
    expect(factLevel(quote.pricing.unitPrice)).toBe("supplier_stated");
    expect(factLevel(quote.fulfillment.stock)).toBe("supplier_stated");
    expect(factLevel(quote.payment.terms)).toBe("supplier_stated");
    expect(factLevel(quote.identity.match)).toBe("supplier_stated");
    // Produktsicherheit kann eine Preisliste nicht belegen
    expect(quote.safety.ceMarking.status).toBe("missing");
    expect(quote.safety.euResponsiblePerson.status).toBe("missing");
    expect(quote.safety.safetyInformationDe.status).toBe("missing");
    expect(quote.provenance).toMatchObject({ kind: "price_list", file: "liste.csv", row: 2, dataSource: "Preisliste per E-Mail", supplierUpdatedAt: "2026-10-30" });
  });

  it("schließt ungeprüfte echte Angebote mit Gründen aus und kennzeichnet sie als ECHTE QUELLE, UNGEPRÜFT", () => {
    const o = importedOf(storeWith(offer()));
    expect(o.source).toBe("real_unverified");
    expect(o.demo).toBe(false);
    expect(o.eligible).toBe(false);
    expect(o.exclusions.join(" ")).toMatch(/Verantwortliche Person in der EU \(GPSR\) fehlt/);
    expect(o.exclusions.join(" ")).toMatch(/Deutsche Sicherheitshinweise fehlt/);
    expect(o.exclusions.join(" ")).toMatch(/Direktversand an Kunden nur unbestätigt|Direktversand an Kunden .*unbestätigt/);
    expect(o.openDocuments).toEqual([DEMO_REQUIRED_DOCUMENTS.gpsr]);
    expect(o.provenanceText).toMatch(/Preisliste liste\.csv, Zeile 2 · Stand 2026-10-30/);
    expect(o.purchaseGuardTerms).toBe("vorkasse");
  });

  it("verlangt CE-Nachweise produktspezifisch – auch bei bestätigter CE-Angabe für ein anderes Produkt", () => {
    const led = LED;
    const ledOffer = offer({ gtin: led.gtin });
    const otherProduct = [proof("safety.ceMarking", true, STAND.gtin!)];
    const [quote] = quotesFor(storeWith(ledOffer), led, otherProduct);
    expect(quote.safety.ceMarking.status).toBe("missing");
    const v = buildSupplierView(DEMO_PRODUCTS.find((p) => p.id === "p-led")!, compareQuotes(led, [quote]));
    expect(v.excluded[0].exclusions.join(" ")).toMatch(/CE-Kennzeichnung fehlt/);

    const [proven] = quotesFor(storeWith(ledOffer), led, [proof("safety.ceMarking", true, led.gtin!)]);
    expect(proven.safety.ceMarking).toMatchObject({ status: "confirmed", value: true, checkedAt: "2026-10-31" });
  });

  it("kennzeichnet synthetische Testdaten als DEMO, nie als echte Quelle", () => {
    // Demo-Weg (Standard ohne allowReal): synthetische Zeile mit Demo-GTIN zur Demo-Abfrage
    const evidence = FULL_EVIDENCE.map((e) => ({ ...e, productGtin: DEMO_STAND.gtin }));
    const quotes = priceListQuotesFor(storeWith(offer({ gtin: DEMO_STAND.gtin }, true)), DEMO_STAND, evidence);
    const v = buildSupplierView(STAND_PRODUCT, compareQuotes(DEMO_STAND, [...demoQuotesFor("p-stand"), ...quotes]));
    const o = [...v.eligible, ...v.excluded].find((x) => x.quoteId.startsWith("price-list:"))!;
    expect(o.source).toBe("demo");
    // Echter Weg: synthetische Zeilen erscheinen dort nie
    expect(quotesFor(storeWith(offer({}, true)), STAND, FULL_EVIDENCE)).toEqual([]);
    expect(o.flags.find((f) => f.kind === "demo")?.label).toBe("Testdaten");
  });

  it("macht Angaben erst mit Nachweisen „geprüft“ – dann NACHWEISE GEPRÜFT, aber ohne Einkaufsfreigabe", () => {
    const store = storeWith(offer());
    const o = importedOf(store, FULL_EVIDENCE);
    expect(o.source).toBe("real_verified");
    expect(o.eligible).toBe(true);
    expect(o.unitPrice).toMatchObject({ status: "confirmed", level: "verified" });
    expect(o.openDocuments).toEqual([]);
    // Ein guter Score gibt nichts frei
    const v = standView(store, FULL_EVIDENCE);
    expect(v.recommendations.some((r) => r.offer.quoteId === o.quoteId)).toBe(true);
    expect(v.purchaseApproved).toBe(false);
    expect(v.autoPurchaseEnabled).toBe(false);
    expect(o.purchaseGuardTerms).toBe("vorkasse");
  });

  it("bleibt ungeprüft, solange auch nur eine kritische Angabe nicht belegt ist", () => {
    const withoutStock = FULL_EVIDENCE.filter((e) => e.field !== "fulfillment.stock");
    expect(importedOf(storeWith(offer()), withoutStock).source).toBe("real_unverified");
  });

  it("schließt Angebote aus, deren Mindestbestellwert einen Vorratskauf erzwingt", () => {
    const o = importedOf(storeWith(offer({ minOrderValue: 50 })), FULL_EVIDENCE);
    expect(o.eligible).toBe(false);
    expect(o.exclusions.join(" ")).toMatch(/Mindestbestellwert 50,00 € über dem Warenwert/);
    const unknown = importedOf(storeWith(offer({ minOrderValue: undefined })), FULL_EVIDENCE);
    expect(unknown.warnings.join(" ")).toMatch(/Mindestbestellwert unbekannt/);
  });

  it("ordnet nur über die GTIN zu – unbekannte oder fehlende GTIN erscheint bei keinem Produkt", async () => {
    const store = storeWith({ ...offer({ gtin: "2000000000992" }), key: "x::1" }, { ...offer({ gtin: undefined }), key: "x::2" });
    for (const q of Object.values(DEMO_QUERIES)) {
      expect(priceListQuotesFor(store, q)).toEqual([]);
      expect(await createPriceListAdapter(store).findQuotes(q)).toEqual([]);
    }
  });

  it("meldet den Preislisten-Adapter als lokal, kostenlos und ohne Netzwerk", () => {
    expect(createPriceListAdapter(emptyOfferStore()).info).toEqual({
      id: "price-list",
      name: "Importierte Preislisten (lokal)",
      kind: "manual",
      paid: false,
      network: false,
    });
  });
});

describe("Scout: Befunde aus dem Review", () => {
  it("wendet veraltete Nachweise nicht an, wenn die neue Preisliste widerspricht", () => {
    const evidence = [
      ...FULL_EVIDENCE.filter((e) => e.field !== "payment.terms"),
      proof("payment.terms", { kind: "net_terms", days: 30 }),
      proof("payment.requiresBusinessVerification", false),
    ];
    // Neuere Preisliste: teurer, ausverkauft, nur noch Vorkasse
    const newer = storeWith(offer({ unitPrice: 14, stock: 0, paymentTerms: { kind: "prepayment" } }));
    const o = importedOf(newer, evidence);
    expect(o.unitPrice).toMatchObject({ value: 14, level: "supplier_stated" });
    expect(o.stock).toMatchObject({ value: 0, level: "supplier_stated" });
    expect(o.source).toBe("real_unverified");
    expect(o.eligible).toBe(false);
    expect(o.funding.status).not.toBe("no_prefinancing");
    expect(o.purchaseGuardTerms).toBe("vorkasse");
    expect(o.warnings.filter((w) => /widerspricht der aktuellen Preisliste/.test(w))).toHaveLength(3);
    // Unveränderte Angaben bleiben geprüft
    expect(o.shippingCost.level).toBe("verified");
  });

  it("macht ein nur teilweise geprüftes echtes Angebot weder geeignet noch zur Kalkulationsbasis", () => {
    const safetyOnly = FULL_EVIDENCE.filter((e) => e.field.startsWith("safety.") || e.field.startsWith("identity.") || e.field === "dropshipping.supported");
    testSupplierData.store = storeWith(offer({ unitPrice: 1 }));
    testSupplierData.evidence = safetyOnly;
    const o = importedOf(testSupplierData.store, safetyOnly);
    expect(o.eligible).toBe(false);
    expect(o.exclusions.join(" ")).toMatch(/Preisliste ohne Nachweis für Einkaufspreis, Versandkosten, Versandland, Lieferung nach DE, Lieferzeit, Lieferantenbestand/);
    const stand = getProductAnalyses().find((a) => a.product.id === "p-stand")!;
    expect(stand.best?.landedCost).toBe(15.1);
  });

  it("macht ein vollständig geprüftes, günstigeres echtes Angebot zur Kalkulationsbasis – aber ohne Freigabe", () => {
    testSupplierData.store = storeWith(offer());
    testSupplierData.evidence = FULL_EVIDENCE;
    // Für den echten Kandidaten ist das geprüfte Angebot die Basis …
    const real = compareQuotes(STAND, quotesFor(testSupplierData.store, STAND, FULL_EVIDENCE));
    expect(real.recommendations.cheapest).toMatchObject({ perUnit: 13, demo: false, approval: "none" });
    expect(standView(testSupplierData.store, FULL_EVIDENCE).purchaseApproved).toBe(false);
    // … das Demo-Produkt bleibt unberührt (Paket I: echte Zeilen erreichen Demo-Produkte nie)
    const stand = getProductAnalyses().find((a) => a.product.id === "p-stand")!;
    expect(stand.best?.landedCost).toBe(15.1);
  });
});

describe("Scout: Befunde aus dem abschließenden Review", () => {
  it("leitet Importkosten 0 € nie aus einem nur angegebenen Versandland ab", () => {
    const withoutShipsFrom = FULL_EVIDENCE.filter((e) => e.field !== "fulfillment.shipsFrom");
    const o = importedOf(storeWith(offer({ unitPrice: 1 })), withoutShipsFrom);
    expect(o.eligible).toBe(false);
    expect(o.exclusions.join(" ")).toMatch(/Preisliste ohne Nachweis für .*Versandland/);
    // Außerhalb der EU braucht es zusätzlich belegte Importkosten
    const cn = [...withoutShipsFrom, proof("fulfillment.shipsFrom", "CN")];
    const fromCn = importedOf(storeWith(offer({ shipsFrom: "CN" })), cn);
    expect(fromCn.exclusions.join(" ")).toMatch(/Importkosten/);
    expect(fromCn.source).toBe("real_unverified");
    const withImport = importedOf(storeWith(offer({ shipsFrom: "CN" })), [...cn, proof("pricing.importCost", 1.2)]);
    expect(withImport.eligible).toBe(true);
    expect(withImport.source).toBe("real_verified");
    expect(withImport.perUnit).toBe(14.2);
  });

  it("wendet sich widersprechende Nachweise zum selben Feld nicht an – egal in welcher Reihenfolge", () => {
    const led = LED;
    const ledOffer = offer({ gtin: led.gtin });
    const ce = (value: boolean, checkedAt: string) => ({ ...proof("safety.ceMarking", value, led.gtin!), checkedAt });
    for (const entries of [
      [ce(false, "2026-10-30"), ce(true, "2025-01-01")],
      [ce(true, "2025-01-01"), ce(false, "2026-10-30")],
    ]) {
      const [q] = quotesFor(storeWith(ledOffer), led, entries);
      expect(q.safety.ceMarking.status).toBe("missing");
      expect(q.provenance?.evidenceConflicts?.join(" ")).toMatch(/CE-Kennzeichnung widersprechen sich/);
    }
    const stock = (value: number) => proof("fulfillment.stock", value);
    const [q] = quotesFor(storeWith(offer({ stock: undefined })), STAND, [stock(0), stock(400)]);
    expect(q.fulfillment.stock.status).toBe("missing");
  });

  it("verwirft Identitäts- und Sicherheitsnachweise, wenn der Lieferant den Artikel seither geändert hat", () => {
    const old = offer();
    const changed: StoredOffer = {
      ...offer({ title: "Laptopständer Kunststoff (neues Modell)", brand: "NoName" }),
      history: [{ data: old.data, provenance: old.provenance, replacedAt: "2026-10-20T10:00:00.000Z", replacedByImportId: "imp-2" }],
    };
    const before = FULL_EVIDENCE.map((e) => ({ ...e, checkedAt: "2026-10-01" }));
    const o = importedOf(storeWith(changed), before);
    expect(o.eligible).toBe(false);
    expect(o.source).toBe("real_unverified");
    expect(o.warnings.join(" ")).toMatch(/nicht nach der Artikeländerung vom 2026-10-20 geprüft/);
    expect(o.exclusions.join(" ")).toMatch(/Verantwortliche Person in der EU \(GPSR\) fehlt/);
    // Nach erneuter Prüfung gilt der Nachweis wieder
    const after = FULL_EVIDENCE.map((e) => ({ ...e, checkedAt: "2026-10-25" }));
    expect(importedOf(storeWith(changed), after).source).toBe("real_verified");
    // Nachweis vom Tag der Änderung (Berliner Zeit) gilt nicht – 23:30 UTC ist in Berlin schon der Folgetag
    const lateNight: StoredOffer = { ...changed, history: [{ ...changed.history[0], replacedAt: "2026-10-25T23:30:00.000Z" }] };
    const sameDay = FULL_EVIDENCE.map((e) => ({ ...e, checkedAt: "2026-10-26" }));
    expect(importedOf(storeWith(lateNight), sameDay).source).toBe("real_unverified");
    const nextDay = FULL_EVIDENCE.map((e) => ({ ...e, checkedAt: "2026-10-27" }));
    expect(importedOf(storeWith(lateNight), nextDay).source).toBe("real_verified");
    // Reine Preisänderung ist keine Artikeländerung
    const priceOnly: StoredOffer = { ...offer(), history: [{ ...changed.history[0], data: { ...old.data, unitPrice: 9.9 } }] };
    expect(importedOf(storeWith(priceOnly), before).source).toBe("real_verified");
  });

  it("schließt Angebote aus, die in der letzten Liste des Lieferanten fehlen oder dort abgelehnt wurden", () => {
    const log = (importId: string, importedAt: string) => ({
      importId,
      importedAt,
      file: `${importId}.csv`,
      fileSha256: importId,
      synthetic: false,
      confirmationCode: importId,
      counts: { new: 0, changed: 0, unchanged: 0, rejected: 0, notInFile: 0 },
    });
    const imports = [log("imp-1", "2026-10-01T10:00:00.000Z"), log("imp-2", "2026-10-20T10:00:00.000Z")];
    const current = { ...offer({ supplierSku: "GB-OTHER", gtin: "2000000000992" }), key: "grosshandel-beispiel::GB-OTHER", lastSeenImportId: "imp-2" };
    const stale = { ...offer(), lastSeenImportId: "imp-1" };
    const store: OfferStore = { version: 1, offers: { [stale.key]: stale, [current.key]: current }, imports };
    expect([...outdatedOfferKeys(store)]).toEqual([KEY]);
    const o = importedOf(store, FULL_EVIDENCE);
    expect(o.eligible).toBe(false);
    expect(o.exclusions.join(" ")).toMatch(/Nicht in der aktuellen Preisliste/);
    // Andere Lieferanten sind davon nicht betroffen
    const other = { ...offer({ supplierId: "anderer", supplierName: "Anderer" }), key: "anderer::GB-STAND-1", lastSeenImportId: "imp-1" };
    expect(outdatedOfferKeys({ ...store, offers: { ...store.offers, [other.key]: other } }).has(other.key)).toBe(false);
  });
});

describe("Scout: Finanzierung importierter Angebote", () => {
  const base = (evidence: EvidenceEntry[], data: Partial<ImportedOfferData> = {}) => {
    const [quote] = quotesFor(storeWith(offer(data)), STAND, evidence);
    const cost = { unitPrice: 9.5, shippingCost: 3.5, importCost: 0, perUnit: 13, total: 13 };
    return { quote, financing: assessFinancing(quote), cost };
  };
  const ctx = (c: Partial<FundingContext>): FundingContext => ({ availableFunds: 500, fundsVerified: true, fundsSource: "Kontoauszug", safetyReserve: 100, ...c });

  it("behauptet ohne Kontonachweis nie, dass die Mittel reichen", () => {
    const f = assessFunding(base([]));
    expect(f.status).toBe("prefinancing_funds_unverified");
    expect(f.fundsVerified).toBe(false);
    expect(f.details.join(" ")).toMatch(/nicht nachgewiesen/);
  });

  it("rechnet mit dem Mindestbestellwert und der Sicherheitsreserve", () => {
    expect(assessFunding(base([]), ctx({})).status).toBe("prefinancing_within_funds");
    const big = assessFunding(base([], { minOrderValue: 450 }), ctx({}));
    expect(big).toMatchObject({ status: "prefinancing_exceeds_funds", upfrontAmount: 450, headroom: 400 });
    expect(assessFunding(base([], { minOrderValue: undefined }), ctx({})).details.join(" ")).toMatch(/Mindestbestellwert unbekannt/);
  });

  it("wertet ein nur angegebenes Zahlungsziel als Vorfinanzierung", () => {
    const stated = base([], { paymentTerms: { kind: "net_terms", days: 30 } });
    expect(stated.financing.status).toBe("payment_terms_unconfirmed");
    expect(assessFunding(stated, ctx({})).status).not.toBe("no_prefinancing");
  });

  it("erkennt Vorfinanzierungsfreiheit nur bei belegtem, sofort nutzbarem Zahlungsziel", () => {
    const proven = base(
      [proof("payment.terms", { kind: "net_terms", days: 30 }), proof("payment.requiresBusinessVerification", false)],
      { paymentTerms: { kind: "net_terms", days: 30 } },
    );
    expect(proven.financing.status).toBe("payment_terms_confirmed");
    expect(assessFunding(proven).status).toBe("no_prefinancing");
  });
});

describe("Scout: Demo-Daten und Kalkulationsbasis bleiben unverändert", () => {
  const SHOPIFY_COSTS: Record<string, number> = { "p-led": 11.6, "p-stand": 15.1, "p-cable": 3.9, "p-bottle": 8.5, "p-band": 4.4 };

  it("ein billigeres, aber ungeprüftes echtes Angebot ändert die Kalkulationsbasis nicht", () => {
    testSupplierData.store = storeWith(offer({ unitPrice: 1 }));
    for (const a of getProductAnalyses()) expect(a.best?.landedCost, a.product.id).toBe(SHOPIFY_COSTS[a.product.id]);
    const stand = getProductAnalyses().find((a) => a.product.id === "p-stand")!;
    expect([...stand.scout.eligible, ...stand.scout.excluded].some((e) => e.quote.adapterId === "price-list")).toBe(false);
  });

  it("ordnet eine echte Preislistenzeile mit Demo-GTIN keinem Demo-Produkt zu (Paket I) – auch nicht vollständig belegt", async () => {
    const demoGtinEvidence = FULL_EVIDENCE.map((e) => ({ ...e, productGtin: DEMO_STAND.gtin }));
    testSupplierData.store = storeWith(offer({ gtin: DEMO_STAND.gtin, unitPrice: 1 }));
    testSupplierData.evidence = demoGtinEvidence;
    for (const a of getProductAnalyses()) {
      expect(a.best?.landedCost, a.product.id).toBe(SHOPIFY_COSTS[a.product.id]);
      expect([...a.scout.eligible, ...a.scout.excluded].some((e) => e.quote.adapterId === "price-list"), a.product.id).toBe(false);
    }
    for (const { report } of await getSupplierScoutReports()) {
      expect(report.adapters.find((a) => a.adapterId === "price-list")?.quoteCount ?? 0).toBe(0);
    }
    expect(priceListQuotesFor(testSupplierData.store, DEMO_STAND, demoGtinEvidence)).toEqual([]);
    expect(await createPriceListAdapter(testSupplierData.store, demoGtinEvidence).findQuotes(DEMO_STAND)).toEqual([]);
  });

  it("liefert Demo- und Preislisten-Angebote über dieselbe Adapter-Schnittstelle", async () => {
    // Demo-Weg: nur synthetische Testdaten erreichen Demo-Produkte
    testSupplierData.store = storeWith(offer({ gtin: DEMO_STAND.gtin }, true));
    const reports = await getSupplierScoutReports();
    const stand = reports.find((r) => r.product.id === "p-stand")!.report;
    expect(stand.adapters.find((a) => a.adapterId === "price-list")).toMatchObject({ status: "ok", quoteCount: 1 });
    expect([...stand.eligible, ...stand.excluded].filter((e) => e.quote.adapterId === "price-list")).toHaveLength(1);
    expect(stand.eligible.some((e) => e.quote.demo)).toBe(true);
  });

  it("zeigt den Importstand ohne Preise und zählt nicht zugeordnete Angebote", () => {
    // Echte Zeile ohne Katalog und synthetische Zeile ohne Demo-GTIN: beide ohne Zuordnung
    testSupplierData.store = storeWith(offer(), { ...offer({ gtin: "2000000000992" }, true), key: "x::1" });
    expect(getSupplierImportStatus()).toEqual({ offers: 2, synthetic: 1, unassigned: 2, lastImport: null, evidenceEntries: 0, errors: [] });
    // Synthetische Zeile mit Demo-GTIN gilt als zugeordnet; eine echte Zeile mit Demo-GTIN nie
    testSupplierData.store = storeWith({ ...offer({ gtin: DEMO_STAND.gtin }, true), key: "x::2" }, { ...offer({ gtin: DEMO_STAND.gtin }), key: "x::3" });
    expect(getSupplierImportStatus().unassigned).toBe(1);
  });
});

describe("Scout: Nachweise für Katalogvarianten und neue Felder (Paket B)", () => {
  /** NUR TEST: gültige GS1-Prüfziffer an eine fiktive Ziffernfolge anhängen. */
  const gtin = (body: string) => {
    const sum = body.split("").map(Number).reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    return `${body}${(10 - (sum % 10)) % 10}`;
  };
  const G = gtin("401234500001"); // NUR TEST
  const catalogQuery = (o: Partial<typeof STAND> = {}) => ({ ...STAND, productId: "catalog:kk", title: "Kabelkanal", ...o });

  it("wendet productKey-Nachweise nur auf das Ziel ohne GTIN an", () => {
    const noGtin = catalogQuery({ gtin: undefined, productKey: "cat:kk:KK-1" });
    const byKey: EvidenceEntry = { ...proof("identity.match", "exact"), productGtin: undefined, productKey: "cat:kk:KK-1" };
    const s = storeWith(offer({ gtin: undefined, mpn: "KK-1" }));
    const [q] = priceListQuotesFor(s, noGtin, [byKey], { allowReal: true, target: { shopSku: "KK-1", supplierOffers: [KEY], mpn: "KK-1" } });
    expect(q.identity.match).toMatchObject({ status: "confirmed", value: "exact" });
    // Anderer Varianten-Schlüssel oder Ziel mit GTIN: nicht angewendet
    const [other] = priceListQuotesFor(s, { ...noGtin, productKey: "cat:kk:KK-2" }, [byKey], { allowReal: true, target: { shopSku: "KK-2", supplierOffers: [KEY], mpn: "KK-1" } });
    expect(other.identity.match.status).not.toBe("confirmed");
    const withGtin = storeWith(offer({ gtin: G }));
    const [g] = priceListQuotesFor(withGtin, catalogQuery({ gtin: G, productKey: "cat:kk:KK-1" }), [byKey], { allowReal: true });
    expect(g.identity.match.status).not.toBe("confirmed");
  });

  it("wendet einen GTIN-Nachweis in anderer Schreibweise derselben Nummer an", () => {
    const s = storeWith(offer({ gtin: G }));
    const [q] = priceListQuotesFor(s, catalogQuery({ gtin: G }), [proof("identity.match", "exact", `0${G}`)], { allowReal: true });
    expect(q.identity.match.status).toBe("confirmed");
  });

  it("macht den Identitätsnachweis ungültig, wenn sich die Variantenkennung ändert", () => {
    const old = offer({ variantLabel: "Schwarz" });
    const changed: StoredOffer = {
      ...offer({ variantLabel: "Weiß" }),
      history: [{ data: old.data, provenance: old.provenance, replacedAt: "2026-10-20T10:00:00.000Z", replacedByImportId: "imp-2" }],
    };
    const evidence = [{ ...proof("identity.match", "exact"), checkedAt: "2026-10-10" }];
    expect(quotesFor(storeWith(old), STAND, evidence)[0].identity.match.status).toBe("confirmed");
    const [q] = quotesFor(storeWith(changed), STAND, evidence);
    expect(q.identity.match.status).not.toBe("confirmed");
    expect(q.provenance?.evidenceConflicts?.join(" ")).toMatch(/Artikeländerung/);
  });

  it("bestätigt Marke, Mindestbestellmenge, Kreditrahmen und Retourenabwicklung nur per Nachweis", () => {
    const s = storeWith(offer({ brand: "Kabelwerk", minOrderQuantity: 1 }));
    const [stated] = quotesFor(s, STAND);
    expect(stated.payment.creditLimit.status).toBe("missing");
    expect(stated.dropshipping.returnsHandledBy.status).toBe("missing");
    expect(factLevel(stated.identity.brand)).toBe("supplier_stated");
    const [q] = quotesFor(s, STAND, [
      proof("identity.brand", "Kabelwerk"),
      proof("pricing.minOrderQuantity", 1),
      proof("payment.creditLimit", 250),
      proof("dropshipping.returnsHandledBy", "supplier"),
    ]);
    expect(q.identity.brand).toMatchObject({ status: "confirmed", value: "Kabelwerk" });
    expect(q.pricing.minOrderQuantity).toMatchObject({ status: "confirmed", value: 1 });
    expect(q.payment.creditLimit).toMatchObject({ status: "confirmed", value: 250 });
    expect(q.dropshipping.returnsHandledBy).toMatchObject({ status: "confirmed", value: "supplier" });
    // Widerspricht der Nachweis der Preisliste (andere Marke), gilt er nicht
    const [conflict] = quotesFor(s, STAND, [proof("identity.brand", "Andere Marke")]);
    expect(conflict.identity.brand.status).toBe("unconfirmed");
  });
});
