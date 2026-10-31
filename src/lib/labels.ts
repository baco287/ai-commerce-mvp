// Deutsche Anzeigetexte für Statuswerte – an einer Stelle, damit alle Seiten gleich beschriften.

import type { BadgeTone } from "@/components/ui/badge";
import type { Recommendation } from "@/lib/data";
import type { FinancingStatus, RecommendationKind } from "@/lib/suppliers";
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
