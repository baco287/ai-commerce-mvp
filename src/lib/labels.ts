// Deutsche Anzeigetexte für Statuswerte – an einer Stelle, damit alle Seiten gleich beschriften.

import type { BadgeTone } from "@/components/ui/badge";
import type { Recommendation } from "@/lib/data";
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
