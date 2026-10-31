// Lieferanten-Adapter über importierte Preislisten – nutzt die bestehende SupplierAdapter-Schnittstelle.
// Lokal, kostenlos, ohne Netzwerk; liefert nur Angebote, bestellt nie.
//
// Zwei getrennte Wege (`allowReal`):
// - false (Demo-/Testweg): NUR synthetische Angebote, Zuordnung über `sameDemoGtin` (Abfrage aus DEMO_QUERIES und
//   synthetisches Angebot). Echte Preislistenzeilen erreichen Demo-Produkte so nie – auch nicht über Demo-GTINs.
// - true (echter Weg): NUR nicht-synthetische Angebote. Mit `target` (Katalogvariante) über `matchVariant`, sonst
//   über eine global eindeutige GTIN (`sameGtin`) – Demo-GTINs ergeben dort nie einen Treffer.
// - nicht angegeben: wie false (Demo-/Testweg) – fail-closed. Echte Angebote gibt es nur mit ausdrücklichem
//   `allowReal: true` (Katalogkandidaten der Market-Pipeline). Paket I: Das frühere Übergangsverhalten (echte Zeilen
//   mit Demo-GTIN passten zu Demo-Produkten) ist entfallen.

import type { SupplierAdapter } from "../adapter";
import { sameDemoGtin, sameGtin } from "../identity";
import type { ProductQuery, SupplierQuote } from "../model";
import { matchVariant, type MatchBasis, type VariantMatch, type VariantTarget } from "../variant-match";
import type { EvidenceEntry } from "./evidence";
import { PRICE_LIST_ADAPTER_ID, storedOfferToQuote, type OfferMatchedBy } from "./to-quote";
import type { OfferStore } from "./types";

export interface PriceListOptions {
  /** true = nur echte Angebote; false bzw. fehlt = nur synthetische (Demo-/Testweg) */
  allowReal?: boolean;
  /** Katalogvariante – Zuordnung über GTIN bzw. Artikelnummer + MPN/Variantenkennung (nur mit allowReal: true) */
  target?: VariantTarget;
}

export function createPriceListAdapter(store: OfferStore, evidence: EvidenceEntry[] = [], opts: Pick<PriceListOptions, "allowReal"> = {}): SupplierAdapter {
  return {
    info: { id: PRICE_LIST_ADAPTER_ID, name: "Importierte Preislisten (lokal)", kind: "manual", paid: false, network: false },
    // Zuordnung ausschließlich über die Produktidentität – Suchbegriffe ersetzen nie die Identitätsprüfung.
    findQuotes: async (query) => priceListQuotesFor(store, query, evidence, opts),
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

const MATCHED_BY: Record<MatchBasis, OfferMatchedBy | undefined> = {
  gtin: "gtin",
  supplier_sku_mpn: "mpn",
  supplier_sku_label: "label",
  demo_product_level: undefined,
};

/**
 * Zuordnung UND Angebote einer Katalogvariante (echter Weg): `match` sagt, ob und worüber zugeordnet wurde; `quotes`
 * enthält nur die zugeordneten, aktuellen, nicht-synthetischen Angebote (bei fehlender Zuordnung leer).
 */
export function priceListVariantQuotes(
  store: OfferStore,
  query: ProductQuery,
  evidence: EvidenceEntry[],
  target: VariantTarget,
): { match: VariantMatch; quotes: SupplierQuote[] } {
  const outdated = outdatedOfferKeys(store);
  const match = matchVariant(target, Object.values(store.offers), outdated);
  if (match.status !== "matched") return { match, quotes: [] };
  const quotes = match.offerKeys.map((key) => storedOfferToQuote(store.offers[key], query, evidence, { matchedBy: MATCHED_BY[match.basis] }));
  return { match, quotes };
}

/** Synchrone Variante für die Produktanalyse (gleiche Zuordnung wie der Adapter). */
export function priceListQuotesFor(store: OfferStore, query: ProductQuery, evidence: EvidenceEntry[] = [], opts: PriceListOptions = {}): SupplierQuote[] {
  const outdated = outdatedOfferKeys(store);
  const all = Object.values(store.offers);
  const toQuote = (o: (typeof all)[number]) => storedOfferToQuote(o, query, evidence, { outdated: outdated.has(o.key) });
  if (opts.allowReal === true) {
    if (opts.target) return priceListVariantQuotes(store, query, evidence, opts.target).quotes;
    return all.filter((o) => o.provenance.synthetic !== true && query.gtin !== undefined && sameGtin(o.data.gtin, query.gtin)).map(toQuote);
  }
  // Demo-/Testweg (Standard): nur synthetische Angebote, nur zu Demo-Abfragen
  return all.filter((o) => sameDemoGtin(query, o)).map(toQuote);
}
