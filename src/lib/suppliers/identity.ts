// GTIN-Kern: Normalisierung, Klassifikation und Vergleich von Produktkennungen. Rein, ohne Netzwerk und Dateizugriff.
//
// Grundsatz: Nur eine global eindeutige Einzelstück-GTIN (Klasse "global") belegt, dass zwei Angebote dasselbe
// Produkt meinen. Eingeschränkte Nummernkreise (Instore-/Demo-Nummern 200–299, Coupons, variable Mengen) und
// Umverpackungs-GTINs (Indikator 1–8 = Karton, verdeckte Mindestabnahme) ergeben nie eine Übereinstimmung.
// Alle GTIN-Vergleiche in src/lib/suppliers laufen über diese Datei – kein direkter Stringvergleich.

import { DEMO_QUERIES } from "./demo/demo-suppliers";
import type { ProductQuery } from "./model";
import type { StoredOffer } from "./import/types";

export type GtinClass = "global" | "restricted" | "trade_unit" | "invalid";

export const GTIN_CLASS_LABELS: Record<GtinClass, string> = {
  global: "global eindeutige Einzelstück-GTIN",
  restricted: "eingeschränkter Nummernkreis (intern, Coupon, variable Menge) – nicht global eindeutig",
  trade_unit: "Umverpackung (Indikator 1–8) – Einzelstück-GTIN nachtragen, sonst verdeckte Mindestabnahme",
  invalid: "keine gültige GTIN (Länge oder Prüfziffer)",
};

/** Prüfziffer nach GS1 (Modulo 10, Gewichte 3/1 von rechts) für die ersten n−1 Stellen. */
function checkDigitOk(digits: string): boolean {
  const body = digits.slice(0, -1).split("").map(Number).reverse();
  const sum = body.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/** 8/12/13/14 Ziffern mit gültiger Prüfziffer → 14 Stellen mit führenden Nullen; sonst null. */
export function normalizeGtin14(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return null;
  if (!checkDigitOk(s)) return null;
  return s.padStart(14, "0");
}

/** GS1-Präfixe (Stellen d2–d4 der GTIN-14), die nicht global eindeutig sind. */
function restrictedPrefix(prefix: number): boolean {
  return (
    (prefix >= 20 && prefix <= 29) || // UPC-Nummernsystem 2: variable Menge / intern
    (prefix >= 40 && prefix <= 49) || // UPC-Nummernsystem 4: interne Nummern
    (prefix >= 50 && prefix <= 59) || // UPC-Nummernsystem 5: Coupons
    (prefix >= 200 && prefix <= 299) || // Instore-Nummern (auch die Demo-GTINs)
    (prefix >= 980 && prefix <= 999) // Gutscheine, Coupons, Rückerstattungen
  );
}

/**
 * Klassifikation auf der normalisierten GTIN-14 d1 … d14:
 * - ungültig → invalid
 * - d1 in 1–8 (Indikator Umverpackung) → trade_unit
 * - d1 = 9 (variable Menge) → restricted
 * - d1 = 0, GTIN-8 (d2–d6 = 00000) mit d7 in {0, 2} → restricted
 * - d1 = 0, Präfix d2–d4 in 020–029, 040–049, 050–059, 200–299, 980–999 → restricted
 * - sonst global (ISBN/ISMN 978/979 bleiben global)
 */
export function gtinClass(raw: string | undefined): GtinClass {
  const g = normalizeGtin14(raw);
  if (g === null) return "invalid";
  const d1 = Number(g[0]);
  if (d1 >= 1 && d1 <= 8) return "trade_unit";
  if (d1 === 9) return "restricted";
  if (g.slice(1, 6) === "00000" && (g[6] === "0" || g[6] === "2")) return "restricted";
  if (restrictedPrefix(Number(g.slice(1, 4)))) return "restricted";
  return "global";
}

/** Nur "global" kann übereinstimmen; restricted/trade_unit/invalid ergeben nie true. */
export function sameGtin(a: string | undefined, b: string | undefined): boolean {
  if (gtinClass(a) !== "global" || gtinClass(b) !== "global") return false;
  return normalizeGtin14(a) === normalizeGtin14(b);
}

/**
 * Gleiche Nummer nach Normalisierung, OHNE Klassenprüfung. Kein Identitätsbeleg – nur für den Abgleich mit Demo-
 * Nummern und um Abweichungen festzustellen (13- und 14-stellige Schreibweise derselben Nummer gelten als gleich).
 * Ungültige Nummern werden getrimmt verglichen.
 */
export function sameGtinDigits(a: string | undefined, b: string | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const na = normalizeGtin14(a);
  const nb = normalizeGtin14(b);
  if (na !== null && nb !== null) return na === nb;
  return na === null && nb === null && a.trim() === b.trim();
}

/** Normalisierte GTINs der Demo-Produkte (fiktiv, Präfix 200–299). */
const demoGtins = () => new Set(Object.values(DEMO_QUERIES).map((q) => normalizeGtin14(q.gtin)));

/** Ist die Nummer eine der fiktiven Demo-GTINs aus DEMO_QUERIES? */
export const isDemoGtin = (raw: string | undefined): boolean => {
  const g = normalizeGtin14(raw);
  return g !== null && demoGtins().has(g);
};

/** Stammt die Abfrage aus DEMO_QUERIES (gleiche Produkt-ID und gleiche Demo-GTIN)? */
export function isDemoQuery(query: ProductQuery): boolean {
  const demo = (DEMO_QUERIES as Record<string, ProductQuery>)[query.productId];
  return !!demo && sameGtinDigits(demo.gtin, query.gtin);
}

/**
 * Ausschließlich für den Demo-/Testweg: Abfrage stammt aus DEMO_QUERIES UND Angebot ist synthetisch; dann exakter
 * Vergleich der normalisierten GTIN (auch 200–299). Echte Preislistenzeilen passen so nie zu Demo-Produkten.
 */
export function sameDemoGtin(query: ProductQuery, offer: StoredOffer): boolean {
  return isDemoQuery(query) && offer.provenance.synthetic === true && sameGtinDigits(offer.data.gtin, query.gtin);
}

/**
 * Übergangsregel bis zur Trennung über `allowReal` (Paket B/I): sameGtin ODER beide Seiten tragen dieselbe
 * Demo-GTIN aus DEMO_QUERIES. Gegenüber dem früheren Stringvergleich eine reine Verschärfung: Andere eingeschränkte
 * Nummern, Umverpackungen und ungültige Nummern passen nie mehr. Dass heute noch eine nicht-synthetische Zeile mit
 * Demo-GTIN einem Demo-Produkt zugeordnet wird, behebt erst der Demo-Weg mit `sameDemoGtin` (bestehende Tests nutzen
 * solche Zeilen und werden dann bewusst angepasst).
 */
export function sameGtinOrDemoGtin(a: string | undefined, b: string | undefined): boolean {
  return sameGtin(a, b) || (isDemoGtin(a) && sameGtinDigits(a, b));
}

/** Herstellernummer vergleichbar machen: getrimmt, Großbuchstaben, ohne Leer- und Trennzeichen. */
export const normalizeMpn = (s?: string) => s?.trim().toUpperCase().replace(/[\s\-_./]/g, "") || undefined;

/** "gtin:<14>" bei globaler GTIN, sonst "sku:<supplierId>::<supplierSku>". */
export function offerIdentityKey(o: { supplierId: string; supplierSku: string; gtin?: string }): string {
  return gtinClass(o.gtin) === "global" ? `gtin:${normalizeGtin14(o.gtin)}` : `sku:${o.supplierId}::${o.supplierSku}`;
}
