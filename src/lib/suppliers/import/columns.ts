// Zuordnung von CSV-Spalten auf das Supplier-Scout-Modell.
// Bekannte deutsche und englische Spaltennamen werden automatisch erkannt; für abweichende Listen gibt es
// eine Zuordnungsdatei (ColumnMapping). Unbekannte Spalten werden ignoriert und im Testlauf genannt.

export type ImportField =
  | "supplierName"
  | "supplierSku"
  | "gtin"
  | "brand"
  | "mpn"
  | "title"
  | "unitPrice"
  | "currency"
  | "shippingCostDe"
  | "minOrderQuantity"
  | "minOrderValue"
  | "stock"
  | "shipsFrom"
  | "deliveryDays"
  | "deliveryDaysMin"
  | "deliveryDaysMax"
  | "dropshipping"
  | "blindShipping"
  | "paymentTerms"
  | "supplierUpdatedAt"
  | "dataSource";

export interface FieldSpec {
  label: string;
  required: boolean;
  aliases: string[];
}

/** Bekannte Spaltennamen (normalisiert: klein, Umlaute ersetzt, Satzzeichen → Leerzeichen). */
export const FIELD_SPECS: Record<ImportField, FieldSpec> = {
  supplierName: { label: "Lieferantenname", required: true, aliases: ["lieferant", "lieferantenname", "supplier", "supplier name", "haendler", "vendor"] },
  supplierSku: {
    label: "Lieferantenartikelnummer",
    required: true,
    aliases: ["lieferantenartikelnummer", "artikelnummer", "art nr", "artnr", "bestellnummer", "sku", "supplier sku", "item number", "item no"],
  },
  gtin: { label: "GTIN/EAN", required: false, aliases: ["gtin", "ean", "ean13", "ean 13", "barcode", "upc"] },
  brand: { label: "Marke", required: false, aliases: ["marke", "brand"] },
  mpn: {
    label: "Herstellerartikelnummer",
    required: false,
    aliases: ["herstellerartikelnummer", "hersteller artikelnummer", "hersteller nr", "mpn", "manufacturer part number"],
  },
  title: { label: "Artikelbezeichnung", required: true, aliases: ["artikelbezeichnung", "bezeichnung", "artikel", "produktname", "title", "name", "product name"] },
  unitPrice: {
    label: "Einkaufspreis netto",
    required: true,
    aliases: ["ek netto", "einkaufspreis netto", "einkaufspreis", "preis netto", "net price", "price net", "unit price", "purchase price", "price"],
  },
  currency: { label: "Währung", required: true, aliases: ["waehrung", "currency"] },
  shippingCostDe: {
    label: "Versandkosten nach Deutschland",
    required: false,
    aliases: ["versandkosten de", "versandkosten deutschland", "versand de", "versandkosten", "shipping de", "shipping cost de", "shipping cost", "shipping"],
  },
  minOrderQuantity: { label: "Mindestbestellmenge", required: false, aliases: ["mindestbestellmenge", "mindestmenge", "moq", "min order qty", "minimum order quantity"] },
  minOrderValue: { label: "Mindestbestellwert", required: false, aliases: ["mindestbestellwert", "mov", "min order value", "minimum order value"] },
  stock: { label: "Lagerbestand", required: false, aliases: ["lagerbestand", "bestand", "verfuegbar", "stock", "available", "qty", "quantity"] },
  shipsFrom: { label: "Versandland", required: false, aliases: ["versandland", "lagerland", "ship from", "ships from", "country of dispatch"] },
  deliveryDays: { label: "Lieferzeit (Tage)", required: false, aliases: ["lieferzeit", "lieferzeit de", "lieferzeit tage", "delivery days", "delivery time", "lead time"] },
  deliveryDaysMin: { label: "Lieferzeit min.", required: false, aliases: ["lieferzeit min", "delivery days min"] },
  deliveryDaysMax: { label: "Lieferzeit max.", required: false, aliases: ["lieferzeit max", "delivery days max"] },
  dropshipping: { label: "Dropshipping", required: false, aliases: ["dropshipping", "dropship", "direktversand", "drop shipping"] },
  blindShipping: { label: "Neutraler Versand", required: false, aliases: ["neutraler versand", "blind shipping", "neutral shipping"] },
  paymentTerms: { label: "Zahlungsbedingungen", required: false, aliases: ["zahlungsbedingungen", "zahlungsziel", "payment terms", "terms"] },
  supplierUpdatedAt: { label: "Aktualisierungsdatum", required: false, aliases: ["aktualisierungsdatum", "aktualisiert", "stand", "updated at", "last updated"] },
  dataSource: { label: "Datenquelle", required: false, aliases: ["datenquelle", "quelle", "source", "data source"] },
};

/** Zuordnungsdatei für abweichende Preislisten (JSON). */
export interface ColumnMapping {
  /** CSV-Spaltenname → Feld */
  columns?: Record<string, ImportField>;
  /**
   * Feste Werte, wenn die Liste eine Angabe nicht als Spalte enthält – z. B. Lieferantenname oder Währung.
   * Sie gelten als Angabe des Importierenden, nicht als geprüft.
   */
  defaults?: Partial<Record<"supplierName" | "currency" | "dataSource", string>>;
}

