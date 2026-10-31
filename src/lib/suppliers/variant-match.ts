// Variantenzuordnung: Welche importierten Preislisten-Angebote gehören zu GENAU einer Katalogvariante?
//
// Rein und fail-closed. Lieber „keine Zuordnung“ als eine falsche: Ein falsch zugeordnetes Angebot würde mit falschen
// Kosten, Unterlagen und Beständen in Kalkulation und Entwurf einfließen.
// - Veraltete (in der letzten Liste des Lieferanten fehlende) und synthetische Angebote werden ignoriert.
// - Angebote mit einer GTIN, die nicht global eindeutig ist (identity.ts), zählen wie Angebote ohne GTIN – mit Hinweis.
// - Höchstens ein Angebot je Lieferant; mehrere Artikelnummern eines Lieferanten für dieselbe Variante = mehrdeutig.
//
// `matched` ist NUR eine Zuordnung. Kalkulationsbasis wird ein Angebot erst nach der Eignungsprüfung (checkEligibility),
// also mit bestätigter Identität (`identity.match` = exact) oder bestätigter GTIN über den Nachweisweg.

import type { ReasonCode } from "@/lib/market/reasons";
import { gtinClass, GTIN_CLASS_LABELS, normalizeMpn, sameGtin, sameGtinDigits } from "./identity";
import type { StoredOffer } from "./import/types";

/** Ziel der Zuordnung: eine Variante des lokalen Zielproduktkatalogs (market/catalog.ts). */
export interface VariantTarget {
  shopSku: string;
  gtin?: string;
  /** Angebots-Schlüssel "supplierId::supplierSku" – Pflicht ohne GTIN */
  supplierOffers?: string[];
  mpn?: string;
  brand?: string;
  /** Variantenkennung laut Lieferant – Pflicht ohne GTIN, wenn keine MPN */
  label?: string;
}

/**
 * Worüber eine Variante zugeordnet ist:
 * - gtin               – global eindeutige GTIN
 * - supplier_sku_mpn   – benannte Lieferanten-Artikelnummer + gleiche Herstellernummer (MPN)
 * - supplier_sku_label – benannte Lieferanten-Artikelnummer + gleiche Variantenkennung
 * - demo_product_level – Demo-Produkt: eine Abfrage auf Produktebene für alle Listing-Varianten
 */
export type MatchBasis = "gtin" | "supplier_sku_mpn" | "supplier_sku_label" | "demo_product_level";

export type VariantMatch =
  /** Höchstens ein Angebot je Lieferant; `hints` nennt ausgelassene (z. B. mehrdeutige) Lieferanten */
  | { status: "matched"; basis: MatchBasis; offerKeys: string[]; hints: string[] }
  | { status: "ambiguous" | "none" | "conflict"; code: ReasonCode; message: string; offerKeys: string[] };

const sorted = (keys: Iterable<string>) => [...new Set(keys)].sort();
const sameLabel = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";

