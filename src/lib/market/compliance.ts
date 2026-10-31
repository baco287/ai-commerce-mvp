// Compliance-Stufe der Market-Pipeline: Pflichtunterlagen als feste Dokumenttypen.
//
// Pflicht-Dokumenttypen kommen aus den Risikoregeln (risk.ts, immer inkl. GPSR) und zusätzlich aus Katalog bzw.
// Suchanfrage. Geprüft wird über ALLE Basisangebote – ausschließlich über den Dokumenttyp (hasRequiredDocument), nie
// über Freitext. Die Stufe gibt nie etwas frei: Sind alle Unterlagen und Sicherheitsangaben da, bleibt die Freigabe
// beim Menschen („human_review“). Rein und deterministisch.

import { DOC_TYPE_LABELS, hasRequiredDocument, isConfirmed, sortDocTypes, type DocType, type SupplierQuote } from "@/lib/suppliers";
import type { ReasonCode } from "./reasons";
import { ALWAYS_REQUIRED_DOCUMENTS, assessRisk, RISK_LABELS, type RiskAssessment } from "./risk";

export interface ComplianceCheck {
  /** deferred = Unterlagen, Angaben oder Risikoeinstufung fehlen; human_review = vollständig, Freigabe nur durch Menschen */
  status: "deferred" | "human_review";
  requiredDocTypes: DocType[];
  missingDocTypes: DocType[];
  /** Fehlende bzw. unbestätigte Sicherheitsangaben (GPSR), je Lieferant */
  missingSafetyFacts: string[];
  codes: ReasonCode[];
  /** Stufentexte ohne Beträge */
  details: string[];
}

/** Pflicht-Dokumenttypen: Risikoregeln (immer inkl. GPSR) + zusätzliche Typen aus Katalog/Abfrage; sortiert, ohne Dubletten. */
export function requiredDocTypesFor(risk: RiskAssessment, extra: readonly DocType[] = []): DocType[] {
  return sortDocTypes([...(risk.documents ?? ALWAYS_REQUIRED_DOCUMENTS), ...extra]);
}

/** Pflicht-Dokumenttypen für Titel und Kategorie (z. B. für Katalogabfragen). */
export const requiredDocTypesForProduct = (title: string, category?: string, extra: readonly DocType[] = []) =>
  requiredDocTypesFor(assessRisk(title, category), extra);

const docLabels = (types: DocType[]) => types.map((t) => DOC_TYPE_LABELS[t]).join(", ");

/**
 * Prüft die Pflichtunterlagen und Sicherheitsangaben über alle Basisangebote.
 * - Risiko „unbekannt“ → zurückgestellt (COMPLIANCE_RISK_UNKNOWN)
 * - fehlende Unterlage eines Pflichttyps bei mindestens einem Basisangebot, fehlende bzw. unbestätigte verantwortliche
 *   Person in der EU oder deutsche Sicherheitshinweise → zurückgestellt (COMPLIANCE_DOCS_MISSING)
 * - sonst Prüfung durch Menschen (COMPLIANCE_HUMAN_REVIEW) – nie eine Freigabe
 */
export function checkCompliance(input: { risk: RiskAssessment; required: DocType[]; quotes: SupplierQuote[]; demo: boolean }): ComplianceCheck {
  const requiredDocTypes = sortDocTypes(input.required);
  const quotes = input.quotes;
  const missingDocTypes = requiredDocTypes.filter((t) => quotes.length === 0 || quotes.some((q) => !hasRequiredDocument(q, t)));
  const missingSafetyFacts: string[] = [];
  if (quotes.length === 0) missingSafetyFacts.push("Kein Basisangebot – Sicherheitsangaben nicht prüfbar.");
  for (const q of quotes) {
    if (!isConfirmed(q.safety.euResponsiblePerson, (v) => v.trim().length > 0)) {
      missingSafetyFacts.push(`${q.supplierName}: verantwortliche Person in der EU (GPSR) nicht bestätigt.`);
    }
    if (!isConfirmed(q.safety.safetyInformationDe, (v) => v === true)) {
      missingSafetyFacts.push(`${q.supplierName}: deutsche Sicherheitshinweise nicht bestätigt.`);
    }
  }

  const codes: ReasonCode[] = [];
  const details: string[] = [`Pflichtunterlagen (vorläufiger Katalog): ${requiredDocTypes.length ? docLabels(requiredDocTypes) : "keine"}.`];
  if (input.risk.level === "unknown") {
    codes.push("COMPLIANCE_RISK_UNKNOWN");
    details.push("Risiko der Warengruppe unbekannt – Pflichtunterlagen nicht sicher bestimmbar, manuelle Einstufung nötig.");
  } else {
    details.push(`Risiko ${RISK_LABELS[input.risk.level]}: ${input.risk.reasons.join("; ")}.`);
  }
  if (missingDocTypes.length > 0) details.push(`Fehlende Unterlagen: ${docLabels(missingDocTypes)}.`);
  details.push(...missingSafetyFacts);
  if (missingDocTypes.length > 0 || missingSafetyFacts.length > 0) codes.push("COMPLIANCE_DOCS_MISSING");
  if (input.demo) details.push("Demo-Unterlagen – nie Grundlage für eine echte Compliance-Freigabe.");

  if (codes.length > 0) return { status: "deferred", requiredDocTypes, missingDocTypes, missingSafetyFacts, codes, details };
  details.push("Unterlagen und Sicherheitsangaben vollständig – Compliance-Freigabe erteilt nur ein Mensch.");
  return { status: "human_review", requiredDocTypes, missingDocTypes, missingSafetyFacts, codes: ["COMPLIANCE_HUMAN_REVIEW"], details };
}
