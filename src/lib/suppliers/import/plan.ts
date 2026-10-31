// Testlauf (Dry-Run) und Übernahme eines Preislisten-Imports. Reine Funktionen auf dem Speicherinhalt.
//
// Ablauf: planImport() zeigt ALLES, was passieren würde (neue, geänderte, unveränderte Angebote, abgelehnte
// Zeilen mit Gründen, Dubletten, unbekannte GTINs) und erzeugt einen Bestätigungscode. applyImportPlan()
// übernimmt nur einen Plan; der Befehl prüft vorher, dass der Code zum aktuellen Datei- und Speicherstand passt.
// Es wird nie etwas gelöscht: geänderte Angebote behalten ihre vorige Fassung, fehlende bleiben erhalten.

import { createHash } from "node:crypto";
import { parseCsv } from "./csv";
import { FIELD_SPECS, resolveColumns, type ColumnMapping, type ImportField } from "./columns";
import { readRows, type RowResult } from "./records";
import type { ImportedOfferData, ImportLogEntry, OfferStore, StoredOffer } from "./types";

export interface FieldChange {
  /** Datenfeld – oder „synthetic“, wenn sich nur die Testdaten-Markierung ändert */
  field: keyof ImportedOfferData | "synthetic";
  label: string;
  before: unknown;
  after: unknown;
}

export interface ImportPlan {
  importId: string;
  importedAt: string;
  file: string;
  fileSha256: string;
  synthetic: boolean;
  mapping: ColumnMapping;
  delimiter: string;
  columns: { mapped: { field: ImportField; label: string; header: string }[]; ignored: string[]; notices: string[] };
  /** Fehler, die den ganzen Import verhindern (Struktur, Pflichtspalten) */
  structureErrors: string[];
  rows: RowResult[];
  /** Zuordnung gültiger Angebote zu Produkten über die GTIN */
  productByKey: Record<string, string | null>;
  newOffers: string[];
  changed: { key: string; changes: FieldChange[] }[];
  unchanged: string[];
  /** Bereits gespeicherte Angebote derselben Lieferanten, die in dieser Datei fehlen – bleiben erhalten */
  notInFile: string[];
  /** Gültige Angebote ohne bzw. mit unbekannter GTIN – werden gespeichert, aber keinem Produkt zugeordnet */
  withoutGtin: string[];
  unknownGtin: string[];
  /** Mehrfach vorkommende Angebote in der Datei */
  duplicates: { key: string; lines: number[]; identical: boolean }[];
  counts: { rows: number; valid: number; rejected: number; duplicates: number; new: number; changed: number; unchanged: number; notInFile: number };
  /** Muss beim Übernehmen angegeben werden – passt nur zu genau dieser Datei, Zuordnung und diesem Speicherstand */
  confirmationCode: string;
  canApply: boolean;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Stabile JSON-Darstellung (sortierte Schlüssel) für Vergleiche und Prüfsummen. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const DATA_LABELS: Record<keyof ImportedOfferData, string> = {
  supplierId: "Lieferanten-Kennung",
  supplierName: FIELD_SPECS.supplierName.label,
  supplierSku: FIELD_SPECS.supplierSku.label,
  gtin: FIELD_SPECS.gtin.label,
  brand: FIELD_SPECS.brand.label,
  mpn: FIELD_SPECS.mpn.label,
  title: FIELD_SPECS.title.label,
  unitPrice: FIELD_SPECS.unitPrice.label,
  currency: FIELD_SPECS.currency.label,
  shippingCostDe: FIELD_SPECS.shippingCostDe.label,
  minOrderQuantity: FIELD_SPECS.minOrderQuantity.label,
  minOrderValue: FIELD_SPECS.minOrderValue.label,
  stock: FIELD_SPECS.stock.label,
  shipsFrom: FIELD_SPECS.shipsFrom.label,
  deliveryDays: "Lieferzeit",
  dropshipping: FIELD_SPECS.dropshipping.label,
  blindShipping: FIELD_SPECS.blindShipping.label,
  paymentTerms: FIELD_SPECS.paymentTerms.label,
  supplierUpdatedAt: FIELD_SPECS.supplierUpdatedAt.label,
  dataSource: FIELD_SPECS.dataSource.label,
};

export function diffOfferData(before: ImportedOfferData, after: ImportedOfferData): FieldChange[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof ImportedOfferData)[]);
  return [...fields]
    .filter((f) => stableJson(before[f]) !== stableJson(after[f]))
    .sort()
    .map((field) => ({ field, label: DATA_LABELS[field], before: before[field], after: after[field] }));
}

