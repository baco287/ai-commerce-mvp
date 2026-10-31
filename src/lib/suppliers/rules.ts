// Regeln und Gewichte des Supplier Scout Agents. Mindestanforderungen kommen aus der
// bestehenden Konfiguration (SUPPLIER_RULES), damit Dashboard und Scout dieselben Grenzen nutzen.

import { ASSUMPTIONS, SUPPLIER_RULES } from "@/lib/config/assumptions";

export interface ScoutRules {
  /** Maximale Lieferzeit bis zum Kunden (Werktage, Obergrenze der Spanne) */
  maxDeliveryDays: number;
  /** Lieferzeit, ab der es keinen Tempo-Vorteil mehr gibt (= 100 Punkte) */
  idealDeliveryDays: number;
  minRating: number;
  /** Mindestbestand beim Lieferanten, damit Kundenbestellungen sicher lieferbar sind */
  minStock: number;
  /** Tage zwischen Kundenzahlung und Auszahlung an uns – so lange müsste Vorkasse vorfinanziert werden */
  payoutDelayDays: number;
  weights: { cost: number; speed: number; reliability: number; financing: number };
  /** Punktabzug je unbestätigter Angabe in der Bewertung, gedeckelt */
  unconfirmedPenalty: number;
  maxUnconfirmedPenalty: number;
}

export const SCOUT_RULES: ScoutRules = {
  maxDeliveryDays: SUPPLIER_RULES.maxDeliveryDays,
  idealDeliveryDays: 2,
  minRating: SUPPLIER_RULES.minRating,
  minStock: SUPPLIER_RULES.minStock,
  payoutDelayDays: ASSUMPTIONS.payoutDelayDays,
  weights: { cost: 0.4, speed: 0.25, reliability: 0.25, financing: 0.1 },
  unconfirmedPenalty: 2,
  maxUnconfirmedPenalty: 10,
};
