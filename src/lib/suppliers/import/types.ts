// Datentypen für importierte Lieferantenangebote (lokaler Speicher, nicht in Git).

import type { SupplierPaymentTerms } from "../model";

/**
 * Inhalt einer Preislistenzeile nach Prüfung. Alle Angaben stammen vom Lieferanten (bzw. Importierenden)
 * und gelten NICHT als geprüft. Fehlende Angaben sind `undefined` – nie ein erfundener Ersatzwert.
 */
export interface ImportedOfferData {
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  gtin?: string;
  brand?: string;
  mpn?: string;
  title: string;
  /** Einkaufspreis netto je Stück in EUR */
  unitPrice: number;
  currency: "EUR";
  /** Versandkosten je Stück bis zum Kunden in DE, netto EUR */
  shippingCostDe?: number;
  minOrderQuantity?: number;
  /** Mindestbestellwert netto EUR */
  minOrderValue?: number;
  stock?: number;
  /** ISO-Ländercode */
  shipsFrom?: string;
  deliveryDays?: { min: number; max: number };
  dropshipping?: boolean;
  blindShipping?: boolean;
  paymentTerms?: SupplierPaymentTerms;
  /** Aktualisierungsdatum laut Lieferant (YYYY-MM-DD) */
  supplierUpdatedAt?: string;
  dataSource?: string;
}

/** Herkunft eines gespeicherten Angebots – genau eine Zeile einer genau bestimmten Datei. */
export interface OfferProvenanceRecord {
  importId: string;
  importedAt: string;
  file: string;
  fileSha256: string;
  /** Zeile in der Datei (Kopfzeile = 1) */
  row: number;
  /** Synthetische Testdaten – im Scout wie Demo-Daten behandelt */
  synthetic: boolean;
}

export interface StoredOffer {
  /** `${supplierId}::${supplierSku}` – eindeutig je Lieferant und Artikelnummer */
  key: string;
  data: ImportedOfferData;
  provenance: OfferProvenanceRecord;
  firstImportedAt: string;
  /** Letzter Import, in dem das Angebot (geändert oder unverändert) enthalten war */
  lastSeenImportId: string;
  /** Frühere Fassungen – ein Import überschreibt nie ohne Historie */
  history: { data: ImportedOfferData; provenance: OfferProvenanceRecord; replacedAt: string; replacedByImportId: string }[];
}

export interface ImportLogEntry {
  importId: string;
  importedAt: string;
  file: string;
  fileSha256: string;
  synthetic: boolean;
  confirmationCode: string;
  counts: { new: number; changed: number; unchanged: number; rejected: number; notInFile: number };
}

export interface OfferStore {
  version: 1;
  offers: Record<string, StoredOffer>;
  imports: ImportLogEntry[];
}

export const emptyOfferStore = (): OfferStore => ({ version: 1, offers: {}, imports: [] });
