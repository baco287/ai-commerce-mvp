// Übersetzt ein gespeichertes Preislisten-Angebot in das Supplier-Scout-Modell.
//
// - Jede Preislisten-Angabe ist „vom Lieferanten angegeben“ (unconfirmed, origin supplier) – nie „geprüft“.
// - Fehlende Angaben bleiben „fehlend“.
// - Produktsicherheit (CE, GPSR, Sicherheitshinweise), Bestellweg, Sendungsverfolgung und Zuverlässigkeit kann eine
//   Preisliste nicht belegen: Sie bleiben fehlend, bis ein unabhängiger Nachweis vorliegt (evidence.ts).

import { missing, supplierStated, type Fact, type PaymentMethod, type ProductQuery, type SupplierQuote } from "../model";
import { applyEvidence, type EvidenceEntry } from "./evidence";
import type { StoredOffer } from "./types";

export const PRICE_LIST_ADAPTER_ID = "price-list";

/** Identitätsmerkmale eines Artikels – ändern sie sich, gelten Identitäts- und Sicherheitsnachweise nicht mehr. */
const articleIdentity = (d: StoredOffer["data"]) => JSON.stringify([d.title, d.brand ?? null, d.mpn ?? null, d.gtin ?? null]);

/** Zeitpunkt der letzten Änderung des Artikels (laut Historie), undefined wenn seit dem ersten Import unverändert. */
export function articleChangedAt(offer: StoredOffer): string | undefined {
  const versions = [...offer.history.map((h) => h.data), offer.data];
  for (let i = offer.history.length - 1; i >= 0; i--) {
    if (articleIdentity(versions[i]) !== articleIdentity(versions[i + 1])) return offer.history[i].replacedAt;
  }
  return undefined;
}

export function storedOfferToQuote(
  offer: StoredOffer,
  query: ProductQuery,
  evidence: EvidenceEntry[] = [],
  options: { outdated?: boolean } = {},
): SupplierQuote {
  const d = offer.data;
  const p = offer.provenance;
  const source = `Preisliste ${d.supplierName}: ${p.file}, Zeile ${p.row}${d.supplierUpdatedAt ? `, Stand ${d.supplierUpdatedAt}` : ""}`;
  const stated = <T>(value: T | undefined): Fact<T> => (value === undefined ? missing<T>() : supplierStated(value, source));

  const methods: PaymentMethod[] | undefined =
    d.paymentTerms === undefined ? undefined : d.paymentTerms.kind === "prepayment" ? ["prepayment"] : ["invoice"];
  const gtinMatches = d.gtin !== undefined && d.gtin === query.gtin;

  const quote: SupplierQuote = {
    id: `${PRICE_LIST_ADAPTER_ID}:${offer.key}:${query.productId}`,
    adapterId: PRICE_LIST_ADAPTER_ID,
    supplierId: d.supplierId,
    supplierName: d.supplierName,
    productId: query.productId,
    // Synthetische Testdaten werden wie Demo-Daten behandelt – nie als echte Einkaufsgrundlage.
    demo: p.synthetic,
    identity: {
      supplierSku: d.supplierSku,
      title: d.title,
      gtin: stated(d.gtin),
      mpn: stated(d.mpn),
      brand: stated(d.brand),
      // Gleiche GTIN laut Lieferant ist ein Hinweis, kein Beleg – geprüft erst per Nachweis (z. B. Muster).
      match: gtinMatches ? supplierStated("exact", source) : missing(),
    },
    safety: {
      ceMarking: missing(),
      euResponsiblePerson: missing(),
      safetyInformationDe: missing(),
      openIssues: [],
      documents: [],
    },
    pricing: {
      unitPrice: stated(d.unitPrice),
      shippingCost: stated(d.shippingCostDe),
      importCost: missing(),
      minOrderQuantity: stated(d.minOrderQuantity),
      minOrderValue: stated(d.minOrderValue),
    },
    fulfillment: {
      shipsFrom: stated(d.shipsFrom),
      // Versandkosten nach DE angegeben → Lieferung nach DE laut Lieferant
      deliversToDestination: d.shippingCostDe !== undefined ? supplierStated(true, source) : missing(),
      deliveryDays: stated(d.deliveryDays),
      stock: stated(d.stock),
      tracking: missing(),
    },
    dropshipping: {
      supported: stated(d.dropshipping),
      blindShipping: stated(d.blindShipping),
      orderChannel: missing(),
      returnsHandledBy: missing(),
    },
    payment: {
      terms: stated(d.paymentTerms),
      methods: stated(methods),
      creditLimit: missing(),
      requiresBusinessVerification: missing(),
    },
    reliability: { rating: missing(), onTimeRate: missing(), defectRate: missing(), sampleTested: missing() },
    retrievedAt: p.importedAt,
    provenance: {
      kind: "price_list",
      dataSource: d.dataSource,
      file: p.file,
      fileSha256: p.fileSha256,
      row: p.row,
      importId: p.importId,
      importedAt: p.importedAt,
      supplierUpdatedAt: d.supplierUpdatedAt,
      synthetic: p.synthetic,
      ...(options.outdated ? { outdated: true } : {}),
    },
  };
  return applyEvidence(quote, offer.key, query.gtin, evidence, { articleChangedAt: articleChangedAt(offer) });
}
