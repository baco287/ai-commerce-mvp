// Prüft jede Datenzeile einer Preisliste und baut daraus ImportedOfferData.
// Ungültige Werte machen die Zeile ungültig (mit Grund) – es wird nichts geraten oder ersetzt.

import { createHash } from "node:crypto";
import type { CsvTable } from "./csv";
import { FIELD_SPECS, type ColumnMapping, type ColumnResolution, type ImportField } from "./columns";
import type { ImportedOfferData } from "./types";
import {
  parseBool,
  parseCount,
  parseCountry,
  parseDate,
  parseDeliveryDays,
  parseGtin,
  parseMoney,
  parsePaymentTerms,
  parseText,
  type Parsed,
} from "./values";

export interface RowResult {
  line: number;
  status: "valid" | "rejected" | "duplicate";
  key?: string;
  data?: ImportedOfferData;
  /** Lieferant der Zeile, sobald der Name lesbar ist – auch bei abgelehnten Zeilen */
  supplierId?: string;
  errors: string[];
  warnings: string[];
}

/** Angaben, deren Fehlen ausdrücklich gemeldet wird (sie bleiben dann „fehlend“). */
const IMPORTANT_OPTIONAL: ImportField[] = ["gtin", "shippingCostDe", "stock", "shipsFrom", "deliveryDays", "dropshipping", "paymentTerms", "minOrderValue", "supplierUpdatedAt"];

/**
 * Stabile Lieferanten-Kennung aus dem Namen. Umlaute und Akzente werden umgeschrieben (Müller → mueller,
 * Łódź → lodz), „&“/„+“ bleiben als Wort erhalten. Enthält der Name Zeichen, die sich nicht eindeutig umschreiben
 * lassen (z. B. chinesische Schrift), wird eine kurze Prüfsumme des vollständigen Namens angehängt – zwei
 * verschiedene Lieferanten teilen sich so nie eine Kennung (und damit nie Angebote oder Nachweise).
 */
export function supplierIdOf(name: string): string {
  // NFC: „ü“ als ein Zeichen oder als „u“ + Trema (macOS, PDF) ergibt dieselbe Kennung
  const base = name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  const latin = base
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/ł/g, "l")
    .replace(/&/g, " und ")
    .replace(/\+/g, " plus ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  const slug = latin.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const lossy = /[^a-z0-9\s.,;:'’"()\-/]/.test(latin);
  if (!lossy) return slug;
  const hash = createHash("sha256").update(base).digest("hex").slice(0, 6);
  return slug ? `${slug}-${hash}` : `lieferant-${hash}`;
}

export const offerKey = (supplierId: string, supplierSku: string) => `${supplierId}::${supplierSku}`;

const MAX_AGE_DAYS = 90;

