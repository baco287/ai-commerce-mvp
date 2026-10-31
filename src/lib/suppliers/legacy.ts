// Brücke vom Supplier Scout zum bisherigen, flachen Angebotsmodell (SupplierOffer / OfferEvaluation).
//
// Produktanalyse, Bestellübersicht, Shopify-Pipeline und Produkteingabe arbeiten noch mit dem flachen
// Modell. Damit es nur EINE Datenquelle und EINE Eignungslogik gibt, wird es vollständig aus dem
// Scout-Ergebnis abgeleitet. „isBest“ = günstigster geeigneter Lieferant laut Scout (Kalkulationsbasis).

import type { OfferEvaluation } from "@/lib/calc/suppliers";
import type { Region, SupplierOffer } from "@/lib/types";
import type { QuoteEvaluation, SupplierComparison } from "./compare";
import { EU_COUNTRIES, factValue } from "./model";
import { toPurchaseGuardTerms } from "./purchase-bridge";

/** Grobe Herkunftsregion für die bisherige Anzeige; außerhalb DE/EU gilt „CN“ (Fernost). */
function regionOf(country: string | undefined): Region {
  if (country === "DE") return "DE";
  if (country && EU_COUNTRIES.includes(country)) return "EU";
  return "CN";
}

function toOffer(e: QuoteEvaluation): SupplierOffer {
  const q = e.quote;
  const shipsFrom = factValue(q.fulfillment.shipsFrom);
  const days = factValue(q.fulfillment.deliveryDays);
  return {
    id: q.id,
    productId: q.productId,
    supplierName: q.supplierName,
    region: regionOf(shipsFrom),
    warehouse: shipsFrom ?? "unbekannt",
    unitPrice: factValue(q.pricing.unitPrice) ?? Number.NaN,
    shippingCost: factValue(q.pricing.shippingCost) ?? Number.NaN,
    importCost: e.cost?.importCost ?? factValue(q.pricing.importCost) ?? Number.NaN,
    deliveryDaysMin: days?.min ?? Number.NaN,
    deliveryDaysMax: days?.max ?? Number.NaN,
    rating: factValue(q.reliability.rating) ?? 0,
    stock: factValue(q.fulfillment.stock) ?? 0,
    // Nur was die Einkaufssperre sicher annehmen darf: Demo-Angebote gelten immer als Vorkasse.
    paymentTerms: toPurchaseGuardTerms(e),
  };
}

/**
 * Alle Angebote eines Scout-Vergleichs im flachen Modell, aufsteigend nach Gesamtkosten
 * (Angebote mit unbekannten Kosten zuletzt). `landedCost` ist NaN, wenn Kosten unbekannt sind.
 */
export function toOfferEvaluations(comparison: SupplierComparison): OfferEvaluation[] {
  const cheapestId = comparison.recommendations.cheapest?.quoteId;
  return [...comparison.eligible, ...comparison.excluded]
    .map(
      (e): OfferEvaluation => ({
        offer: toOffer(e),
        landedCost: e.cost?.perUnit ?? Number.NaN,
        eligible: comparison.eligible.includes(e),
        issues: e.eligibility.exclusions.map((x) => x.message),
        isBest: e.quote.id === cheapestId,
      }),
    )
    .sort((a, b) => (Number.isNaN(a.landedCost) ? 1 : Number.isNaN(b.landedCost) ? -1 : a.landedCost - b.landedCost));
}
