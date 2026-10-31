// Nachweise eines Angebots für die Anzeige: Welche Sicherheits- und Lieferangaben sind belegt?
// Reine Funktion ohne Netzwerk. Gleiche Regeln wie die Eignungsprüfung (eligibility.ts).

import { hasText } from "./eligibility";
import { factValue, isConfirmed, type Fact, type ProductQuery, type SupplierQuote } from "./model";

/**
 * ok = bestätigt, unconfirmed = nur behauptet, missing = keine Angabe,
 * negative = bestätigt NICHT vorhanden, not_required = für dieses Produkt nicht nötig.
 */
export type EvidenceStatus = "ok" | "unconfirmed" | "missing" | "negative" | "not_required";

export type EvidenceKey = "identity" | "ce" | "euResponsiblePerson" | "safetyInformationDe" | "documents" | "sampleTested" | "dropshipping" | "blindShipping";

export interface Evidence {
  key: EvidenceKey;
  label: string;
  status: EvidenceStatus;
}

function flag(f: Fact<boolean>): EvidenceStatus {
  if (f.status === "missing") return "missing";
  if (f.value === false) return "negative";
  return f.status === "confirmed" ? "ok" : "unconfirmed";
}

function text(f: Fact<string>): EvidenceStatus {
  if (f.status === "missing" || !hasText(f.value)) return "missing";
  return f.status === "confirmed" ? "ok" : "unconfirmed";
}

function identity(q: SupplierQuote, query: ProductQuery): EvidenceStatus {
  const gtin = factValue(q.identity.gtin);
  if (query.gtin !== undefined && gtin !== undefined && gtin !== query.gtin) return "negative";
  if (isConfirmed(q.identity.match, (m) => m === "different")) return "negative";
  if (query.gtin !== undefined && isConfirmed(q.identity.gtin, (v) => v === query.gtin)) return "ok";
  if (isConfirmed(q.identity.match, (m) => m === "exact")) return "ok";
  return q.identity.match.status === "missing" && q.identity.gtin.status === "missing" ? "missing" : "unconfirmed";
}

/** Nachweise in fester Reihenfolge: erst Produktsicherheit, dann Lieferung. */
export function evidenceFor(q: SupplierQuote, query: ProductQuery): Evidence[] {
  return [
    { key: "identity", label: "Produktidentität", status: identity(q, query) },
    { key: "ce", label: "CE-Kennzeichnung", status: query.safety.ceRequired ? flag(q.safety.ceMarking) : "not_required" },
    { key: "euResponsiblePerson", label: "Verantwortliche Person EU (GPSR)", status: text(q.safety.euResponsiblePerson) },
    { key: "safetyInformationDe", label: "Sicherheitshinweise DE", status: flag(q.safety.safetyInformationDe) },
    { key: "documents", label: "Unterlagen", status: q.safety.documents.length > 0 ? "ok" : "missing" },
    { key: "sampleTested", label: "Geprüftes Muster", status: flag(q.reliability.sampleTested) },
    { key: "dropshipping", label: "Direktversand", status: flag(q.dropshipping.supported) },
    { key: "blindShipping", label: "Neutraler Versand", status: flag(q.dropshipping.blindShipping) },
  ];
}
