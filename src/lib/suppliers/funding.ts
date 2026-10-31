// Finanzierungsprüfung je Angebot und Kundenbestellung – ergänzt `assessFinancing` (Zahlungsziel) um
// Beträge und Termine: Was müssten wir wann zahlen, wann kommt das Kundengeld, und reichen
// NACHGEWIESENE Mittel nach Abzug der Sicherheitsreserve?
//
// Grundsatz: Vorfinanzierungsfreiheit nur bei bestätigtem, sofort nutzbarem Zahlungsziel ≥ Auszahlung
// (siehe financing.ts). Mittel ohne Nachweis gelten nie als ausreichend.

import { FUNDING } from "@/lib/config/budget";
import type { CostBreakdown } from "./eligibility";
import type { FinancingAssessment } from "./financing";
import { factValue, type SupplierQuote } from "./model";
import { SCOUT_RULES, type ScoutRules } from "./rules";

export interface FundingContext {
  availableFunds: number;
  /** true nur mit belegtem Kontostand */
  fundsVerified: boolean;
  fundsSource: string;
  safetyReserve: number;
}

export const DEFAULT_FUNDING_CONTEXT: Readonly<FundingContext> = Object.freeze({
  availableFunds: FUNDING.availableFunds,
  fundsVerified: FUNDING.verified,
  fundsSource: FUNDING.source,
  safetyReserve: FUNDING.safetyReserve,
});

export type FundingStatus =
  /** Bestätigtes Zahlungsziel deckt die Auszahlungsdauer – kein eigenes Geld nötig */
  | "no_prefinancing"
  /** Vorfinanzierung nötig, Betrag passt in nachgewiesene Mittel abzüglich Reserve */
  | "prefinancing_within_funds"
  /** Vorfinanzierung nötig, Betrag übersteigt nachgewiesene Mittel abzüglich Reserve */
  | "prefinancing_exceeds_funds"
  /** Vorfinanzierung nötig, Mittel aber nicht nachgewiesen */
  | "prefinancing_funds_unverified"
  /** Kosten unbekannt – keine Aussage möglich */
  | "unknown";

export interface FundingAssessment {
  status: FundingStatus;
  /** Einkauf + Versand + Import für eine Kundenbestellung */
  orderCost: number | null;
  /** Betrag, der vor der Auszahlung bezahlt werden müsste (inkl. Mindestbestellwert); 0 ohne Vorfinanzierung */
  upfrontAmount: number | null;
  /** Tage bis zur Zahlungsfälligkeit beim Lieferanten (0 = Vorkasse); null = unbekannt */
  paymentDueDays: number | null;
  /** Tage bis zur Auszahlung des Kundengelds an uns */
  payoutDays: number;
  /** Tage, die überbrückt werden müssen (Auszahlung − Fälligkeit), mindestens 0 */
  gapDays: number | null;
  /** Verfügbare Mittel abzüglich Sicherheitsreserve */
  headroom: number;
  fundsVerified: boolean;
  label: string;
  /** Einzelpunkte für die Anzeige */
  details: string[];
}

const eur = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;
const round2 = (v: number) => Math.round(v * 100) / 100;

export function assessFunding(
  input: { quote: SupplierQuote; financing: FinancingAssessment; cost: CostBreakdown | null },
  context: FundingContext = DEFAULT_FUNDING_CONTEXT,
  rules: ScoutRules = SCOUT_RULES,
): FundingAssessment {
  const { quote, financing, cost } = input;
  const payoutDays = rules.payoutDelayDays;
  const headroom = round2(context.availableFunds - context.safetyReserve);
  const paymentDueDays = financing.termDays;
  const gapDays = paymentDueDays === null ? null : Math.max(0, payoutDays - paymentDueDays);
  const base = { payoutDays, paymentDueDays, gapDays, headroom, fundsVerified: context.fundsVerified };

  if (!cost) {
    return { ...base, status: "unknown", orderCost: null, upfrontAmount: null, label: "Kosten unbekannt – Finanzierung nicht beurteilbar", details: [] };
  }
  const details: string[] = [
    paymentDueDays === null ? "Zahlungsfälligkeit unbekannt – Vorkasse angenommen" : paymentDueDays === 0 ? "Zahlung vor Versand (Vorkasse)" : `Zahlung fällig nach ${paymentDueDays} Tagen`,
    `Auszahlung des Kundengelds nach ${payoutDays} Tagen`,
  ];

  if (!financing.requiresPrefinancing) {
    return {
      ...base,
      status: "no_prefinancing",
      orderCost: cost.total,
      upfrontAmount: 0,
      label: "Keine Vorfinanzierung – bestätigtes Zahlungsziel deckt die Auszahlungsdauer",
      details,
    };
  }

  // Bei Vorfinanzierung zählt mindestens der Mindestbestellwert (unbekannt = nur Bestellwert, mit Hinweis).
  const mov = factValue(quote.pricing.minOrderValue);
  const upfrontAmount = round2(Math.max(cost.total, mov ?? 0));
  details.push(`Vorzustrecken: ${eur(upfrontAmount)}${mov !== undefined && mov > cost.total ? " (Mindestbestellwert)" : ""} für ${gapDays ?? payoutDays} Tage`);
  if (mov === undefined) details.push("Mindestbestellwert unbekannt – Betrag kann höher sein");
  details.push(`Mittel nach Reserve: ${eur(headroom)} (${context.fundsVerified ? "nachgewiesen" : `nicht nachgewiesen: ${context.fundsSource}`})`);

  if (!context.fundsVerified) {
    return { ...base, status: "prefinancing_funds_unverified", orderCost: cost.total, upfrontAmount, label: "Vorfinanzierung nötig – verfügbare Mittel nicht nachgewiesen", details };
  }
  if (upfrontAmount > headroom) {
    return { ...base, status: "prefinancing_exceeds_funds", orderCost: cost.total, upfrontAmount, label: "Vorfinanzierung nötig – übersteigt die Mittel nach Sicherheitsreserve", details };
  }
  return {
    ...base,
    status: "prefinancing_within_funds",
    orderCost: cost.total,
    upfrontAmount,
    label: "Vorfinanzierung nötig – aus nachgewiesenen Mitteln möglich, Reserve bleibt unberührt",
    details,
  };
}