export function readRows(table: CsvTable, cols: ColumnResolution, mapping: ColumnMapping, importedAt: string): RowResult[] {
  return table.rows.map((row) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const cell = (field: ImportField): string => {
      const i = cols.index[field];
      return i === undefined ? "" : (row.cells[i] ?? "").trim();
    };
    /** Liest ein Feld; leer → undefined; ungültig → Fehler (Zeile wird abgelehnt). */
    const read = <T>(field: ImportField, parse: (raw: string) => Parsed<T>, fallback?: string): T | undefined => {
      const raw = cell(field) || fallback || "";
      if (raw === "") {
        if (FIELD_SPECS[field].required) errors.push(`${FIELD_SPECS[field].label} fehlt.`);
        return undefined;
      }
      const parsed = parse(raw);
      if ("error" in parsed) {
        errors.push(`${FIELD_SPECS[field].label}: ${parsed.error}.`);
        return undefined;
      }
      return parsed.value;
    };

    // Abweichende Spaltenzahl deutet auf ein unmaskiertes Trennzeichen hin – Werte könnten verrutscht sein.
    if (row.cells.length !== table.headers.length) {
      errors.push(`Zeile hat ${row.cells.length} Spalten, die Kopfzeile ${table.headers.length} – Werte könnten verrutscht sein.`);
    }

    const supplierName = read("supplierName", (r) => parseText(r, 120), mapping.defaults?.supplierName);
    const supplierSku = read("supplierSku", (r) => parseText(r, 80));
    const title = read("title", (r) => parseText(r, 300));
    const unitPrice = read("unitPrice", parseMoney);
    const currencyRaw = cell("currency") || mapping.defaults?.currency || "";
    let currency: "EUR" | undefined;
    if (currencyRaw === "") errors.push("Währung fehlt.");
    else if (/^(eur|€|euro)$/i.test(currencyRaw.trim())) currency = "EUR";
    else errors.push(`Währung „${currencyRaw}“ nicht unterstützt – nur EUR (keine Umrechnung ohne festgelegten Kurs).`);

    const gtin = read("gtin", parseGtin);
    const brand = read("brand", (r) => parseText(r, 80));
    const mpn = read("mpn", (r) => parseText(r, 80));
    const shippingCostDe = read("shippingCostDe", parseMoney);
    const minOrderQuantity = read("minOrderQuantity", parseCount);
    const minOrderValue = read("minOrderValue", parseMoney);
    const stock = read("stock", parseCount);
    const shipsFrom = read("shipsFrom", parseCountry);
    const dropshipping = read("dropshipping", parseBool);
    const blindShipping = read("blindShipping", parseBool);
    const paymentTerms = read("paymentTerms", parsePaymentTerms);
    const supplierUpdatedAt = read("supplierUpdatedAt", parseDate);
    const dataSource = read("dataSource", (r) => parseText(r, 200), mapping.defaults?.dataSource);

    let deliveryDays = read("deliveryDays", parseDeliveryDays);
    if (deliveryDays === undefined && (cell("deliveryDaysMin") || cell("deliveryDaysMax"))) {
      const min = read("deliveryDaysMin", parseCount);
      const max = read("deliveryDaysMax", parseCount);
      if (min === undefined || max === undefined) errors.push("Lieferzeit: Minimum und Maximum müssen beide angegeben sein.");
      else if (min > max) errors.push("Lieferzeit: Minimum größer als Maximum.");
      else deliveryDays = { min, max };
    }

    // Plausibilität
    if (unitPrice !== undefined && unitPrice <= 0) errors.push("Einkaufspreis muss größer als 0 sein.");
    if (shippingCostDe !== undefined && shippingCostDe < 0) errors.push("Versandkosten dürfen nicht negativ sein.");
    if (minOrderValue !== undefined && minOrderValue < 0) errors.push("Mindestbestellwert darf nicht negativ sein.");
    if (minOrderQuantity === 0) errors.push("Mindestbestellmenge 0 ist nicht plausibel (mindestens 1).");
    if (supplierUpdatedAt) {
      const ageDays = (Date.parse(importedAt) - Date.parse(supplierUpdatedAt)) / 86_400_000;
      if (ageDays < -1) warnings.push(`Aktualisierungsdatum ${supplierUpdatedAt} liegt in der Zukunft.`);
      else if (ageDays > MAX_AGE_DAYS) warnings.push(`Preisliste vom ${supplierUpdatedAt} ist älter als ${MAX_AGE_DAYS} Tage.`);
    }
    const absent = IMPORTANT_OPTIONAL.filter((f) => {
      if (f === "deliveryDays") return deliveryDays === undefined;
      return cell(f) === "";
    });
    if (absent.length) warnings.push(`Keine Angabe (bleibt „fehlend“): ${absent.map((f) => FIELD_SPECS[f].label).join(", ")}.`);

    if (errors.length || supplierName === undefined || supplierSku === undefined || title === undefined || unitPrice === undefined || !currency) {
      const rejectedSupplier = supplierName === undefined ? "" : supplierIdOf(supplierName);
      return { line: row.line, status: "rejected", ...(rejectedSupplier ? { supplierId: rejectedSupplier } : {}), errors, warnings };
    }
    const supplierId = supplierIdOf(supplierName);
    if (!supplierId) return { line: row.line, status: "rejected", errors: ["Lieferantenname ergibt keine gültige Kennung."], warnings };

    const data: ImportedOfferData = {
      supplierId,
      supplierName,
      supplierSku,
      title,
      unitPrice,
      currency,
      ...(gtin !== undefined && { gtin }),
      ...(brand !== undefined && { brand }),
      ...(mpn !== undefined && { mpn }),
      ...(shippingCostDe !== undefined && { shippingCostDe }),
      ...(minOrderQuantity !== undefined && { minOrderQuantity }),
      ...(minOrderValue !== undefined && { minOrderValue }),
      ...(stock !== undefined && { stock }),
      ...(shipsFrom !== undefined && { shipsFrom }),
      ...(deliveryDays !== undefined && { deliveryDays }),
      ...(dropshipping !== undefined && { dropshipping }),
      ...(blindShipping !== undefined && { blindShipping }),
      ...(paymentTerms !== undefined && { paymentTerms }),
      ...(supplierUpdatedAt !== undefined && { supplierUpdatedAt }),
      ...(dataSource !== undefined && { dataSource }),
    };
    return { line: row.line, status: "valid", key: offerKey(supplierId, supplierSku), data, errors, warnings };
  });
}
