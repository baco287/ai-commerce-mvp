// Pflichtunterlagen als feste Dokumenttypen – EIN Abgleich für Dashboard, Supplier Scout und Market-Pipeline.
//
// Grundsatz: Eine Pflicht ist nur erfüllt, wenn das Angebot eine Unterlage GENAU dieses Typs führt
// (`safety.documentTypes`). Freitext (`safety.documents`, z. B. „… (geprüft 2026-10-01)“ oder „… (Demo)“) dient nur der
// Anzeige und erfüllt nie eine Pflicht – auch nicht, wenn er wie die Bezeichnung einer Pflichtunterlage beginnt.
// Rein, ohne Datei- oder Netzwerkzugriff.

import { DOC_TYPES, type DocType, type ProductQuery, type SupplierQuote } from "./model";

/**
 * Anzeigenamen der Dokumenttypen. Die Namen der sieben Demo-Unterlagen sind identisch zu den bisherigen Demo-
 * Bezeichnungen (DEMO_REQUIRED_DOCUMENTS), damit die Anzeige im Lieferanten-Dashboard unverändert bleibt.
 * VORLÄUFIG: Die Zuordnung je Warengruppe (risk.ts) ist fachlich abzunehmen – Entscheidung des Inhabers offen (Entscheidung 2).
 */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  eu_doc: "Konformitätserklärung",
  red_doc: "Prüfbericht Funk/EMV (RED)",
  weee: "WEEE-Registrierungsnummer",
  battg: "Batterie-Registrierung (BattG)",
  gpsr: "Herstellerangaben (GPSR)",
  food_contact: "Konformität Lebensmittelkontakt (LFGB/EU 1935/2004)",
  cpnp: "CPNP-Notifizierung (Kosmetik)",
  safety_assessment: "Sicherheitsbewertung (Kosmetik)",
  magnet_warning: "Warnhinweis Magnete/Kleinteile",
  trademark_license: "Kompatibilitätsangaben ohne Markenverletzung",
};

export const isDocType = (v: unknown): v is DocType => typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);

/** Sortiert und ohne Dubletten (stabile Reihenfolge nach DOC_TYPES). */
export const sortDocTypes = (types: readonly DocType[]): DocType[] => DOC_TYPES.filter((t) => types.includes(t));

/** Typen der Unterlagen, die das Angebot führt (sortiert, ohne Dubletten; unbekannte Werte werden ignoriert). */
export function documentTypesOf(quote: SupplierQuote): DocType[] {
  return sortDocTypes((quote.safety.documentTypes ?? []).filter(isDocType));
}

/** Liegt eine Unterlage des geforderten Typs vor? Abgleich ausschließlich über den Typ, nie über Freitext. */
export function hasRequiredDocument(quote: SupplierQuote, docType: DocType): boolean {
  return documentTypesOf(quote).includes(docType);
}

/** Pflicht-Dokumenttypen einer Suchanfrage (sortiert, ohne Dubletten). */
export const requiredDocTypesOf = (query: ProductQuery): DocType[] => sortDocTypes((query.requiredDocTypes ?? []).filter(isDocType));

/**
 * Offene Pflichtunterlagen eines Angebots als Anzeigenamen: fehlende Typen sowie Freitext-Pflichten ohne Typ
 * (`safety.requiredDocuments`, die keinem geforderten Typ entsprechen) – Freitext kann nie belegt werden (fail-closed).
 */
export function openRequiredDocuments(quote: SupplierQuote, query: ProductQuery): string[] {
  const required = requiredDocTypesOf(query);
  const typedLabels = new Set(required.map((t) => DOC_TYPE_LABELS[t]));
  const untyped = (query.safety.requiredDocuments ?? []).filter((d) => !typedLabels.has(d));
  return [...required.filter((t) => !hasRequiredDocument(quote, t)).map((t) => DOC_TYPE_LABELS[t]), ...untyped];
}

/** Anzeigenamen aller Pflichtunterlagen einer Suchanfrage (Typen zuerst, dann Freitext ohne Typ). */
export function requiredDocumentLabels(query: ProductQuery): string[] {
  const labels = requiredDocTypesOf(query).map((t) => DOC_TYPE_LABELS[t]);
  return [...labels, ...(query.safety.requiredDocuments ?? []).filter((d) => !labels.includes(d))];
}
