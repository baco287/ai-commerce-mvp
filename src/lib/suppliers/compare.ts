// Vergleich und Empfehlung: günstigster geeigneter, schnellster geeigneter und insgesamt bester Lieferant.
// Reine Funktion ohne Seiteneffekte – gleiche Eingabe ergibt immer dieselbe Empfehlung.

import { formatDays, formatEur } from "@/lib/format";
import { checkEligibility, costBreakdown, type CostBreakdown, type Eligibility } from "./eligibility";
import { assessFinancing, type FinancingAssessment } from "./financing";
import { factValue, type ProductQuery, type SupplierQuote } from "./model";
import { SCOUT_RULES, type ScoutRules } from "./rules";
import { scoreQuote, type ScoreBreakdown } from "./scoring";

export interface QuoteEvaluation {
  quote: SupplierQuote;
  eligibility: Eligibility;
  financing: FinancingAssessment;
  /** null, wenn Kosten unvollständig sind */
  cost: CostBreakdown | null;
  deliveryDays: { min: number; max: number } | null;
  /** Nur für geeignete Angebote */
  score: ScoreBreakdown | null;
}

export type RecommendationKind = "cheapest" | "fastest" | "best";

export interface Recommendation {
  kind: RecommendationKind;
  quoteId: string;
  supplierName: string;
  /** Nachvollziehbare Begründung, ein Satz je Eintrag */
  reasons: string[];
}

export interface SupplierComparison {
  query: ProductQuery;
  /** Geeignete Angebote, absteigend nach Gesamtbewertung */
  eligible: QuoteEvaluation[];
  /** Ausgeschlossene Angebote mit Gründen, nach Lieferantenname */
  excluded: QuoteEvaluation[];
  recommendations: Record<RecommendationKind, Recommendation | null>;
  /** Allgemeine Hinweise, z. B. warum es keine Empfehlung gibt */
  notes: string[];
}

type Scored = QuoteEvaluation & { cost: CostBreakdown; deliveryDays: { min: number; max: number }; score: ScoreBreakdown };

const byId = (a: QuoteEvaluation, b: QuoteEvaluation) => (a.quote.id < b.quote.id ? -1 : a.quote.id > b.quote.id ? 1 : 0);

const cheapestOrder = (a: Scored, b: Scored) =>
  a.cost.perUnit - b.cost.perUnit || a.deliveryDays.max - b.deliveryDays.max || byId(a, b);
const fastestOrder = (a: Scored, b: Scored) =>
  a.deliveryDays.max - b.deliveryDays.max || a.deliveryDays.min - b.deliveryDays.min || a.cost.perUnit - b.cost.perUnit || byId(a, b);
const bestOrder = (a: Scored, b: Scored) =>
  b.score.total - a.score.total || a.cost.perUnit - b.cost.perUnit || a.deliveryDays.max - b.deliveryDays.max || byId(a, b);

const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const points = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const pts = (v: number) => points.format(v);

function evaluate(q: SupplierQuote, query: ProductQuery, rules: ScoutRules): QuoteEvaluation {
  return {
    quote: q,
    eligibility: checkEligibility(q, query, rules),
    financing: assessFinancing(q, rules),
    cost: costBreakdown(q, query.quantity),
    deliveryDays: factValue(q.fulfillment.deliveryDays) ?? null,
    score: null,
  };
}

function commonReasons(e: Scored): string[] {
  const reasons = [e.financing.label + "."];
  // Hinweise zum Zahlungsziel stecken schon im Finanzierungstext.
  const open = e.eligibility.warnings.filter((w) => !w.code.startsWith("payment_terms"));
  if (open.length > 0) {
    reasons.push(`Vor Freigabe klären: ${open.map((w) => w.message.replace(/\.$/, "")).join("; ")}.`);
  }
  if (e.quote.demo) reasons.push("Demo-Daten – keine echte Einkaufsgrundlage.");
  return reasons;
}

const costText = (c: CostBreakdown) =>
  `${formatEur(c.perUnit)} je Stück (Einkauf ${formatEur(c.unitPrice)} + Versand ${formatEur(c.shippingCost)} + Import ${formatEur(c.importCost)})`;

function cheapestReasons(e: Scored, sorted: Scored[]): string[] {
  const next = sorted[1];
  return [
    `Niedrigste Gesamtkosten aller geeigneten Angebote: ${costText(e.cost)}.`,
    next
      ? `${formatEur(round2(next.cost.perUnit - e.cost.perUnit))} günstiger als ${next.quote.supplierName} (${formatEur(next.cost.perUnit)}).`
      : "Einziges geeignetes Angebot.",
    `Lieferzeit ${formatDays(e.deliveryDays.min, e.deliveryDays.max)}.`,
    ...commonReasons(e),
  ];
}

