// Kalkulationsannahmen. Alle Werte sind Platzhalter für die Demo und müssen vor dem
// Live-Betrieb durch echte Konditionen (Zahlungsanbieter, Werbekosten, Retouren) ersetzt werden.

export const ASSUMPTIONS = {
  /** Umsatzsteuer Deutschland */
  vatRate: 0.19,
  /** Zahlungsgebühr in Prozent vom Bruttopreis (Annahme) */
  paymentFeePercent: 0.029,
  /** Feste Zahlungsgebühr je Bestellung in EUR (Annahme) */
  paymentFeeFixed: 0.3,
  /** Werbekosten je Verkauf (Cost per Acquisition) in EUR (Annahme) */
  adCostPerOrder: 6,
  /** Rückstellung für Retouren/Reklamationen in Prozent vom Nettopreis (Annahme) */
  returnsReservePercent: 0.03,
  /** Tage zwischen Kundenzahlung und Auszahlung durch den Zahlungsanbieter (Annahme) */
  payoutDelayDays: 7,
} as const;

/**
 * Umsatzsteuerlicher Status des Shops.
 * - regelbesteuert: Verkaufspreise enthalten 19 % USt., Vorsteuer aus Einkäufen ist abziehbar (Kosten netto).
 * - kleinunternehmer (§ 19 UStG): keine USt. auf Verkäufe, aber Vorsteuer nicht abziehbar (Kosten brutto).
 * `confirmed: false` = noch nicht mit Steuerberatung geklärt → keine Marge gilt als verlässlich.
 */
export type TaxStatus = "regelbesteuert" | "kleinunternehmer";
export const TAX_SETTINGS: Readonly<{ status: TaxStatus; confirmed: boolean }> = Object.freeze({
  status: "regelbesteuert",
  confirmed: false,
});

/** Mindestanforderungen an einen Lieferanten, damit er als "geeignet" gilt. */
export const SUPPLIER_RULES = {
  maxDeliveryDays: 12,
  minRating: 4.2,
  minStock: 50,
} as const;

/** Schwellen für die Produktempfehlung. */
export const RECOMMENDATION_RULES = {
  candidateMinMargin: 0.2,
  candidateMinDemand: 65,
  watchMinMargin: 0.1,
} as const;

export type Assumptions = typeof ASSUMPTIONS;
export type SupplierRules = typeof SUPPLIER_RULES;
