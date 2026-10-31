// Lieferanten-Adapter über importierte Preislisten – nutzt die bestehende SupplierAdapter-Schnittstelle.
// Lokal, kostenlos, ohne Netzwerk; liefert nur Angebote, bestellt nie.

import type { SupplierAdapter } from "../adapter";
import type { ProductQuery, SupplierQuote } from "../model";
import type { EvidenceEntry } from "./evidence";
import { PRICE_LIST_ADAPTER_ID, storedOfferToQuote } from "./to-quote";
import type { OfferStore } from "./types";

export function createPriceListAdapter(store: OfferStore, evidence: EvidenceEntry[] = []): SupplierAdapter {
  return {
    info: { id: PRICE_LIST_ADAPTER_ID, name: "Importierte Preislisten (lokal)", kind: "manual", paid: false, network: false },
    // Zuordnung ausschließlich über die GTIN – Suchbegriffe ersetzen nie die Identitätsprüfung.
    findQuotes: async (query) => priceListQuotesFor(store, query, evidence),
  };
}

/**
 * Angebote, die im letzten übernommenen Import ihres Lieferanten fehlten oder dort abgelehnt wurden. Sie bleiben
 * gespeichert (nichts wird gelöscht), gelten aber nicht mehr als aktuell.
 */
export function outdatedOfferKeys(store: OfferStore): Set<string> {
  const order = new Map(store.imports.map((imp, i) => [imp.importId, i]));
  const seen = (key: string) => order.get(store.offers[key].lastSeenImportId) ?? -1;
  const latestBySupplier = new Map<string, number>();
  const bump = (supplierId: string, index: number) => latestBySupplier.set(supplierId, Math.max(latestBySupplier.get(supplierId) ?? -1, index));
  for (const o of Object.values(store.offers)) bump(o.data.supplierId, seen(o.key));
  // Auch Importe zählen, in denen alle Zeilen eines Lieferanten abgelehnt wurden.
  store.imports.forEach((imp, i) => imp.suppliers?.forEach((s) => bump(s, i)));
  return new Set(Object.values(store.offers).filter((o) => seen(o.key) < latestBySupplier.get(o.data.supplierId)!).map((o) => o.key));
}

/** Synchrone Variante für die Produktanalyse (gleiche Zuordnung wie der Adapter). */
export function priceListQuotesFor(store: OfferStore, query: ProductQuery, evidence: EvidenceEntry[] = []): SupplierQuote[] {
  const outdated = outdatedOfferKeys(store);
  return Object.values(store.offers)
    .filter((o) => query.gtin !== undefined && o.data.gtin === query.gtin)
    .map((o) => storedOfferToQuote(o, query, evidence, { outdated: outdated.has(o.key) }));
}
