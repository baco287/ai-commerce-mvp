// Baut vollständige Angebote aus wenigen Abweichungen – für Demo-Daten und Tests.
// Ausgangspunkt ist ein in allen Punkten bestätigtes, geeignetes Angebot aus Deutschland.
// Echte Adapter bauen ihre Angebote selbst aus den Lieferantendaten.

import { confirmed, type SupplierQuote } from "./model";

export const DEMO_SOURCE = "Demo-Datenblatt (fiktiv)";
export const DEMO_CHECKED_AT = "2026-10-01T08:00:00.000Z";

/** Bestätigte Angabe aus dem (fiktiven) Demo-Datenblatt. */
export const ok = <T>(value: T) => confirmed(value, DEMO_SOURCE, DEMO_CHECKED_AT);

type Sections = "identity" | "safety" | "pricing" | "fulfillment" | "dropshipping" | "payment" | "reliability";

export type QuoteOverrides = Partial<Omit<SupplierQuote, Sections>> & { [K in Sections]?: Partial<SupplierQuote[K]> } & {
  id: string;
  supplierName: string;
};

export function buildQuote(o: QuoteOverrides): SupplierQuote {
  const base: SupplierQuote = {
    id: o.id,
    adapterId: "demo",
    supplierId: o.id,
    supplierName: o.supplierName,
    productId: "p-test",
    demo: true,
    identity: { supplierSku: `SKU-${o.id}`, title: "Testprodukt", gtin: ok("2000000000015"), mpn: ok("MPN-1"), brand: ok("Demo"), match: ok("exact") },
    safety: {
      ceMarking: ok(true),
      euResponsiblePerson: ok("Demo Verantwortliche GmbH (fiktiv)"),
      safetyInformationDe: ok(true),
      openIssues: [],
      documents: ["Konformitätserklärung (Demo)"],
    },
    pricing: { unitPrice: ok(10), shippingCost: ok(3), importCost: ok(0), minOrderQuantity: ok(1), minOrderValue: ok(0) },
    fulfillment: { shipsFrom: ok("DE"), deliversToDestination: ok(true), deliveryDays: ok({ min: 2, max: 4 }), stock: ok(500), tracking: ok(true) },
    dropshipping: { supported: ok(true), blindShipping: ok(true), orderChannel: ok("portal"), returnsHandledBy: ok("supplier") },
    payment: { terms: ok({ kind: "net_terms", days: 30 }), methods: ok(["invoice"]), creditLimit: ok(500), requiresBusinessVerification: ok(false) },
    reliability: { rating: ok(4.6), onTimeRate: ok(0.95), defectRate: ok(0.01), sampleTested: ok(true) },
    retrievedAt: DEMO_CHECKED_AT,
  };
  return {
    ...base,
    ...o,
    identity: { ...base.identity, ...o.identity },
    safety: { ...base.safety, ...o.safety },
    pricing: { ...base.pricing, ...o.pricing },
    fulfillment: { ...base.fulfillment, ...o.fulfillment },
    dropshipping: { ...base.dropshipping, ...o.dropshipping },
    payment: { ...base.payment, ...o.payment },
    reliability: { ...base.reliability, ...o.reliability },
  };
}
