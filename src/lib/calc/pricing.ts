import { ASSUMPTIONS, type Assumptions } from "@/lib/config/assumptions";
import type { SupplierOffer } from "@/lib/types";

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Gesamtkosten bis zum Kunden: Einkauf + Versand + geschätzte Importkosten. */
export function landedCost(offer: Pick<SupplierOffer, "unitPrice" | "shippingCost" | "importCost">): number {
  return round2(offer.unitPrice + offer.shippingCost + offer.importCost);
}

export interface MarginBreakdown {
  priceGross: number;
  priceNet: number;
  vat: number;
  landedCost: number;
  paymentFee: number;
  adCost: number;
  returnsReserve: number;
  /** Deckungsbeitrag je Verkauf nach allen variablen Kosten */
  contribution: number;
  /** Deckungsbeitrag im Verhältnis zum Nettopreis */
  marginPercent: number;
}

type MarginAssumptions = Pick<
  Assumptions,
  "vatRate" | "paymentFeePercent" | "paymentFeeFixed" | "adCostPerOrder" | "returnsReservePercent"
>;

/**
 * Deckungsbeitrag je Verkauf. Rechnet vom Bruttopreis aus und zieht MwSt.,
 * Warenkosten, Zahlungsgebühren, Werbekosten und Retourenreserve ab.
 */
export function calculateMargin(priceGross: number, cost: number, a: MarginAssumptions = ASSUMPTIONS): MarginBreakdown {
  const priceNet = priceGross / (1 + a.vatRate);
  const paymentFee = priceGross * a.paymentFeePercent + a.paymentFeeFixed;
  const returnsReserve = priceNet * a.returnsReservePercent;
  const contribution = priceNet - cost - paymentFee - a.adCostPerOrder - returnsReserve;
  return {
    priceGross: round2(priceGross),
    priceNet: round2(priceNet),
    vat: round2(priceGross - priceNet),
    landedCost: round2(cost),
    paymentFee: round2(paymentFee),
    adCost: round2(a.adCostPerOrder),
    returnsReserve: round2(returnsReserve),
    contribution: round2(contribution),
    marginPercent: priceNet > 0 ? contribution / priceNet : 0,
  };
}

/** Summe der variablen Kosten je Verkauf (ohne MwSt.). */
export function variableCosts(m: MarginBreakdown): number {
  return round2(m.landedCost + m.paymentFee + m.adCost + m.returnsReserve);
}
