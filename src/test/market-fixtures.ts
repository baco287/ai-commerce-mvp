// NUR TEST: synthetische Daten für die Tests von Journal, Schwärzung, Speicher und Befehl der Market-Pipeline.
// GTINs fiktiv mit gültiger Prüfziffer, Lieferant und Katalog erfunden. Echte Daten gehören nie ins Repository.

import { emptyOfferStore, type EvidenceEntry, type EvidenceField, type ImportedOfferData, type StoredOffer } from "@/lib/suppliers/import";
import type { CatalogProduct } from "@/lib/market/catalog";
import type { MarketCandidate, MarketSignal } from "@/lib/market/model";
import { testSupplierData } from "./setup";

/** NUR TEST: gültige GS1-Prüfziffer an eine fiktive Ziffernfolge anhängen. */
export function testGtin(body: string): string {
  const sum = body
    .split("")
    .map(Number)
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}
export const G1 = testGtin("401234500001");

/** Echtes (nicht-synthetisches) Preislisten-Angebot im Speicher, Zahlungsziel 30 Tage. Einkaufspreis 4,37 € (auffällig). */
export function realOffer(data: Partial<ImportedOfferData> = {}): StoredOffer {
  return {
    key: "lieferant-a::KK-SKU-1",
    data: {
      supplierId: "lieferant-a",
      supplierName: "Lieferant A",
      supplierSku: "KK-SKU-1",
      title: "Kabelkanal",
      brand: "Kabelfix",
      gtin: G1,
      unitPrice: 4.37,
      currency: "EUR",
      shippingCostDe: 3.19,
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

/** Alle kritischen Angaben belegt, inkl. Marke, Einzelstückbezug und Kreditrahmen. */
export function fullEvidence(o: StoredOffer): EvidenceEntry[] {
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
    e("payment.creditLimit", 777),
    e("fulfillment.shipsFrom", "DE"),
    e("fulfillment.deliversToDestination", true),
    e("fulfillment.deliveryDays", o.data.deliveryDays),
    e("fulfillment.stock", o.data.stock),
    e("payment.terms", o.data.paymentTerms),
    e("payment.requiresBusinessVerification", false),
  ];
}

/** Synthetisches Katalogprodukt mit vollständigen Shop-Angaben. */
export const catalogProduct = (): CatalogProduct => ({
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

export const realSignal = (retrievedAt = "2026-10-29T08:00:00.000Z"): MarketSignal => ({
  sourceId: "wikimedia-pageviews",
  sourceName: "Wikipedia",
  kind: "public_interest",
  demo: false,
  retrievedAt,
  reference: "https://de.wikipedia.org/wiki/Kabelkanal",
  interest: { avg7: 250, avg30: 250, trend7: 0.2, trend30: 0.3, seasonalIndex: 1.1, days: 400, lastDate: "2026-10-28" },
});

export const catalogCandidate = (signals: MarketSignal[]): MarketCandidate => ({
  key: "catalog:kabelkanal",
  title: "Kabelkanal selbstklebend",
  category: "Büromaterial",
  catalogId: "kabelkanal",
  discoveredVia: "Test",
  demo: false,
  signals,
});

/** Legt das vollständig belegte echte Angebot in den Test-Speicher (setup.ts). */
export function withFullRealOffer(): StoredOffer {
  const o = realOffer();
  testSupplierData.store = { ...emptyOfferStore(), offers: { [o.key]: o } };
  testSupplierData.evidence = fullEvidence(o);
  return o;
}

export function resetSupplierData() {
  testSupplierData.store = emptyOfferStore();
  testSupplierData.evidence = [];
}

/** Katalogdatei-Inhalt (JSON) für Tests mit Temp-Verzeichnis. */
export const catalogFileContent = () => `${JSON.stringify([catalogProduct()], null, 2)}\n`;
