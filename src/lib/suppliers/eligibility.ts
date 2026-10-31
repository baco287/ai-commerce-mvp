// Eignungsprüfung: Welche Angebote kommen überhaupt in Frage?
// Ausschlüsse sind harte Gründe (Angebot wird nicht bewertet), Hinweise sind offene Punkte,
// die vor einer Freigabe geklärt werden müssen und die Bewertung leicht mindern.

import { isValidTermDays } from "./financing";
import { EU_COUNTRIES, factValue, isConfirmed, type Fact, type ProductQuery, type SupplierQuote } from "./model";
import { SCOUT_RULES, type ScoutRules } from "./rules";

export type ExclusionCode =
  | "identity_mismatch"
  | "identity_unconfirmed"
  | "safety_issue"
  | "safety_unclear"
  | "dropshipping_unavailable"
  | "not_deliverable"
  | "insufficient_stock"
  | "delivery_too_slow"
  | "stock_purchase_required"
  | "cost_unknown"
  | "rating_too_low"
  /** Importierte Preisliste: Kosten oder Lieferfähigkeit nur vom Lieferanten angegeben, nicht nachgewiesen */
  | "price_list_unverified";

export interface Finding<C extends string = string> {
  code: C;
  message: string;
}

export interface Eligibility {
  eligible: boolean;
  exclusions: Finding<ExclusionCode>[];
  /** Offene Punkte (fehlende oder unbestätigte Angaben), die das Angebot nicht ausschließen */
  warnings: Finding[];
}