function fastestReasons(e: Scored, sorted: Scored[]): string[] {
  const next = sorted[1];
  let comparison = "Einziges geeignetes Angebot.";
  if (next && next.deliveryDays.max > e.deliveryDays.max) {
    comparison = `Höchstlieferzeit ${next.deliveryDays.max - e.deliveryDays.max} Tage kürzer als bei ${next.quote.supplierName} (${formatDays(next.deliveryDays.min, next.deliveryDays.max)}).`;
  } else if (next) {
    comparison = `Gleiche Höchstlieferzeit wie ${next.quote.supplierName}; entschieden durch kürzere Mindestlieferzeit bzw. geringere Kosten.`;
  }
  return [
    `Kürzeste Lieferzeit aller geeigneten Angebote: ${formatDays(e.deliveryDays.min, e.deliveryDays.max)} bis zum Kunden.`,
    comparison,
    `Gesamtkosten ${costText(e.cost)}.`,
    ...commonReasons(e),
  ];
}

function bestReasons(e: Scored, sorted: Scored[], others: { cheapest: Scored; fastest: Scored }, rules: ScoutRules): string[] {
  const s = e.score;
  const w = rules.weights;
  const next = sorted[1];
  const reasons = [
    `Höchste Gesamtbewertung: ${pts(s.total)} von 100 (Kosten ${pts(s.cost)}, Tempo ${pts(s.speed)}, Zuverlässigkeit ${pts(s.reliability)}, Finanzierung ${pts(s.financing)}` +
      (s.unconfirmedPenalty > 0 ? `, −${pts(s.unconfirmedPenalty)} für unbestätigte Angaben: ${s.unconfirmedFacts.join(", ")}).` : ")."),
    `Gewichtung: Kosten ${pct(w.cost)}, Tempo ${pct(w.speed)}, Zuverlässigkeit ${pct(w.reliability)}, Finanzierung ${pct(w.financing)}.`,
    next
      ? `${pts(round2(s.total - next.score.total))} Punkte vor ${next.quote.supplierName} (${pts(next.score.total)}).`
      : "Einziges geeignetes Angebot.",
  ];
  if (others.cheapest.quote.id === e.quote.id) reasons.push("Zugleich das günstigste geeignete Angebot.");
  else reasons.push(`${formatEur(round2(e.cost.perUnit - others.cheapest.cost.perUnit))} teurer als das günstigste Angebot (${others.cheapest.quote.supplierName}), dafür insgesamt besser.`);
  if (others.fastest.quote.id === e.quote.id) reasons.push("Zugleich das schnellste geeignete Angebot.");
  return [...reasons, ...commonReasons(e)];
}

export function compareQuotes(query: ProductQuery, quotes: SupplierQuote[], rules: ScoutRules = SCOUT_RULES): SupplierComparison {
  const evaluations = quotes.map((q) => evaluate(q, query, rules));
  // Geeignet heißt auch: Kosten und Lieferzeit sind bekannt (sonst greift ein Ausschluss).
  const candidates = evaluations.flatMap((e) =>
    e.eligibility.eligible && e.cost && e.deliveryDays ? [{ ...e, cost: e.cost, deliveryDays: e.deliveryDays }] : [],
  );
  const cheapestPerUnit = Math.min(...candidates.map((e) => e.cost.perUnit));
  const scored: Scored[] = candidates.map((e) => ({
    ...e,
    score: scoreQuote(e.quote, { perUnit: e.cost.perUnit, cheapestPerUnit, maxDeliveryDays: e.deliveryDays.max, financing: e.financing }, rules),
  }));
  const scoredIds = new Set(scored.map((e) => e.quote.id));
  const excluded = evaluations
    .filter((e) => !scoredIds.has(e.quote.id))
    .sort((a, b) => a.quote.supplierName.localeCompare(b.quote.supplierName, "de") || byId(a, b));

  const byCost = [...scored].sort(cheapestOrder);
  const bySpeed = [...scored].sort(fastestOrder);
  const byScore = [...scored].sort(bestOrder);

  const notes: string[] = [];
  if (quotes.length === 0) notes.push("Keine Angebote gefunden.");
  else if (scored.length === 0) notes.push(`Kein geeignetes Angebot: alle ${quotes.length} Angebote wurden ausgeschlossen.`);
  if (scored.length > 0 && scored.every((e) => e.financing.requiresPrefinancing)) {
    notes.push("Alle geeigneten Angebote erfordern Vorfinanzierung – vor einem Einkauf Zahlungsziel verhandeln.");
  }
  if (quotes.some((q) => q.demo)) notes.push("Enthält Demo-Daten fiktiver Lieferanten.");

  const recommend = (kind: RecommendationKind, e: Scored | undefined, reasons: (e: Scored) => string[]): Recommendation | null =>
    e ? { kind, quoteId: e.quote.id, supplierName: e.quote.supplierName, reasons: reasons(e) } : null;

  return {
    query,
    eligible: byScore,
    excluded,
    recommendations: {
      cheapest: recommend("cheapest", byCost[0], (e) => cheapestReasons(e, byCost)),
      fastest: recommend("fastest", bySpeed[0], (e) => fastestReasons(e, bySpeed)),
      best: recommend("best", byScore[0], (e) => bestReasons(e, byScore, { cheapest: byCost[0], fastest: bySpeed[0] }, rules)),
    },
    notes,
  };
}