/** Ordnet die gespeicherten Angebote einer Katalogvariante zu (Regeln siehe Dateikopf und docs/MARKET-SCOUT.md). */
export function matchVariant(target: VariantTarget, offers: StoredOffer[], outdated: Set<string>): VariantMatch {
  const usable = offers.filter((o) => !outdated.has(o.key) && o.provenance.synthetic !== true);
  const byKey = new Map(usable.map((o) => [o.key, o]));
  const named = target.supplierOffers ?? [];
  const hints: string[] = [];

  // 1. Mit GTIN: alle Angebote mit derselben global eindeutigen GTIN
  if (target.gtin !== undefined) {
    if (gtinClass(target.gtin) !== "global") {
      return { status: "none", code: "IDENTITY_MISSING", message: `GTIN ${target.gtin} der Variante ${target.shopSku}: ${GTIN_CLASS_LABELS[gtinClass(target.gtin)]}.`, offerKeys: [] };
    }
    // Benannte Angebote müssen dieselbe Nummer tragen – sonst widersprechen sich Katalog und Preisliste.
    for (const key of named) {
      const o = byKey.get(key);
      if (!o) {
        hints.push(`Angebot ${key} ist nicht (mehr) in den Preislisten – ignoriert.`);
        continue;
      }
      if (o.data.gtin !== undefined && !sameGtinDigits(o.data.gtin, target.gtin)) {
        return { status: "conflict", code: "IDENTITY_CONFLICT", message: `Angebot ${key} nennt GTIN ${o.data.gtin}, der Katalog ${target.gtin} (Variante ${target.shopSku}).`, offerKeys: [key] };
      }
      if (o.data.gtin !== undefined && gtinClass(o.data.gtin) !== "global") {
        hints.push(`Angebot ${key}: GTIN ${o.data.gtin} – ${GTIN_CLASS_LABELS[gtinClass(o.data.gtin)]}; zählt wie ein Angebot ohne GTIN.`);
      }
    }
    const hits = usable.filter((o) => sameGtin(o.data.gtin, target.gtin));
    const bySupplier = new Map<string, StoredOffer[]>();
    for (const o of hits) bySupplier.set(o.data.supplierId, [...(bySupplier.get(o.data.supplierId) ?? []), o]);
    const ambiguous = [...bySupplier].filter(([, list]) => list.length > 1);
    const unique = [...bySupplier].filter(([, list]) => list.length === 1).map(([, [o]]) => o.key);
    for (const [supplierId, list] of ambiguous.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      hints.push(`Lieferant ${supplierId} führt ${list.length} Artikel mit derselben GTIN (${sorted(list.map((o) => o.key)).join(", ")}) – mehrdeutig, ausgelassen.`);
    }
    if (unique.length > 0) return { status: "matched", basis: "gtin", offerKeys: sorted(unique), hints };
    if (ambiguous.length > 0) {
      return { status: "ambiguous", code: "IDENTITY_AMBIGUOUS", message: hints.join(" "), offerKeys: sorted(ambiguous.flatMap(([, list]) => list.map((o) => o.key))) };
    }
    return { status: "none", code: "IDENTITY_NO_OFFER", message: `Kein aktuelles Angebot mit GTIN ${target.gtin} (Variante ${target.shopSku}).`, offerKeys: [] };
  }

  // 2. Ohne GTIN: nur die benannten Angebote, jedes muss existieren und zur MPN bzw. Variantenkennung passen
  if (named.length === 0 || (target.mpn === undefined && target.label === undefined)) {
    return {
      status: "none",
      code: "IDENTITY_NO_OFFER",
      message: `Variante ${target.shopSku} ohne GTIN: Angebots-Schlüssel UND MPN oder Variantenkennung nötig.`,
      offerKeys: [],
    };
  }
  const missingKeys = named.filter((k) => !byKey.has(k));
  if (missingKeys.length > 0) {
    return {
      status: "none",
      code: "IDENTITY_NO_OFFER",
      message: `Angebot ${sorted(missingKeys).join(", ")} nicht (mehr) in den aktuellen Preislisten (Variante ${target.shopSku}).`,
      offerKeys: sorted(missingKeys),
    };
  }
  const offersNamed = sorted(named).map((k) => byKey.get(k)!);
  const perSupplier = new Map<string, string[]>();
  for (const o of offersNamed) perSupplier.set(o.data.supplierId, [...(perSupplier.get(o.data.supplierId) ?? []), o.key]);
  const doubled = [...perSupplier].filter(([, keys]) => keys.length > 1);
  if (doubled.length > 0) {
    return {
      status: "ambiguous",
      code: "IDENTITY_AMBIGUOUS",
      message: `Mehrere Artikel desselben Lieferanten für Variante ${target.shopSku}: ${doubled.map(([, keys]) => keys.join(", ")).join("; ")}.`,
      offerKeys: sorted(doubled.flatMap(([, keys]) => keys)),
    };
  }
  for (const o of offersNamed) {
    // Nennt der Lieferant eine global eindeutige GTIN, gehört sie in den Katalog – Zuordnung dann über die GTIN.
    if (o.data.gtin !== undefined && gtinClass(o.data.gtin) === "global") {
      return {
        status: "conflict",
        code: "IDENTITY_GTIN_AVAILABLE",
        message: `Angebot ${o.key} nennt GTIN ${o.data.gtin} – im Katalog bei Variante ${target.shopSku} nachtragen.`,
        offerKeys: [o.key],
      };
    }
    if (o.data.gtin !== undefined) hints.push(`Angebot ${o.key}: GTIN ${o.data.gtin} – ${GTIN_CLASS_LABELS[gtinClass(o.data.gtin)]}; zählt wie ein Angebot ohne GTIN.`);
    const fits = target.mpn !== undefined ? normalizeMpn(o.data.mpn) !== undefined && normalizeMpn(o.data.mpn) === normalizeMpn(target.mpn) : sameLabel(o.data.variantLabel, target.label);
    if (!fits) {
      const what = target.mpn !== undefined ? `MPN ${o.data.mpn ?? "fehlt"} statt ${target.mpn}` : `Variantenkennung „${o.data.variantLabel ?? "fehlt"}“ statt „${target.label}“`;
      return { status: "conflict", code: "IDENTITY_CONFLICT", message: `Angebot ${o.key} passt nicht zu Variante ${target.shopSku}: ${what}.`, offerKeys: [o.key] };
    }
  }
  return { status: "matched", basis: target.mpn !== undefined ? "supplier_sku_mpn" : "supplier_sku_label", offerKeys: sorted(named), hints };
}
