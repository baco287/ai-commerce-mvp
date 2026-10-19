import { SUPPLIER_RULES, type SupplierRules } from "@/lib/config/assumptions";
import { formatRating } from "@/lib/format";
import type { SupplierOffer } from "@/lib/types";
import { landedCost } from "./pricing";

export interface OfferEvaluation {
  offer: SupplierOffer;
  landedCost: number;
  eligible: boolean;
  /** Gründe, warum das Angebot nicht geeignet ist (leer, wenn geeignet) */
  issues: string[];
  /** Günstigstes geeignetes Angebot des Produkts */
  isBest: boolean;
}

export function checkEligibility(offer: SupplierOffer, rules: SupplierRules = SUPPLIER_RULES): string[] {
  const issues: string[] = [];
  if (offer.deliveryDaysMax > rules.maxDeliveryDays) {
    issues.push(`Lieferzeit bis ${offer.deliveryDaysMax} Tage (max. ${rules.maxDeliveryDays})`);
  }
  if (offer.rating < rules.minRating) {
    issues.push(`Bewertung ${formatRating(offer.rating)} (min. ${formatRating(rules.minRating)})`);
  }
  if (offer.stock < rules.minStock) {
    issues.push(`Lagerbestand ${offer.stock} (min. ${rules.minStock})`);
  }
  return issues;
}

/**
 * Bewertet alle Angebote eines Produkts, sortiert nach Gesamtkosten und markiert
 * das günstigste Angebot, das alle Mindestanforderungen erfüllt.
 */
export function evaluateOffers(offers: SupplierOffer[], rules: SupplierRules = SUPPLIER_RULES): OfferEvaluation[] {
  const evaluated = offers
    .map((offer) => {
      const issues = checkEligibility(offer, rules);
      return { offer, landedCost: landedCost(offer), eligible: issues.length === 0, issues, isBest: false };
    })
    .sort((a, b) => a.landedCost - b.landedCost || a.offer.deliveryDaysMax - b.offer.deliveryDaysMax);
  const best = evaluated.find((e) => e.eligible);
  if (best) best.isBest = true;
  return evaluated;
}
