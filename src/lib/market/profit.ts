// Profit Check des Market Scout – nutzt ausschließlich die bestehende Kalkulation (calc/pricing.ts).
// Neu ist nur die Berücksichtigung des Steuerstatus und die Frage, ob das Ergebnis VERLÄSSLICH ist.

import { calculateMargin, type MarginBreakdown } from "@/lib/calc/pricing";
import { ASSUMPTIONS, TAX_SETTINGS, type TaxStatus } from "@/lib/config/assumptions";

/** Herkunft des Verkaufspreises: belegter Marktpreis, Demo-Zielpreis oder keiner. */
export type PriceSource = "market" | "demo_target" | "none";

export interface ProfitInput {
  /** Geplanter Verkaufspreis brutto; null = kein Preis bekannt */
  priceGross: number | null;
  priceSource: PriceSource;
  /** Einkauf + Versand + Import je Stück, netto; null = kein geeigneter Lieferant */
  landedCostNet: number | null;
  /** Kosten aus nachgewiesenen (nicht nur angegebenen) Lieferantendaten */
  costVerified: boolean;
  demo: boolean;
}

export interface ProfitCheck {
  taxStatus: TaxStatus;
  /** null = nicht berechenbar */
  margin: MarginBreakdown | null;
  /** Darf die Marge als Entscheidungsgrundlage gelten? */
  reliable: boolean;
  /** Warum die Marge fehlt oder nicht verlässlich ist */
  reasons: string[];
}

/**
 * Deckungsbeitrag nach MwSt. (je Steuerstatus), Zahlungsgebühr, Werbekosten je Verkauf (Annahme) und Retourenreserve.
 * Kleinunternehmer: keine USt. auf den Verkauf, dafür wird die nicht abziehbare Vorsteuer auf die Kosten aufgeschlagen.
 */
export function checkProfit(input: ProfitInput, tax = TAX_SETTINGS): ProfitCheck {
  const reasons: string[] = [];
  if (input.priceGross === null) reasons.push("Kein belegter Verkaufspreis (keine Marktpreisquelle angebunden).");
  if (input.landedCostNet === null) reasons.push("Keine Einkaufskosten – kein geeigneter Lieferant.");
  if (input.priceGross === null || input.landedCostNet === null) {
    return { taxStatus: tax.status, margin: null, reliable: false, reasons };
  }

  const margin =
    tax.status === "kleinunternehmer"
      ? calculateMargin(input.priceGross, input.landedCostNet * (1 + ASSUMPTIONS.vatRate), { ...ASSUMPTIONS, vatRate: 0 })
      : calculateMargin(input.priceGross, input.landedCostNet);

  if (input.demo) reasons.push("Demo-Daten (Preis und/oder Lieferant simuliert).");
  if (input.priceSource !== "market") reasons.push("Verkaufspreis ist ein Planwert, kein belegter Marktpreis.");
  if (!input.costVerified) reasons.push("Einkaufskosten nicht nachgewiesen.");
  if (!tax.confirmed) reasons.push(`Steuerstatus „${tax.status}“ noch nicht bestätigt.`);
  reasons.push(`Werbekosten je Verkauf sind eine Annahme (${ASSUMPTIONS.adCostPerOrder.toFixed(2).replace(".", ",")} €).`);

  const reliable = !input.demo && input.priceSource === "market" && input.costVerified && tax.confirmed;
  return { taxStatus: tax.status, margin, reliable, reasons };
}