export interface CostBreakdown {
  unitPrice: number;
  shippingCost: number;
  importCost: number;
  /** Einkauf + Versand + Import je Stück */
  perUnit: number;
  /** perUnit × Bestellmenge */
  total: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const statusText = (f: Fact<unknown>) => (f.status === "missing" ? "fehlt" : f.status === "unconfirmed" ? "nur unbestätigt" : "bestätigt");

export const shipsFromEu = (q: SupplierQuote) => {
  const from = factValue(q.fulfillment.shipsFrom);
  return from !== undefined && EU_COUNTRIES.includes(from);
};

/**
 * Gesamtkosten bis zum Kunden. Fehlende Importkosten gelten nur bei Versand aus der EU als 0 €.
 * null, wenn die Kosten nicht vollständig bekannt sind.
 */
export function costBreakdown(q: SupplierQuote, quantity: number): CostBreakdown | null {
  const unitPrice = factValue(q.pricing.unitPrice);
  const shippingCost = factValue(q.pricing.shippingCost);
  const importCost = factValue(q.pricing.importCost) ?? (shipsFromEu(q) ? 0 : undefined);
  if (unitPrice === undefined || shippingCost === undefined || importCost === undefined) return null;
  const perUnit = round2(unitPrice + shippingCost + importCost);
  return { unitPrice, shippingCost, importCost, perUnit, total: round2(perUnit * quantity) };
}

export function checkEligibility(q: SupplierQuote, query: ProductQuery, rules: ScoutRules = SCOUT_RULES): Eligibility {
  const exclusions: Finding<ExclusionCode>[] = [];
  const warnings: Finding[] = [];
  const exclude = (code: ExclusionCode, message: string) => exclusions.push({ code, message });
  const warn = (code: string, message: string) => warnings.push({ code, message });

  // --- Produktidentität ------------------------------------------------------
  const gtin = factValue(q.identity.gtin);
  const gtinMatches = query.gtin !== undefined && isConfirmed(q.identity.gtin, (v) => v === query.gtin);
  if (query.gtin !== undefined && gtin !== undefined && gtin !== query.gtin) {
    exclude("identity_mismatch", `GTIN ${gtin} weicht vom gesuchten Produkt (${query.gtin}) ab.`);
  } else if (isConfirmed(q.identity.match, (m) => m === "different")) {
    exclude("identity_mismatch", "Lieferant führt ein anderes Produkt.");
  } else if (!gtinMatches && !isConfirmed(q.identity.match, (m) => m === "exact")) {
    const match = factValue(q.identity.match);
    const detail = match === "variant" ? "nur ähnliche Variante" : `Abgleich ${statusText(q.identity.match)}`;
    exclude("identity_unconfirmed", `Produktidentität nicht bestätigt (${detail}).`);
  }

  // --- Produktsicherheit -----------------------------------------------------
  for (const issue of q.safety.openIssues) exclude("safety_issue", `Sicherheitsproblem: ${issue}`);
  if (query.safety.ceRequired && !isConfirmed(q.safety.ceMarking, Boolean)) {
    const ce = factValue(q.safety.ceMarking) === false ? "nicht vorhanden" : statusText(q.safety.ceMarking);
    exclude("safety_unclear", `CE-Kennzeichnung ${ce}.`);
  }
  if (!isConfirmed(q.safety.euResponsiblePerson)) {
    exclude("safety_unclear", `Verantwortliche Person in der EU (GPSR) ${statusText(q.safety.euResponsiblePerson)}.`);
  }
  if (!isConfirmed(q.safety.safetyInformationDe, Boolean)) {
    const info = factValue(q.safety.safetyInformationDe) === false ? "nicht vorhanden" : statusText(q.safety.safetyInformationDe);
    exclude("safety_unclear", `Deutsche Sicherheitshinweise ${info}.`);
  }

  // --- Dropshipping ----------------------------------------------------------
  if (!isConfirmed(q.dropshipping.supported, Boolean)) {
    const ds = factValue(q.dropshipping.supported) === false ? "wird nicht angeboten" : statusText(q.dropshipping.supported);
    exclude("dropshipping_unavailable", `Direktversand an Kunden ${ds}.`);
  }
  if (!isConfirmed(q.dropshipping.blindShipping, Boolean)) {
    warn("blind_shipping_open", `Neutraler Versand ${factValue(q.dropshipping.blindShipping) === false ? "nicht möglich" : statusText(q.dropshipping.blindShipping)}.`);
  }
  if (q.dropshipping.orderChannel.status !== "confirmed") {
    warn("order_channel_open", `Bestellweg ${statusText(q.dropshipping.orderChannel)}.`);
  }

  // --- Lieferfähigkeit -------------------------------------------------------
  const delivers = q.fulfillment.deliversToDestination;
  if (factValue(delivers) !== true) {
    exclude("not_deliverable", `Lieferung nach ${query.destinationCountry} ${factValue(delivers) === false ? "nicht möglich" : "nicht angegeben"}.`);
  } else if (delivers.status === "unconfirmed") {
    warn("destination_unconfirmed", `Lieferung nach ${query.destinationCountry} nur unbestätigt.`);
  }

  const stock = factValue(q.fulfillment.stock);
  if (stock === undefined) {
    exclude("not_deliverable", "Lieferantenbestand unbekannt.");
  } else if (stock < query.quantity) {
    exclude("not_deliverable", `Nicht lieferbar: Bestand ${stock}, benötigt ${query.quantity}.`);
  } else if (stock < rules.minStock) {
    exclude("insufficient_stock", `Bestand ${stock} unter Mindestbestand ${rules.minStock}.`);
  } else if (q.fulfillment.stock.status === "unconfirmed") {
    warn("stock_unconfirmed", `Bestand ${stock} nur unbestätigt.`);
  }

  const days = factValue(q.fulfillment.deliveryDays);
  if (days === undefined) {
    exclude("not_deliverable", "Lieferzeit unbekannt.");
  } else if (days.max > rules.maxDeliveryDays) {
    exclude("delivery_too_slow", `Lieferzeit bis ${days.max} Tage (max. ${rules.maxDeliveryDays}).`);
  } else if (q.fulfillment.deliveryDays.status === "unconfirmed") {
    warn("delivery_unconfirmed", `Lieferzeit ${days.min}–${days.max} Tage nur unbestätigt.`);
  }
  if (!isConfirmed(q.fulfillment.tracking, Boolean)) {
    warn("tracking_open", `Sendungsverfolgung ${factValue(q.fulfillment.tracking) === false ? "nicht vorhanden" : statusText(q.fulfillment.tracking)}.`);
  }

  // Kein Vorratseinkauf: Mindestabnahme muss in eine einzelne Kundenbestellung passen.
  const moq = factValue(q.pricing.minOrderQuantity);
  if (moq === undefined) {
    warn("moq_missing", "Mindestabnahme unbekannt – vor Freigabe klären (kein Vorratskauf).");
  } else if (moq > query.quantity) {
    exclude("stock_purchase_required", `Mindestabnahme ${moq} Stück – wäre ein Vorratskauf.`);
  }
  // Mindestbestellwert: muss mit dem Warenwert einer einzelnen Kundenbestellung erreicht werden.
  const mov = factValue(q.pricing.minOrderValue);
  const unitPrice = factValue(q.pricing.unitPrice);
  if (mov === undefined) {
    warn("mov_missing", "Mindestbestellwert unbekannt – vor Freigabe klären (kein Vorratskauf).");
  } else if (unitPrice !== undefined && mov > round2(unitPrice * query.quantity)) {
    exclude(
      "stock_purchase_required",
      `Mindestbestellwert ${mov.toFixed(2).replace(".", ",")} € über dem Warenwert einer Kundenbestellung (${round2(unitPrice * query.quantity).toFixed(2).replace(".", ",")} €) – wäre ein Vorratskauf.`,
    );
  }

  // --- Kosten ----------------------------------------------------------------
  const p = q.pricing;
  if (p.unitPrice.status === "missing") exclude("cost_unknown", "Einkaufspreis fehlt.");
  if (p.shippingCost.status === "missing") exclude("cost_unknown", "Versandkosten nach DE fehlen.");
  if (p.importCost.status === "missing" && !shipsFromEu(q)) {
    exclude("cost_unknown", "Importkosten fehlen (Versand von außerhalb der EU).");
  }
  // Importierte Preislisten: Eine Selbstauskunft darf nie Kalkulationsbasis (Shopify-Kosten) oder Empfehlung werden.
  // Kosten und Lieferfähigkeit müssen per Nachweis geprüft sein (siehe import/evidence.ts).
  if (q.provenance?.kind === "price_list") {
    const unproven = (
      [
        ["Einkaufspreis", p.unitPrice],
        ["Versandkosten", p.shippingCost],
        ["Lieferung nach DE", q.fulfillment.deliversToDestination],
        ["Lieferzeit", q.fulfillment.deliveryDays],
        ["Lieferantenbestand", q.fulfillment.stock],
      ] as const
    )
      .filter(([, f]) => f.status !== "confirmed")
      .map(([label]) => label);
    if (unproven.length) {
      exclude("price_list_unverified", `Preisliste ohne Nachweis für ${unproven.join(", ")} – nur Lieferantenangabe, keine Kalkulationsgrundlage.`);
    }
  }
  if (p.unitPrice.status === "unconfirmed") warn("price_unconfirmed", "Einkaufspreis nur unbestätigt.");
  if (p.shippingCost.status === "unconfirmed") warn("shipping_unconfirmed", "Versandkosten nur unbestätigt.");
  if (p.importCost.status === "unconfirmed") warn("import_unconfirmed", "Importkosten nur geschätzt.");

  // --- Zuverlässigkeit -------------------------------------------------------
  const rating = factValue(q.reliability.rating);
  if (rating !== undefined && rating < rules.minRating) {
    exclude("rating_too_low", `Bewertung ${rating.toFixed(1)} unter Minimum ${rules.minRating.toFixed(1)}.`);
  }
  if (q.reliability.rating.status === "missing") warn("rating_missing", "Keine Lieferantenbewertung vorhanden.");
  if (q.reliability.onTimeRate.status === "missing") warn("on_time_missing", "Pünktlichkeitsquote fehlt.");
  if (q.reliability.defectRate.status === "missing") warn("defect_missing", "Reklamationsquote fehlt.");
  if (!isConfirmed(q.reliability.sampleTested, Boolean)) {
    const sample = factValue(q.reliability.sampleTested) === false ? "noch nicht geprüft" : statusText(q.reliability.sampleTested);
    warn("sample_not_tested", `Geprüftes Muster ${sample}.`);
  }

  // --- Zahlung ---------------------------------------------------------------
  if (q.payment.terms.status === "missing") {
    warn("payment_terms_missing", "Zahlungsbedingungen unbekannt – Vorfinanzierung wird angenommen.");
  } else if (q.payment.terms.status === "unconfirmed") {
    warn("payment_terms_unconfirmed", "Zahlungsziel nur unbestätigt – bis zur Bestätigung gilt Vorfinanzierung.");
  }
  const terms = factValue(q.payment.terms);
  if (terms?.kind === "net_terms") {
    if (!isValidTermDays(terms.days)) {
      warn("payment_terms_invalid", "Zahlungsziel ungültig – Vorfinanzierung wird angenommen.");
    }
    const verification = q.payment.requiresBusinessVerification;
    if (factValue(verification) === true) {
      warn("payment_terms_pending_verification", "Zahlungsziel erst nach Gewerbe-/USt-Prüfung.");
    } else if (!isConfirmed(verification, (v) => v === false)) {
      warn("payment_terms_conditions_unclear", "Nicht bestätigt, ob das Zahlungsziel eine Gewerbe-/USt-Prüfung voraussetzt.");
    }
  }

  return { eligible: exclusions.length === 0, exclusions, warnings };
}
