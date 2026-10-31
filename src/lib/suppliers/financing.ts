// Finanzierung: Muss für dieses Angebot Geld vorgestreckt werden?
//
// Der Kunde zahlt im Shop, die Auszahlung an uns kommt erst nach `payoutDelayDays`.
// Verlangt der Lieferant Vorkasse (oder ein kürzeres Zahlungsziel), müssten wir den Einkauf
// in dieser Zeit vorfinanzieren. Nur ein BESTÄTIGTES Zahlungsziel ≥ Auszahlungsdauer vermeidet das.

import type { SupplierQuote } from "./model";
import { SCOUT_RULES, type ScoutRules } from "./rules";

export type FinancingStatus =
  /** Lieferant verlangt Zahlung vor Versand */
  | "prepayment_required"
  /** Bestätigtes Zahlungsziel, deckt die Auszahlungsdauer ab */
  | "payment_terms_confirmed"
  /** Bestätigtes Zahlungsziel, aber kürzer als die Auszahlungsdauer */
  | "payment_terms_too_short"
  /** Zahlungsziel nur behauptet, nicht bestätigt */
  | "payment_terms_unconfirmed"
  /** Zahlungsziel gilt erst nach Gewerbe-/USt-Prüfung, die noch aussteht */
  | "payment_terms_pending_verification"
  /** Keine Angabe */
  | "unknown";

export interface FinancingAssessment {
  status: FinancingStatus;
  /** Zahlungsziel in Tagen (0 = Vorkasse), null wenn unbekannt */
  termDays: number | null;
  /** true, wenn wir Geld vorstrecken müssten (konservativ: bei Unklarheit immer true) */
  requiresPrefinancing: boolean;
  label: string;
}

export function assessFinancing(q: SupplierQuote, rules: ScoutRules = SCOUT_RULES): FinancingAssessment {
  const t = q.payment.terms;
  if (t.status === "missing") {
    return { status: "unknown", termDays: null, requiresPrefinancing: true, label: "Zahlungsbedingungen unbekannt – Vorfinanzierung angenommen" };
  }
  const termDays = t.value.kind === "prepayment" ? 0 : t.value.days;
  if (t.value.kind === "prepayment") {
    return { status: "prepayment_required", termDays, requiresPrefinancing: true, label: "Vorkasse – Vorfinanzierung nötig" };
  }
  if (t.status === "unconfirmed") {
    return {
      status: "payment_terms_unconfirmed",
      termDays,
      requiresPrefinancing: true,
      label: `Zahlungsziel ${termDays} Tage nur unbestätigt – Vorfinanzierung bis zur Bestätigung`,
    };
  }
  if (q.payment.requiresBusinessVerification.status !== "missing" && q.payment.requiresBusinessVerification.value) {
    return {
      status: "payment_terms_pending_verification",
      termDays,
      requiresPrefinancing: true,
      label: `Zahlungsziel ${termDays} Tage erst nach Gewerbe-/USt-Prüfung – bis dahin Vorfinanzierung`,
    };
  }
  if (termDays < rules.payoutDelayDays) {
    return {
      status: "payment_terms_too_short",
      termDays,
      requiresPrefinancing: true,
      label: `Zahlungsziel ${termDays} Tage kürzer als Auszahlung (${rules.payoutDelayDays} Tage) – teilweise Vorfinanzierung`,
    };
  }
  return { status: "payment_terms_confirmed", termDays, requiresPrefinancing: false, label: `Bestätigtes Zahlungsziel ${termDays} Tage – keine Vorfinanzierung` };
}
