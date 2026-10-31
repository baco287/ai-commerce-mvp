// Strenge Werteprüfung für Preislisten. Mehrdeutiges wird abgelehnt statt geraten.
// Jede Funktion liefert { value } oder { error } – nie einen erfundenen Ersatzwert.

import { EU_COUNTRIES, type SupplierPaymentTerms } from "../model";

export type Parsed<T> = { value: T } | { error: string };
const fail = (error: string): { error: string } => ({ error });

const clean = (raw: string) => raw.trim().replace(/\s+/g, " ");

/** Betrag in EUR: „12,50“, „12.50“, „1.234,50“, „1,234.50“, „12,50 €“. Mehrdeutig („12,500“) → Fehler. */
export function parseMoney(raw: string): Parsed<number> {
  // Währung nur als Vor- oder Nachsatz („12,50 €“, „EUR 12,50“) – „12€50“ wird abgelehnt statt zu 1250 zu werden.
  let s = clean(raw).replace(/^(€|eur)\s*|\s*(€|eur)$/gi, "").replace(/\s/g, "");
  if (s === "") return fail("leer");
  if (!/^-?[\d.,]+$/.test(s)) return fail(`„${raw.trim()}“ ist kein Betrag`);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    const [intPart, ...rest] = s.split(decimal);
    // Tausendertrennzeichen nur in korrekten Dreiergruppen, genau ein Dezimaltrennzeichen
    const groups = new RegExp(`^-?\\d{1,3}(\\${thousands}\\d{3})*$`);
    if (rest.length !== 1 || !groups.test(intPart)) return fail(`„${raw.trim()}“ ist mehrdeutig`);
    s = `${intPart.split(thousands).join("")}.${rest[0]}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    if (parts.length > 2) {
      // nur Tausendertrennzeichen, z. B. 1.234.567
      if (!/^-?\d{1,3}$/.test(parts[0]) || !parts.slice(1).every((p) => /^\d{3}$/.test(p))) return fail(`„${raw.trim()}“ ist mehrdeutig`);
      s = parts.join("");
    } else if (parts[1].length === 3) {
      return fail(`„${raw.trim()}“ ist mehrdeutig (Tausender- oder Dezimaltrennzeichen?)`);
    } else {
      s = parts.join(".");
    }
  }
  // Nachkommastellen am Text zählen – nicht per Gleitkomma (19,99 × 10000 ist nicht exakt 199900).
  if (/\.\d{5,}$/.test(s)) return fail(`„${raw.trim()}“ hat mehr als 4 Nachkommastellen`);
  const value = Number(s);
  if (!Number.isFinite(value)) return fail(`„${raw.trim()}“ ist kein Betrag`);
  return { value };
}

/** Ganze Zahl ≥ 0, Tausendertrennzeichen in Dreiergruppen erlaubt („1.000“). */
export function parseCount(raw: string): Parsed<number> {
  const s = clean(raw).replace(/\s?(stk\.?|stück|pcs|st\.?)$/i, "");
  if (s === "") return fail("leer");
  if (/^\d{1,3}([.,' ]\d{3})+$/.test(s)) return { value: Number(s.replace(/[.,' ]/g, "")) };
  if (!/^\d+$/.test(s)) return fail(`„${raw.trim()}“ ist keine ganze Zahl ≥ 0`);
  return { value: Number(s) };
}

const TRUE = new Set(["ja", "j", "yes", "y", "true", "wahr", "1", "x"]);
const FALSE = new Set(["nein", "n", "no", "false", "falsch", "0"]);
export function parseBool(raw: string): Parsed<boolean> {
  const s = clean(raw).toLowerCase();
  if (TRUE.has(s)) return { value: true };
  if (FALSE.has(s)) return { value: false };
  return fail(`„${raw.trim()}“ ist weder ja noch nein`);
}

/** Lieferzeit in Tagen: „3-5“, „3–5 Tage“, „3 bis 5 Werktage“, „4“. */
export function parseDeliveryDays(raw: string): Parsed<{ min: number; max: number }> {
  const s = clean(raw).toLowerCase().replace(/(werk)?tage?|wt|days?|business/g, "").trim();
  const m = /^(\d{1,3})\s*(?:[-–—]|bis|to)\s*(\d{1,3})$/.exec(s) ?? /^(\d{1,3})$/.exec(s);
  if (!m) return fail(`„${raw.trim()}“ ist keine Lieferzeit in Tagen`);
  const min = Number(m[1]);
  const max = Number(m[2] ?? m[1]);
  if (min > max) return fail(`Lieferzeit „${raw.trim()}“: Minimum größer als Maximum`);
  if (max > 365) return fail(`Lieferzeit „${raw.trim()}“ unplausibel`);
  return { value: { min, max } };
}

const PREPAYMENT_TERMS = /^(vorkasse|vorauskasse|prepayment|prepaid|advance payment|vorauszahlung)$/;
/** Wörter, die in einem eindeutigen Zahlungsziel vorkommen dürfen – alles andere (Skonto, „oder“, Bedingungen) ist mehrdeutig. */
const NET_TERM_WORDS = new Set(["rechnung", "invoice", "kauf", "auf", "netto", "net", "zahlungsziel", "ziel", "tage", "tag", "days", "day", "d"]);
const NET_TERM_MARKERS = new Set(["rechnung", "invoice", "netto", "net", "zahlungsziel", "ziel"]);

/**
 * Zahlungsbedingungen – nur eindeutige Angaben: „Vorkasse“, „prepayment“ → Vorkasse; „netto 30“, „30 Tage netto“,
 * „Rechnung 14 Tage“, „net 30“, „Zahlungsziel 30 Tage“ → Zahlungsziel. Alles mit Zusätzen (Skonto, „oder“,
 * „nach Freigabe“, mehrere Tageszahlen, Vorkasse plus Tage) wird abgelehnt statt geraten.
 */
export function parsePaymentTerms(raw: string): Parsed<SupplierPaymentTerms> {
  const s = clean(raw).toLowerCase();
  if (PREPAYMENT_TERMS.test(s)) return { value: { kind: "prepayment" } };
  const tokens = s.split(/[\s,.:;/]+/).filter(Boolean);
  const numbers = tokens.filter((t) => /^\d+$/.test(t));
  const words = tokens.filter((t) => !/^\d+$/.test(t));
  const unambiguous = numbers.length === 1 && words.every((w) => NET_TERM_WORDS.has(w)) && words.some((w) => NET_TERM_MARKERS.has(w));
  if (unambiguous) {
    const n = Number(numbers[0]);
    if (n > 180) return fail(`Zahlungsziel „${raw.trim()}“ unplausibel`);
    return { value: { kind: "net_terms", days: n } };
  }
  if (numbers.length === 0 && words.length > 0 && words.every((w) => NET_TERM_WORDS.has(w))) {
    return fail(`„${raw.trim()}“: Rechnung ohne Zahlungsziel in Tagen`);
  }
  return fail(`„${raw.trim()}“ ist nicht eindeutig – bitte als „Vorkasse“ oder „Rechnung 30 Tage“ angeben, Bedingungen gesondert klären`);
}

/** Datum „2026-10-31“ oder „31.10.2026“ → ISO-Datum (YYYY-MM-DD). */
export function parseDate(raw: string): Parsed<string> {
  const s = clean(raw);
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return fail(`„${raw.trim()}“ ist kein Datum (erwartet 2026-10-31 oder 31.10.2026)`);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return fail(`„${raw.trim()}“ ist kein gültiges Datum`);
  return { value: date.toISOString().slice(0, 10) };
}

const COUNTRY_NAMES: Record<string, string> = {
  deutschland: "DE", germany: "DE", polen: "PL", poland: "PL", tschechien: "CZ", "czech republic": "CZ", czechia: "CZ",
  niederlande: "NL", netherlands: "NL", frankreich: "FR", france: "FR", slowakei: "SK", slovakia: "SK", österreich: "AT",
  oesterreich: "AT", austria: "AT", italien: "IT", italy: "IT", spanien: "ES", spain: "ES", china: "CN", "vr china": "CN",
};
const ISO_COUNTRY = /^[A-Z]{2}$/;
const KNOWN_NON_EU = new Set(["CN", "HK", "TW", "US", "GB", "UK", "CH", "NO", "TR", "IN", "VN", "TH", "JP", "KR"]);

/** Versandland als ISO-Code (DE, PL, CN …). Unbekannte Länder werden abgelehnt. */
export function parseCountry(raw: string): Parsed<string> {
  const s = clean(raw);
  const byName = COUNTRY_NAMES[s.toLowerCase()];
  const code = byName ?? s.toUpperCase();
  if (!ISO_COUNTRY.test(code) || !(EU_COUNTRIES.includes(code) || KNOWN_NON_EU.has(code))) {
    return fail(`„${raw.trim()}“ ist kein bekanntes Land (ISO-Code wie DE, PL, CN)`);
  }
  return { value: code === "UK" ? "GB" : code };
}

/** GTIN-8/-12/-13/-14 mit gültiger Prüfziffer; GTIN-12 (UPC) wird zu GTIN-13 ergänzt. */
export function parseGtin(raw: string): Parsed<string> {
  const s = clean(raw).replace(/\s/g, "");
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return fail(`„${raw.trim()}“ ist keine GTIN (8, 12, 13 oder 14 Ziffern)`);
  const digits = s.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  if ((10 - (sum % 10)) % 10 !== check) return fail(`GTIN „${s}“ hat eine ungültige Prüfziffer`);
  return { value: s.length === 12 ? `0${s}` : s };
}

/** Einfacher Text: getrimmt, nicht leer, ohne Steuerzeichen. */
export function parseText(raw: string, max = 300): Parsed<string> {
  const s = clean(raw).replace(/[\u0000-\u001f\u007f]/g, "");
  if (s === "") return fail("leer");
  if (s.length > max) return fail(`länger als ${max} Zeichen`);
  return { value: s };
}
