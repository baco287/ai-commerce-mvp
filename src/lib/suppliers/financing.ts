// Finanzierung: Muss für dieses Angebot Geld vorgestreckt werden?
//
// Der Kunde zahlt im Shop, die Auszahlung an uns kommt erst nach `payoutDelayDays`.
// Verlangt der Lieferant Vorkasse (oder ein kürzeres Zahlungsziel), müssten wir den Einkauf
// in dieser Zeit vorfinanzieren. Nur ein BESTÄTIGTES, gültiges und ohne weitere Voraussetzung
// nutzbares Zahlungsziel ≥ Auszahlungsdauer vermeidet das.

import { isConfirmed, type SupplierQuote } from "./model";
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
  /** Nicht bestätigt, ob das Zahlungsziel eine Gewerbe-/USt-Prüfung voraussetzt */
  | "payment_terms_conditions_unclear"
  /** Keine oder ungültige Angabe */
  | "unknown";

export interface FinancingAssessment {
  status: FinancingStatus;
  /** Zahlungsziel in Tagen (0 = Vorkasse), null wenn unbekannt oder ungültig */
  termDays: number | null;
  /** true, wenn wir Geld vorstrecken müssten (konservativ: bei Unklarheit immer true) */
  requiresPrefinancing: boolean;
  label: string;
}

/** Zahlungsziel-Tage sind nur als ganze, endliche Zahl ≥ 0 gültig (keine NaN, Infinity, Texte, Brüche). */
export const isValidTermDays = (days: unknown): days is number => typeof days === "number" && Number.isInteger(days) && days >= 0;

export function assessFinancing(q: SupplierQuote, rules: ScoutRules = SCOUT_RULES): FinancingAssessment {
  const t = q.payment.terms;
  if (t.status === "missing") {
    return { status: "unknown", termDays: null, requiresPrefinancing: true, label: "Zahlungsbedingungen unbekannt – Vorfinanzierung angenommen" };
  }
  if (t.value.kind === "prepayment") {
    return { status: "prepayment_required", termDays: 0, requiresPrefinancing: true, label: "Vorkasse – Vorfinanzierung nötig" };
  }
  const termDays = t.value.days;
  if (!isValidTermDays(termDays)) {
    return { status: "unknown", termDays: null, requiresPrefinancing: true, label: "Zahlungsziel ungültig – Vorfinanzierung angenommen" };
  }
  if (t.status === "unconfirmed") {
    return {
      status: "payment_terms_unconfirmed",
      termDays,
      requiresPrefinancing: true,
      label: `Zahlungsziel ${termDays} Tage nur unbestätigt – Vorfinanzierung bis zur Bestätigung`,
    };
  }
  const verification = q.payment.requiresBusinessVerification;
  if (verification.status !== "missing" && verification.value) {
    return {
      status: "payment_terms_pending_verification",
      termDays,
      requiresPrefinancing: true,
      label: `Zahlungsziel ${termDays} Tage erst nach Gewerbe-/USt-Prüfung – bis dahin Vorfinanzierung`,
    };
  }
  // Nur ein BESTÄTIGTES „keine Prüfung nötig“ macht das Zahlungsziel sofort nutzbar.
  if (!isConfirmed(verification, (v) => v === false)) {
    return {
      status: "payment_terms_conditions_unclear",
      termDays,
      requiresPrefinancing: true,
      label: `Zahlungsziel ${termDays} Tage – unklar, ob eine Gewerbe-/USt-Prüfung nötig ist; Vorfinanzierung bis zur Klärung`,
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
