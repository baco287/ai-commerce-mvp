import { ASSUMPTIONS } from "@/lib/config/assumptions";
import { LIMITS, SAFETY_SWITCHES } from "@/lib/config/budget";
import type { PaymentStatus, PaymentTerms } from "@/lib/types";

/** Tage Zahlungsziel je Konditionsart. */
export const PAYMENT_TERM_DAYS: Record<PaymentTerms, number> = {
  vorkasse: 0,
  netto14: 14,
  netto30: 30,
};

export interface PurchaseContext {
  paymentStatus: PaymentStatus;
  /** Einkaufspreis inkl. Versand beim Lieferanten */
  supplierCost: number;
  supplierPaymentTerms: PaymentTerms;
  /** Freigegebener Finanzierungsrahmen in EUR (0 = keiner) */
  creditLineAvailable: number;
  /** Erwarteter Deckungsbeitrag dieser Bestellung */
  expectedContribution: number;
}

export interface PurchaseDecision {
  allowed: boolean;
  reasons: string[];
}

export interface PurchaseGuardConfig {
  autoPurchaseEnabled: boolean;
  maxAutoPurchasePerOrder: number;
  payoutDelayDays: number;
}

const DEFAULT_CONFIG: PurchaseGuardConfig = {
  autoPurchaseEnabled: SAFETY_SWITCHES.autoPurchaseEnabled,
  maxAutoPurchasePerOrder: LIMITS.maxAutoPurchasePerOrder,
  payoutDelayDays: ASSUMPTIONS.payoutDelayDays,
};

/**
 * Entscheidet, ob ein automatischer Lieferanteneinkauf zulässig wäre.
 * Grundsatz: kein eigenes Kapital vorstrecken. Der Einkauf ist nur erlaubt, wenn die
 * Kundenzahlung erfasst ist und die Finanzierung gesichert ist – durch bereits
 * ausgezahltes Geld, ein ausreichendes Lieferanten-Zahlungsziel oder einen Finanzierungsrahmen.
 */
export function evaluateAutoPurchase(ctx: PurchaseContext, config: PurchaseGuardConfig = DEFAULT_CONFIG): PurchaseDecision {
  const reasons: string[] = [];

  if (!config.autoPurchaseEnabled) {
    reasons.push("Automatischer Einkauf ist global deaktiviert (Sicherheitsschalter).");
  }

  if (ctx.paymentStatus === "pending" || ctx.paymentStatus === "authorized") {
    reasons.push("Kundenzahlung ist noch nicht erfasst.");
  }

  const paidOut = ctx.paymentStatus === "paid_out";
  const termCoversPayout = PAYMENT_TERM_DAYS[ctx.supplierPaymentTerms] >= config.payoutDelayDays;
  const creditCovers = ctx.creditLineAvailable >= ctx.supplierCost;
  if (!paidOut && !termCoversPayout && !creditCovers) {
    reasons.push(
      `Finanzierung nicht gesichert: Auszahlung steht aus (ca. ${config.payoutDelayDays} Tage), Lieferant verlangt Vorkasse bzw. zu kurzes Zahlungsziel, kein Finanzierungsrahmen.`,
    );
  }

  if (ctx.supplierCost > config.maxAutoPurchasePerOrder) {
    reasons.push(`Einkaufswert über dem Limit von ${config.maxAutoPurchasePerOrder} € je Bestellung.`);
  }

  if (ctx.expectedContribution <= 0) {
    reasons.push("Bestellung hätte keinen positiven Deckungsbeitrag.");
  }

  return { allowed: reasons.length === 0, reasons };
}
