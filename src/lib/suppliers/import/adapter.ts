// Lieferanten-Adapter über importierte Preislisten – nutzt die bestehende SupplierAdapter-Schnittstelle.
// Lokal, kostenlos, ohne Netzwerk; liefert nur Angebote, bestellt nie.

import type { SupplierAdapter } from "../adapter";
import type { ProductQuery, SupplierQuote } from "../model";
import type { EvidenceEntry } from "./evidence";
import { PRICE_LIST_ADAPTER_ID, storedOfferToQuote } from "./to-quote";
import type { OfferStore } from "./types";

export function createPriceListAdapter(store: OfferStore, evidence: EvidenceEntry[] = []): SupplierAdapter {
  const offers = Object.values(store.offers);
  return {
    info: { id: PRICE_LIST_ADAPTER_ID, name: "Importierte Preislisten (lokal)", kind: "manual", paid: false, network: false },
    // Zuordnung ausschließlich über die GTIN – Suchbegriffe ersetzen nie die Identitätsprüfung.
    findQuotes: async (query) => offers.filter((o) => query.gtin !== undefined && o.data.gtin === query.gtin).map((o) => storedOfferToQuote(o, query, evidence)),
  };
}

/** Synchrone Variante für die Produktanalyse (gleiche Zuordnung wie der Adapter). */
export function priceListQuotesFor(store: OfferStore, query: ProductQuery, evidence: EvidenceEntry[] = []): SupplierQuote[] {
  return Object.values(store.offers)
    .filter((o) => query.gtin !== undefined && o.data.gtin === query.gtin)
    .map((o) => storedOfferToQuote(o, query, evidence));
}
