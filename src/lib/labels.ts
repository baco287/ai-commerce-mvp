// Deutsche Anzeigetexte für Statuswerte – an einer Stelle, damit alle Seiten gleich beschriften.

import type { BadgeTone } from "@/components/ui/badge";
import type { Recommendation } from "@/lib/data";
import type { AdapterRun, EvidenceStatus, ExclusionCode, FinancingStatus, RecommendationKind } from "@/lib/suppliers";
import type { ApprovalKind, PaymentStatus, PaymentTerms, Region, Severity } from "@/lib/types";

export const RECOMMENDATION_LABEL: Record<Recommendation, { label: string; tone: BadgeTone }> = {
  kandidat: { label: "Kandidat", tone: "green" },
  beobachten: { label: "Beobachten", tone: "blue" },
  verwerfen: { label: "Verwerfen", tone: "red" },
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: "Offen", tone: "neutral" },
  authorized: { label: "Reserviert", tone: "blue" },
  captured: { label: "Eingezogen", tone: "cyan" },
  paid_out: { label: "Ausgezahlt", tone: "green" },
};

export const PAYMENT_TERMS_LABEL: Record<PaymentTerms, string> = {
  vorkasse: "Vorkasse",
  netto14: "14 Tage netto",
  netto30: "30 Tage netto",
};

/** Finanzierung eines Lieferantenangebots (Supplier Scout). Grün nur ohne Vorfinanzierung. */
export const FINANCING_STATUS_LABEL: Record<FinancingStatus, { label: string; tone: BadgeTone }> = {
  payment_terms_confirmed: { label: "Zahlungsziel bestätigt", tone: "green" },
  prepayment_required: { label: "Vorkasse – Vorfinanzierung nötig", tone: "amber" },
  payment_terms_too_short: { label: "Zahlungsziel zu kurz", tone: "amber" },
  payment_terms_unconfirmed: { label: "Zahlungsziel unbestätigt", tone: "amber" },
  payment_terms_pending_verification: { label: "Gewerbeprüfung ausstehend", tone: "amber" },
  payment_terms_conditions_unclear: { label: "Gewerbeprüfung unklar", tone: "amber" },
  unknown: { label: "Zahlungsbedingungen unbekannt", tone: "amber" },
};

export const SCOUT_RECOMMENDATION_LABEL: Record<RecommendationKind, string> = {
  cheapest: "Günstigster",
  fastest: "Schnellster",
  best: "Insgesamt bester",
};

/** Status eines Nachweises (Produktsicherheit, Lieferung). */
export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, { label: string; tone: BadgeTone }> = {
  ok: { label: "bestätigt", tone: "green" },
  unconfirmed: { label: "nur behauptet", tone: "amber" },
  missing: { label: "fehlt", tone: "amber" },
  negative: { label: "nicht vorhanden", tone: "red" },
  not_required: { label: "nicht nötig", tone: "neutral" },
};

/** Kurzbezeichnung der Ausschlussgründe des Supplier Scouts. */
export const EXCLUSION_LABEL: Record<ExclusionCode, string> = {
  identity_mismatch: "Anderes Produkt",
  identity_unconfirmed: "Identität unbestätigt",
  safety_issue: "Sicherheitsproblem",
  safety_unclear: "Produktsicherheit unklar",
  dropshipping_unavailable: "Kein Direktversand",
  not_deliverable: "Nicht lieferbar",
  insufficient_stock: "Bestand zu niedrig",
  delivery_too_slow: "Lieferzeit zu lang",
  stock_purchase_required: "Vorratskauf nötig",
  cost_unknown: "Kosten unvollständig",
  rating_too_low: "Bewertung zu niedrig",
};

export const ADAPTER_STATUS_LABEL: Record<AdapterRun["status"], { label: string; tone: BadgeTone }> = {
  ok: { label: "abgefragt", tone: "green" },
  blocked: { label: "gesperrt", tone: "neutral" },
  error: { label: "Fehler", tone: "red" },
};

export const REGION_LABEL: Record<Region, string> = {
  CN: "China",
  EU: "EU-Lager",
  DE: "Deutschland",
};

export const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  info: "blue",
  warning: "amber",
  critical: "red",
};

export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  product_listing: "Produktfreigabe",
  ad_budget: "Werbebudget",
  supplier_change: "Lieferant",
  purchase: "Einkauf",
};