/**
 * Einheiten am Ende eines Spaltenkopfs – nur zulässig, wenn sie zur erwarteten Einheit GENAU dieses Felds passen:
 * „EK netto (EUR)“ ist ein Preis, „MOQ (EUR)“ aber kein Stückwert und wird daher nicht zugeordnet.
 */
const UNIT_FIELDS: Record<string, ReadonlySet<ImportField>> = {
  eur: new Set<ImportField>(["unitPrice", "shippingCostDe", "minOrderValue"]),
  euro: new Set<ImportField>(["unitPrice", "shippingCostDe", "minOrderValue"]),
  stk: new Set<ImportField>(["minOrderQuantity", "stock"]),
  stueck: new Set<ImportField>(["minOrderQuantity", "stock"]),
  pcs: new Set<ImportField>(["minOrderQuantity", "stock"]),
  tage: new Set<ImportField>(["deliveryDays", "deliveryDaysMin", "deliveryDaysMax"]),
  werktage: new Set<ImportField>(["deliveryDays", "deliveryDaysMin", "deliveryDaysMax"]),
  days: new Set<ImportField>(["deliveryDays", "deliveryDaysMin", "deliveryDaysMax"]),
};

/**
 * Vereinheitlicht Spaltenköpfe (Unicode-NFC, Umlaute, Satzzeichen). Klammerinhalte bleiben erhalten:
 * „Lieferzeit (Wochen)“ oder „Einkaufspreis (brutto)“ werden nie still als „Lieferzeit“ (Tage) oder
 * „Einkaufspreis netto“ gelesen.
 */
export const normalizeHeader = (h: string) =>
  h
    .normalize("NFC")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/€/g, " eur ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const aliasField = (key: string) =>
  (Object.entries(FIELD_SPECS) as [ImportField, FieldSpec][]).find(([, spec]) => spec.aliases.some((a) => normalizeHeader(a) === key))?.[0];

export interface ColumnResolution {
  /** Feld → Spaltenindex */
  index: Partial<Record<ImportField, number>>;
  /** Spalten, die keinem Feld zugeordnet sind (werden ignoriert) */
  ignored: string[];
  /** Fehler, die einen Import verhindern (fehlende Pflichtspalten, Doppelbelegung) */
  errors: string[];
  /** Hinweise zu ignorierten Spalten, die einem Feld ähneln (z. B. andere Einheit) */
  notices: string[];
}

export function resolveColumns(headers: string[], mapping: ColumnMapping = {}): ColumnResolution {
  const index: Partial<Record<ImportField, number>> = {};
  const ignored: string[] = [];
  const errors: string[] = [];
  const notices: string[] = [];
  const explicit = new Map(Object.entries(mapping.columns ?? {}).map(([k, v]) => [normalizeHeader(k), v]));

  for (const field of Object.values(mapping.columns ?? {})) {
    if (!(field in FIELD_SPECS)) errors.push(`Zuordnungsdatei: unbekanntes Feld „${field}“.`);
  }

  headers.forEach((header, i) => {
    const key = normalizeHeader(header);
    if (key === "") return;
    let field: ImportField | undefined = explicit.get(key) ?? aliasField(key);
    if (!field) {
      // Passende Einheit am Ende („EK netto (EUR)“, „Lieferzeit (Tage)“) – nur für das Feld, zu dem sie gehört
      const words = key.split(" ");
      const allowed = UNIT_FIELDS[words[words.length - 1]];
      const base = words.slice(0, -1).join(" ");
      const candidate = words.length > 1 && allowed ? (explicit.get(base) ?? aliasField(base)) : undefined;
      if (candidate && allowed.has(candidate)) field = candidate;
    }
    if (!field || !(field in FIELD_SPECS)) {
      ignored.push(header);
      const similar = (Object.entries(FIELD_SPECS) as [ImportField, FieldSpec][]).find(([, spec]) =>
        spec.aliases.some((a) => key.startsWith(`${normalizeHeader(a)} `)),
      );
      if (similar) {
        notices.push(`Spalte „${header}“ ähnelt „${similar[1].label}“, wird aber ignoriert (andere Einheit oder Bedeutung?). Bei Bedarf umrechnen und per Zuordnungsdatei zuordnen.`);
      }
      return;
    }
    if (index[field] !== undefined) {
      errors.push(`Spalten „${headers[index[field]!]}“ und „${header}“ meinen beide ${FIELD_SPECS[field].label}.`);
      return;
    }
    index[field] = i;
  });

  for (const [field, spec] of Object.entries(FIELD_SPECS) as [ImportField, FieldSpec][]) {
    const hasDefault = field in (mapping.defaults ?? {});
    if (spec.required && index[field] === undefined && !hasDefault) errors.push(`Pflichtspalte fehlt: ${spec.label}.`);
  }
  if (index.deliveryDays !== undefined && (index.deliveryDaysMin !== undefined || index.deliveryDaysMax !== undefined)) {
    errors.push("Lieferzeit ist doppelt angegeben (Spanne und Min/Max-Spalten).");
  }
  return { index, ignored, errors, notices };
}
