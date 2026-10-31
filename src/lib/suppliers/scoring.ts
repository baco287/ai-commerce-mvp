// Deterministische Bewertung geeigneter Angebote. Alle Teilwerte liegen zwischen 0 und 100.
//
//   Kosten          100 × günstigste Gesamtkosten / eigene Gesamtkosten (relativ zu den geeigneten Angeboten)
//   Tempo           linear: idealDeliveryDays (oder schneller) = 100, maxDeliveryDays = 0 – nach der Obergrenze der Lieferspanne
//   Zuverlässigkeit 40 % Bewertung, 35 % Pünktlichkeit, 25 % Reklamationsquote
//   Finanzierung    100 = bestätigtes Zahlungsziel ≥ Auszahlung, 50 = bestätigt aber kürzer, 0 = Vorkasse/unklar
//
// Gesamt = gewichtete Summe − Abzug für unbestätigte Angaben.
// Fehlende Zuverlässigkeitswerte zählen 0, unbestätigte nur zu 80 % – Unklarheit wird nie belohnt.

import type { FinancingAssessment } from "./financing";
import { factValue, type Fact, type SupplierQuote } from "./model";
import { SCOUT_RULES, type ScoutRules } from "./rules";

export interface ScoreBreakdown {
  cost: number;
  speed: number;
  reliability: number;
  financing: number;
  /** Bezeichnungen der unbestätigten Angaben, die in die Bewertung eingehen */
  unconfirmedFacts: string[];
  unconfirmedPenalty: number;
  total: number;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Faktor für eine Angabe: bestätigt 1, unbestätigt 0,8, fehlend 0. */
const confidence = (f: Fact<unknown>) => (f.status === "confirmed" ? 1 : f.status === "unconfirmed" ? 0.8 : 0);

export function costScore(perUnit: number, cheapestPerUnit: number): number {
  return perUnit > 0 ? clamp((100 * cheapestPerUnit) / perUnit) : 0;
}

export function speedScore(maxDays: number, rules: ScoutRules = SCOUT_RULES): number {
  const span = rules.maxDeliveryDays - rules.idealDeliveryDays;
  return span > 0 ? clamp((100 * (rules.maxDeliveryDays - maxDays)) / span) : 0;
}

export function reliabilityScore(q: SupplierQuote): number {
  const { rating, onTimeRate, defectRate } = q.reliability;
  const r = clamp(((factValue(rating) ?? 1) - 1) * 25) * confidence(rating);
  const onTime = clamp((factValue(onTimeRate) ?? 0) * 100) * confidence(onTimeRate);
  // 0 % Reklamationen = 100 Punkte, 10 % oder mehr = 0 Punkte
  const defects = clamp(100 - (factValue(defectRate) ?? 1) * 1000) * confidence(defectRate);
  return 0.4 * r + 0.35 * onTime + 0.25 * defects;
}

export function financingScore(f: FinancingAssessment): number {
  if (f.status === "payment_terms_confirmed") return 100;
  if (f.status === "payment_terms_too_short") return 50;
  return 0;
}

/** Angaben, deren Unsicherheit die Bewertung mindert. */
export function unconfirmedFacts(q: SupplierQuote): string[] {
  const facts: [string, Fact<unknown>][] = [
    ["Einkaufspreis", q.pricing.unitPrice],
    ["Versandkosten", q.pricing.shippingCost],
    ["Importkosten", q.pricing.importCost],
    ["Lieferzeit", q.fulfillment.deliveryDays],
    ["Bestand", q.fulfillment.stock],
    ["Bewertung", q.reliability.rating],
    ["Pünktlichkeit", q.reliability.onTimeRate],
    ["Reklamationsquote", q.reliability.defectRate],
    ["Zahlungsziel", q.payment.terms],
  ];
  return facts.filter(([, f]) => f.status === "unconfirmed").map(([label]) => label);
}

export function scoreQuote(
  q: SupplierQuote,
  input: { perUnit: number; cheapestPerUnit: number; maxDeliveryDays: number; financing: FinancingAssessment },
  rules: ScoutRules = SCOUT_RULES,
): ScoreBreakdown {
  const w = rules.weights;
  const cost = round1(costScore(input.perUnit, input.cheapestPerUnit));
  const speed = round1(speedScore(input.maxDeliveryDays, rules));
  const reliability = round1(reliabilityScore(q));
  const financing = financingScore(input.financing);
  const unconfirmed = unconfirmedFacts(q);
  const unconfirmedPenalty = Math.min(rules.maxUnconfirmedPenalty, unconfirmed.length * rules.unconfirmedPenalty);
  const weighted = w.cost * cost + w.speed * speed + w.reliability * reliability + w.financing * financing;
  return {
    cost,
    speed,
    reliability,
    financing,
    unconfirmedFacts: unconfirmed,
    unconfirmedPenalty,
    total: round1(Math.max(0, weighted - unconfirmedPenalty)),
  };
}