/** Änderungen gegenüber dem gespeicherten Angebot – inklusive Testdaten-Markierung (sonst bliebe ein Angebot falsch gekennzeichnet). */
export function offerChanges(existing: StoredOffer, data: ImportedOfferData, synthetic: boolean): FieldChange[] {
  const changes = diffOfferData(existing.data, data);
  if (existing.provenance.synthetic !== synthetic) {
    changes.push({ field: "synthetic", label: "Testdaten-Markierung", before: existing.provenance.synthetic, after: synthetic });
  }
  return changes;
}

/** Prüfsumme über den gespeicherten Angebotsbestand – ändert sich der Speicher, passt der Code nicht mehr. */
export const storeFingerprint = (store: OfferStore) => sha256(stableJson(store.offers));

export function confirmationCodeFor(input: { fileSha256: string; mapping: ColumnMapping; synthetic: boolean; store: OfferStore }): string {
  return sha256([input.fileSha256, stableJson(input.mapping), String(input.synthetic), storeFingerprint(input.store)].join("|"))
    .slice(0, 10)
    .toUpperCase();
}

export function planImport(input: {
  text: string;
  file: string;
  mapping?: ColumnMapping;
  synthetic: boolean;
  importId: string;
  importedAt: string;
  /** Bekannte GTINs der Kontrollzentrale → Produkt-ID */
  knownGtins: ReadonlyMap<string, string>;
  store: OfferStore;
}): ImportPlan {
  const mapping = input.mapping ?? {};
  const fileSha256 = sha256(input.text);
  const table = parseCsv(input.text);
  const cols = resolveColumns(table.headers, mapping);
  const structureErrors = [...table.errors, ...cols.errors];
  // Nicht lesbare Zeichen (z. B. Windows-1252-Export) würden Namen verfälschen – nie still übernehmen.
  if (input.text.includes("�")) {
    structureErrors.unshift("Datei ist nicht in UTF-8 gespeichert (Umlaute nicht lesbar). In Excel „CSV UTF-8“ wählen und erneut exportieren.");
  }
  if (table.rows.length === 0 && table.headers.length > 0) structureErrors.push("Keine Datenzeilen.");

  const rows = structureErrors.length ? [] : readRows(table, cols, mapping, input.importedAt);

  // Dubletten innerhalb der Datei: identisch → nur die erste zählt; widersprüchlich → alle abgelehnt.
  const byKey = new Map<string, RowResult[]>();
  for (const r of rows) if (r.status === "valid" && r.key) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  const duplicates: ImportPlan["duplicates"] = [];
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const identical = group.every((r) => stableJson(r.data) === stableJson(group[0].data));
    duplicates.push({ key, lines: group.map((r) => r.line), identical });
    group.forEach((r, i) => {
      if (identical && i === 0) return;
      r.status = identical ? "duplicate" : "rejected";
      const others = group.filter((o) => o !== r).map((o) => o.line).join(", ");
      if (identical) r.warnings.push(`Doppelt (gleich wie Zeile ${group[0].line}) – nur einmal übernommen.`);
      else r.errors.push(`Widersprüchliche Dublette: gleiche Lieferanten-Artikelnummer mit anderen Angaben in Zeile ${others}.`);
    });
  }
  // Gleiche GTIN beim selben Lieferanten unter verschiedenen Artikelnummern → Hinweis (mögliche Dublette)
  const gtinGroups = new Map<string, RowResult[]>();
  for (const r of rows) {
    if (r.status !== "valid" || !r.data?.gtin) continue;
    const k = `${r.data.supplierId}|${r.data.gtin}`;
    gtinGroups.set(k, [...(gtinGroups.get(k) ?? []), r]);
  }
  for (const group of gtinGroups.values()) {
    if (group.length < 2) continue;
    for (const r of group) r.warnings.push(`Gleiche GTIN wie Zeile ${group.filter((o) => o !== r).map((o) => o.line).join(", ")} unter anderer Artikelnummer – mögliche Dublette.`);
  }

  const valid = rows.filter((r): r is RowResult & { key: string; data: ImportedOfferData } => r.status === "valid" && !!r.key && !!r.data);
  const productByKey: Record<string, string | null> = {};
  const withoutGtin: string[] = [];
  const unknownGtin: string[] = [];
  for (const r of valid) {
    if (!r.data.gtin) {
      withoutGtin.push(r.key);
      productByKey[r.key] = null;
      r.warnings.push("Ohne GTIN keinem Produkt zuordenbar – wird gespeichert, aber nicht bewertet.");
    } else {
      const productId = input.knownGtins.get(r.data.gtin) ?? null;
      productByKey[r.key] = productId;
      if (!productId) {
        unknownGtin.push(r.key);
        r.warnings.push(`GTIN ${r.data.gtin} gehört zu keinem Produkt der Kontrollzentrale – wird gespeichert, aber nicht bewertet.`);
      }
    }
  }

  const newOffers: string[] = [];
  const changed: ImportPlan["changed"] = [];
  const unchanged: string[] = [];
  for (const r of valid) {
    const existing = input.store.offers[r.key];
    if (!existing) newOffers.push(r.key);
    else {
      const changes = offerChanges(existing, r.data, input.synthetic);
      if (changes.length) changed.push({ key: r.key, changes });
      else unchanged.push(r.key);
    }
  }
  const suppliersInFile = new Set(valid.map((r) => r.data.supplierId));
  const keysInFile = new Set(valid.map((r) => r.key));
  const notInFile = Object.values(input.store.offers)
    .filter((o) => suppliersInFile.has(o.data.supplierId) && !keysInFile.has(o.key))
    .map((o) => o.key);

  const confirmationCode = confirmationCodeFor({ fileSha256, mapping, synthetic: input.synthetic, store: input.store });
  const rejected = rows.filter((r) => r.status === "rejected").length;
  return {
    importId: input.importId,
    importedAt: input.importedAt,
    file: input.file,
    fileSha256,
    synthetic: input.synthetic,
    mapping,
    delimiter: table.delimiter === "\t" ? "Tab" : table.delimiter,
    columns: {
      mapped: (Object.entries(cols.index) as [ImportField, number][]).map(([field, i]) => ({ field, label: FIELD_SPECS[field].label, header: table.headers[i] })),
      ignored: cols.ignored,
      notices: cols.notices,
    },
    structureErrors,
    rows,
    productByKey,
    newOffers,
    changed,
    unchanged,
    notInFile,
    withoutGtin,
    unknownGtin,
    duplicates,
    counts: {
      rows: rows.length,
      valid: valid.length,
      rejected,
      duplicates: rows.filter((r) => r.status === "duplicate").length,
      new: newOffers.length,
      changed: changed.length,
      unchanged: unchanged.length,
      notInFile: notInFile.length,
    },
    confirmationCode,
    canApply: structureErrors.length === 0 && valid.length > 0,
  };
}

/**
 * Übernimmt einen Plan in einen NEUEN Speicherstand (der alte wird nicht verändert).
 * Nur gültige Zeilen; geänderte Angebote wandern mit alter Fassung in die Historie; nichts wird gelöscht.
 */
export function applyImportPlan(plan: ImportPlan, store: OfferStore): OfferStore {
  if (!plan.canApply) throw new Error("Dieser Import kann nicht übernommen werden (Strukturfehler oder keine gültigen Zeilen).");
  const offers: Record<string, StoredOffer> = { ...store.offers };
  for (const r of plan.rows) {
    if (r.status !== "valid" || !r.key || !r.data) continue;
    const provenance = {
      importId: plan.importId,
      importedAt: plan.importedAt,
      file: plan.file,
      fileSha256: plan.fileSha256,
      row: r.line,
      synthetic: plan.synthetic,
    };
    const existing = offers[r.key];
    if (!existing) {
      offers[r.key] = { key: r.key, data: r.data, provenance, firstImportedAt: plan.importedAt, lastSeenImportId: plan.importId, history: [] };
    } else if (offerChanges(existing, r.data, plan.synthetic).length) {
      offers[r.key] = {
        ...existing,
        data: r.data,
        provenance,
        lastSeenImportId: plan.importId,
        history: [...existing.history, { data: existing.data, provenance: existing.provenance, replacedAt: plan.importedAt, replacedByImportId: plan.importId }],
      };
    } else {
      offers[r.key] = { ...existing, lastSeenImportId: plan.importId };
    }
  }
  const entry: ImportLogEntry = {
    importId: plan.importId,
    importedAt: plan.importedAt,
    file: plan.file,
    fileSha256: plan.fileSha256,
    synthetic: plan.synthetic,
    confirmationCode: plan.confirmationCode,
    counts: { new: plan.counts.new, changed: plan.counts.changed, unchanged: plan.counts.unchanged, rejected: plan.counts.rejected, notInFile: plan.counts.notInFile },
  };
  return { version: 1, offers, imports: [...store.imports, entry] };
}
