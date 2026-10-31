// Liquidität einer Kalkulationsbasis im Worst Case: Müssten wir für eine Kundenbestellung Geld vorstrecken – und
// wäre das aus BELEGTEN Mitteln für Wareneinkauf gedeckt? Grundlage für die Lieferantenauswahl „Liquidität vor Preis“
// (selectCalculationBasis in compare.ts) und – mit Paket C – für den Profit Controller.
//
// Fail-closed: Unbekannte Kosten oder Zahlungsbedingungen ergeben „unknown“, Mittel ohne Kontonachweis gelten nie als
// ausreichend, und ein Zahlungsziel allein sichert in Phase 1 nie „vorfinanzierungsfrei“ (der Fristbeginn des
// Zahlungsziels ist noch nicht nachweisbar – Phase 2.4). Rein, ohne Datei- oder Netzwerkzugriff.
//
// Umfang: Status je Basis (Paket B), Mittel für Wareneinkauf, Hinweis-Codes zu Kreditrahmen und Retouren, Kapazität
// offener Bestellungen, Erstattungsrisiko, geplante verkaufbare Menge und die Zuordnung Status → Stufe (Paket C).

import { BUDGET, FUNDING } from "@/lib/config/budget";
import type { ReasonCode } from "@/lib/market/reasons";
import type { BasisCandidate } from "./compare";
import { assessFinancing, type FinancingAssessment } from "./financing";
import { assessFunding, DEFAULT_FUNDING_CONTEXT, type FundingAssessment, type FundingContext } from "./funding";
import { factValue, isConfirmed } from "./model";
import { SCOUT_RULES, type ScoutRules } from "./rules";

/**
 * Konservative Annahmen – ersetzen, sobald Gebührenliste, Retourenquote und echte Auszahlungsdaten vorliegen.
 * Konfiguration – Entscheidung des Inhabers offen (Entscheidung 1); die Werte sind die empfohlenen Voreinstellungen.
 */
export const LIQUIDITY_RULES = Object.freeze({
  /** Erstauszahlung/Halteregeln des Zahlungsanbieters im Worst Case; ASSUMPTIONS.payoutDelayDays (7) bleibt Erwartungswert */
  payoutDelayWorstCaseDays: 14,
  /** Ein Zahlungsziel muss Worst-Case-Auszahlung + Puffer decken */
  termBufferDays: 3,
  /** Stressannahme Widerrufsquote */
  returnRateWorstCase: 0.1,
  /** Rücksendekosten je Retoure (€) */
  returnShippingAssumption: 5.0,
  /** Gutschrift des Lieferanten nach Retoure; ohne bestätigte Rücknahme: keine Gutschrift */
  refundLagWorstCaseDays: 30,
  /** Abschlag vom bestätigten Lieferantenbestand */
  stockBuffer: 2,
  /** Feste Obergrenze der geplanten verkaufbaren Menge je Variante */
  maxAvailablePerVariant: 5,
});
/** Zahlenwerte statt Literale, damit Tests und spätere Konfiguration andere Werte übergeben können. */
export type LiquidityRules = { readonly [K in keyof typeof LIQUIDITY_RULES]: number };

/** EINE Regelbasis für assessFinancing UND assessFunding: Auszahlung im Worst Case + Puffer (heute 17 Tage). */
export const worstCaseScoutRules = (r: LiquidityRules = LIQUIDITY_RULES): ScoutRules => ({
  ...SCOUT_RULES,
  payoutDelayDays: r.payoutDelayWorstCaseDays + r.termBufferDays,
});

/**
 * - terms_cover_worst_case    – Zahlungsziel deckt den Worst Case und ist vollständig belegt (in Phase 1 nicht erreichbar)
 * - terms_unsecured           – Zahlungsziel deckt den Worst Case, aber Fristbeginn, Kreditrahmen oder Mittel unbelegt
 * - prefinancing_within_funds – Vorfinanzierung nötig, aus belegten Mitteln für Wareneinkauf möglich
 * - prefinancing_exceeds_funds – Vorfinanzierung nötig, übersteigt die belegten Mittel für Wareneinkauf
 * - prefinancing_unfunded     – Vorfinanzierung nötig, Mittel ohne Kontonachweis
 * - unknown                   – Kosten oder Zahlungsbedingung unbekannt
 */
export type LiquidityStatus =
  | "terms_cover_worst_case"
  | "terms_unsecured"
  | "prefinancing_unfunded"
  | "prefinancing_exceeds_funds"
  | "prefinancing_within_funds"
  | "unknown";

export const LIQUIDITY_STATUS_LABELS: Record<LiquidityStatus, string> = {
  terms_cover_worst_case: "Zahlungsziel deckt den Worst Case (belegt)",
  terms_unsecured: "Zahlungsziel deckt den Worst Case – Fristbeginn, Kreditrahmen oder Mittel unbelegt",
  prefinancing_within_funds: "Vorfinanzierung nötig – aus belegten Mitteln möglich",
  prefinancing_exceeds_funds: "Vorfinanzierung nötig – übersteigt die belegten Mittel für Wareneinkauf",
  prefinancing_unfunded: "Vorfinanzierung nötig – Mittel unbelegt",
  unknown: "Liquidität nicht bewertbar (Kosten oder Zahlungsbedingung unbekannt)",
};

/** Rang für die Lieferantenauswahl (kleiner = besser): Liquidität vor Preis; alle übrigen Status gleichrangig. */
export const LIQUIDITY_STATUS_RANK: Record<LiquidityStatus, number> = {
  terms_cover_worst_case: 0,
  terms_unsecured: 1,
  prefinancing_within_funds: 2,
  prefinancing_exceeds_funds: 3,
  prefinancing_unfunded: 3,
  unknown: 3,
};

/** Schwere für das ungünstigste Angebot einer Basis (größer = ungünstiger). */
const SEVERITY: Record<LiquidityStatus, number> = {
  terms_cover_worst_case: 0,
  terms_unsecured: 1,
  prefinancing_within_funds: 2,
  prefinancing_exceeds_funds: 3,
  prefinancing_unfunded: 4,
  unknown: 5,
};

/**
 * Mittel für Wareneinkauf (EUR):
 * fundsVerified ? max(0, min(availableFunds, total − spent) − max(0, Σ geplant (ohne Reserve) − spent) − safetyReserve) : 0
 *
 * Heute (verified=false) 0 €. Auch mit Kontonachweis bauartbedingt 0 €, solange BUDGET keinen Topf für Wareneinkauf
 * hat (500 − 430 − 70) – Entscheidung des Inhabers offen (Entscheidung 7, Umlauf-Topf). Ausgegebenes Geld wird nicht
 * doppelt abgezogen (spent mindert die offenen Töpfe). Ergebnis immer endlich und ≥ 0.
 */
/** Budgetangaben für goodsFunds (Standard: BUDGET; andere Werte nur in Tests – BUDGET ändert sich erst nach Entscheidung 7). */
export type GoodsBudget = { total: number; spent: number; plannedAllocation: readonly { key: string; amount: number }[] };

export function goodsFunds(
  budget: GoodsBudget = BUDGET,
  funding: { availableFunds: number; verified: boolean; safetyReserve: number } = FUNDING,
): number {
  if (!funding.verified) return 0;
  const planned = budget.plannedAllocation.filter((a) => a.key !== "reserve").reduce((s, a) => s + a.amount, 0);
  const free = Math.min(funding.availableFunds, budget.total - budget.spent) - Math.max(0, planned - budget.spent) - funding.safetyReserve;
  return Number.isFinite(free) ? Math.max(0, Math.round(free * 100) / 100) : 0;
}


export interface LiquidityAssessment {
  status: LiquidityStatus;
  /** Phase 1: hart false – der Fristbeginn des Zahlungsziels ist nicht nachweisbar (Phase 2.4) */
  securedWithoutPrefinancing: false;
  /** Finanzierung des ungünstigsten Basisangebots, mit Worst-Case-Auszahlung bewertet */
  financing: FinancingAssessment;
  /** Mittelprüfung desselben Angebots, mit DERSELBEN Regelbasis */
  funding: FundingAssessment;
  /** Belegte Mittel für Wareneinkauf (EUR) – VERTRAULICH (nur Journal) */
  goodsFunds: number;
  /**
   * Vorzustreckender Betrag je Kundenbestellung (EUR, höchster über die Varianten, inkl. Mindestbestellwert):
   * > 0 nur bei Vorfinanzierung, 0 bei Zahlungsziel, null = unbekannt – VERTRAULICH (nur Journal)
   */
  upfrontPerOrder: number | null;
  /**
   * Erstattungsrisiko je Bestellung (EUR): returnRateWorstCase × (Verkaufspreis brutto + Rücksendekosten). Erstattungen
   * an Kunden zahlt der Shop aus eigenen Mitteln – nie aus dem Lieferantenkredit. null = ohne Verkaufspreis nicht
   * bezifferbar (dann keine Kapazität). VERTRAULICH (nur Journal)
   */
  refundExposurePerOrder: number | null;
  /** Bestätigter Kreditrahmen ? floor(Kreditrahmen / Bestellkosten) : null (unbelegt) */
  creditCapacity: number | null;
  /** Höchstzahl gleichzeitig offener Bestellungen – immer endliche Ganzzahl ≥ 0 (heute bauartbedingt 0) */
  maxOpenOrders: number;
  /** Höchstzahl neuer Bestellungen je Tag: floor(maxOpenOrders / Bindungsdauer in Tagen) – endliche Ganzzahl ≥ 0 */
  maxOrdersPerDay: number;
  /** Hinweis-Codes, z. B. LIQ_CREDIT_UNKNOWN, LIQ_REFUND_UNKNOWN */
  codes: ReasonCode[];
  /** Einzelpunkte ohne €-Beträge (dürfen in geschwärzten Ständen erscheinen) */
  details: string[];
}

/** Endliche Ganzzahl ≥ 0 (abgerundet); NaN, Infinity und negative Werte ergeben 0. */
const safeCount = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const round2 = (v: number) => Math.round(v * 100) / 100;
/** Höchster Wert; null, sobald ein Wert fehlt oder nicht endlich ist (unbekannt = keine Aussage). */
const maxOrNull = (values: (number | null)[]) =>
  values.length > 0 && values.every((v): v is number => v !== null && Number.isFinite(v)) ? Math.max(...values) : null;

const isPrefinancing = (s: LiquidityStatus) => s === "prefinancing_unfunded" || s === "prefinancing_exceeds_funds" || s === "prefinancing_within_funds";

function statusOf(financing: FinancingAssessment, funding: FundingAssessment): LiquidityStatus {
  if (financing.status === "unknown" || funding.status === "unknown") return "unknown";
  // Beträge, die fehlen oder nicht endlich sind, sind nicht bewertbar (nie „innerhalb der Mittel“)
  if ([funding.orderCost, funding.upfrontAmount].some((v) => v === null || !Number.isFinite(v))) return "unknown";
  // Phase 1: Auch ein bestätigtes Zahlungsziel ≥ Worst Case ist nicht „gesichert“ – der Fristbeginn ist unbelegt.
  if (!financing.requiresPrefinancing) return "terms_unsecured";
  switch (funding.status) {
    case "prefinancing_funds_unverified":
      return "prefinancing_unfunded";
    case "prefinancing_exceeds_funds":
      return "prefinancing_exceeds_funds";
    case "prefinancing_within_funds":
      return "prefinancing_within_funds";
    default:
      return "unknown";
  }
}

/** Erstattungsrisiko je Bestellung (EUR); null ohne gültigen Verkaufspreis. */
export function refundExposure(priceGross: number | null, rules: LiquidityRules = LIQUIDITY_RULES): number | null {
  if (priceGross === null || !Number.isFinite(priceGross) || priceGross <= 0) return null;
  const v = rules.returnRateWorstCase * (priceGross + rules.returnShippingAssumption);
  return Number.isFinite(v) && v >= 0 ? round2(v) : null;
}

/**
 * Kapazität offener Bestellungen (fail-closed, keine Division durch 0):
 * - Vorfinanzierung: upfront > 0 ? floor(goodsFunds / (upfront + Erstattungsrisiko)) : 0 – ohne Kontonachweis immer 0
 * - Zahlungsziel: min(creditCapacity ?? 0, refundCapacity) mit refundCapacity = Kontonachweis && Erstattungsrisiko > 0
 *   ? floor(goodsFunds / Erstattungsrisiko) : 0. Ein Zahlungsziel allein trägt keine Bestellung: Erstattungen an Kunden
 *   müssen aus belegten eigenen Mitteln gedeckt sein.
 * - unbekannt: 0
 */
function capacityOf(
  status: LiquidityStatus,
  v: { goods: number; upfront: number | null; refund: number | null; creditCapacity: number | null; fundsVerified: boolean },
): number {
  switch (status) {
    case "prefinancing_unfunded":
      return 0;
    case "prefinancing_exceeds_funds":
    case "prefinancing_within_funds":
      return v.fundsVerified && v.upfront !== null && v.upfront > 0 && v.refund !== null ? safeCount(v.goods / (v.upfront + v.refund)) : 0;
    case "terms_unsecured":
    case "terms_cover_worst_case": {
      const refundCapacity = v.fundsVerified && v.refund !== null && v.refund > 0 ? safeCount(v.goods / v.refund) : 0;
      return safeCount(Math.min(v.creditCapacity ?? 0, refundCapacity));
    }
    case "unknown":
      return 0;
    default: {
      const unreachable: never = status;
      void unreachable;
      return 0;
    }
  }
}

/**
 * Bewertet die Liquidität einer Kalkulationsbasis: Je Basisangebot laufen assessFinancing und assessFunding mit
 * derselben Worst-Case-Regelbasis (Auszahlung des Zahlungsanbieters im Worst Case + Puffer); maßgeblich ist das
 * ungünstigste Angebot. Als verfügbare Mittel zählen nur die belegten Mittel für Wareneinkauf (goodsFunds, bereits ohne
 * Sicherheitsreserve) zuzüglich der Reserve, die assessFunding selbst wieder abzieht – die Reserve wird nie eingeplant.
 * `priceGross` (brutto) beziffert das Erstattungsrisiko; ohne Preis gibt es keine Kapazität. `budget` ist nur für
 * Tests überschreibbar; die Pipeline nutzt immer BUDGET.
 */
export function assessLiquidity(
  basis: BasisCandidate,
  priceGross: number | null,
  ctx: FundingContext = DEFAULT_FUNDING_CONTEXT,
  rules: LiquidityRules = LIQUIDITY_RULES,
  budget: GoodsBudget = BUDGET,
): LiquidityAssessment {
  const wc = worstCaseScoutRules(rules);
  const goods = goodsFunds(budget, { availableFunds: ctx.availableFunds, verified: ctx.fundsVerified, safetyReserve: ctx.safetyReserve });
  const fundingCtx: FundingContext = { ...ctx, availableFunds: goods + ctx.safetyReserve };
  const refund = refundExposure(priceGross, rules);
  const assessed = basis.perVariant.map((v) => {
    const financing = assessFinancing(v.evaluation.quote, wc);
    const funding = assessFunding({ quote: v.evaluation.quote, financing, cost: v.evaluation.cost }, fundingCtx, wc);
    return { financing, funding, status: statusOf(financing, funding), quote: v.evaluation.quote };
  });
  if (assessed.length === 0) {
    const financing = { status: "unknown", termDays: null, requiresPrefinancing: true, label: "Kein Basisangebot" } as const;
    return {
      status: "unknown",
      securedWithoutPrefinancing: false,
      financing,
      funding: { status: "unknown", orderCost: null, upfrontAmount: null, paymentDueDays: null, payoutDays: wc.payoutDelayDays, gapDays: null, headroom: 0, fundsVerified: ctx.fundsVerified, label: "Kein Basisangebot", details: [] },
      goodsFunds: goods,
      upfrontPerOrder: null,
      refundExposurePerOrder: refund,
      creditCapacity: null,
      maxOpenOrders: 0,
      maxOrdersPerDay: 0,
      codes: [],
      details: ["Kein Basisangebot – Liquidität nicht bewertbar.", "Kapazität: 0 offene Bestellungen."],
    };
  }
  const worst = assessed.reduce((a, b) => (SEVERITY[b.status] > SEVERITY[a.status] ? b : a));
  const status = worst.status;

  // Beträge je Kundenbestellung im Worst Case über die Varianten (eine Bestellung = eine beliebige Variante)
  const upfrontPerOrder = status === "unknown" ? null : maxOrNull(assessed.map((a) => a.funding.upfrontAmount));
  const orderCost = maxOrNull(assessed.map((a) => a.funding.orderCost));
  const creditLimits = assessed.map((a) =>
    isConfirmed(a.quote.payment.creditLimit, (v) => Number.isFinite(v) && v > 0) ? (factValue(a.quote.payment.creditLimit) as number) : null,
  );
  const creditCapacity =
    creditLimits.every((c): c is number => c !== null) && orderCost !== null && orderCost > 0 ? safeCount(Math.min(...creditLimits) / orderCost) : null;
  const maxOpenOrders = capacityOf(status, { goods, upfront: upfrontPerOrder, refund, creditCapacity, fundsVerified: ctx.fundsVerified });
  // Bindungsdauer (konservativ): Vorfinanzierung bis zur Auszahlung (Lücke), Kreditrahmen bis zur Fälligkeit (Zahlungsziel)
  const bindingDays = isPrefinancing(status) ? worst.funding.gapDays : worst.financing.termDays;
  const maxOrdersPerDay = safeCount(maxOpenOrders / Math.max(1, bindingDays !== null && Number.isFinite(bindingDays) ? bindingDays : 1));

  const codes: ReasonCode[] = [];
  if (creditLimits.some((c) => c === null)) codes.push("LIQ_CREDIT_UNKNOWN");
  if (!assessed.every((a) => isConfirmed(a.quote.dropshipping.returnsHandledBy, (v) => v === "supplier"))) codes.push("LIQ_REFUND_UNKNOWN");
  const terms = status === "terms_unsecured" || status === "terms_cover_worst_case";
  const details = [
    LIQUIDITY_STATUS_LABELS[status] + ".",
    `Worst-Case-Auszahlung ${wc.payoutDelayDays} Tage (${rules.payoutDelayWorstCaseDays} + ${rules.termBufferDays} Puffer).`,
    ...(ctx.fundsVerified ? [] : ["Mittel ohne Kontonachweis – keine Vorfinanzierung und kein Erstattungsrisiko gilt als gedeckt."]),
    ...(terms ? ["Ein Zahlungsziel allein sichert nie „vorfinanzierungsfrei“ – Fristbeginn, Kreditrahmen und Mittel für Erstattungen müssen belegt sein."] : []),
    ...(codes.includes("LIQ_CREDIT_UNKNOWN") ? ["Kreditrahmen beim Lieferanten unbelegt."] : []),
    ...(codes.includes("LIQ_REFUND_UNKNOWN") ? ["Rücknahme mit Gutschrift durch den Lieferanten unbelegt – Warenwert bei Retouren als Verlust angenommen."] : []),
    ...(refund === null ? ["Ohne Verkaufspreis ist das Erstattungsrisiko nicht bezifferbar – keine Kapazität angenommen."] : []),
    status === "prefinancing_unfunded"
      ? "0 offene vorfinanzierte Bestellungen – Mittel unbelegt."
      : `Kapazität: ${maxOpenOrders} offene Bestellung${maxOpenOrders === 1 ? "" : "en"}, ${maxOrdersPerDay} je Tag (Sicherheitsreserve nie eingeplant).`,
  ];
  return {
    status,
    securedWithoutPrefinancing: false,
    financing: worst.financing,
    funding: worst.funding,
    goodsFunds: goods,
    upfrontPerOrder,
    refundExposurePerOrder: refund,
    creditCapacity,
    maxOpenOrders,
    maxOrdersPerDay,
    codes,
    details,
  };
}

/** Wirkung einer Liquiditätsbewertung auf die Stufe „profit“ (Profit Controller). */
export interface LiquidityStageEffect {
  /** blocked = Kette läuft weiter, nie automatisierbar; deferred = zurückgestellt */
  status: "blocked" | "deferred";
  /** Status-Code(s) zuerst, dann die Hinweis-Codes der Bewertung */
  codes: ReasonCode[];
}

/**
 * Vollständige, fail-closed Zuordnung Liquiditätsstatus → Stufe. Jeder Status hat genau eine Wirkung; ein neuer Status
 * lässt die Typprüfung (never) fehlschlagen. Nichts ergibt „ok“: In Phase 1 ist keine Liquidität vollständig belegt.
 * `terms_unsecured` sperrt nur (Prüfung durch Menschen möglich, nie automatisierbar) – Entscheidung des Inhabers offen
 * (Entscheidung 4); die konservative Voreinstellung steht in REASON_META (LIQ_TERM_UNSECURED: block).
 */
export function liquidityStageEffect(liq: Pick<LiquidityAssessment, "status" | "maxOpenOrders" | "codes">): LiquidityStageEffect {
  const capacityZero = !(Number.isFinite(liq.maxOpenOrders) && liq.maxOpenOrders > 0);
  const hints = liq.codes;
  const prefinancing = (code: ReasonCode): LiquidityStageEffect => ({
    status: "deferred",
    codes: [code, ...(capacityZero ? (["LIQ_CAPACITY_ZERO"] as const) : []), ...hints],
  });
  switch (liq.status) {
    case "unknown":
      return { status: "deferred", codes: ["LIQ_UNKNOWN", ...hints] };
    case "prefinancing_unfunded":
      return prefinancing("LIQ_PREFINANCING_UNFUNDED");
    case "prefinancing_exceeds_funds":
      return prefinancing("LIQ_PREFINANCING_EXCEEDS");
    case "prefinancing_within_funds":
      // Ziel ist „keine Vorfinanzierung“: nie automatisierbar; ohne Kapazität zurückgestellt
      return capacityZero ? prefinancing("LIQ_PREFINANCING_REQUIRED") : { status: "blocked", codes: ["LIQ_PREFINANCING_REQUIRED", ...hints] };
    case "terms_unsecured":
    // In Phase 1 nicht erreichbar; falls doch: wie terms_unsecured (Fristbeginn nicht nachweisbar)
    case "terms_cover_worst_case":
      return { status: "blocked", codes: ["LIQ_TERM_UNSECURED", ...hints] };
    default: {
      const unreachable: never = liq.status;
      void unreachable;
      return { status: "deferred", codes: ["LIQ_UNKNOWN", ...hints] };
    }
  }
}

/**
 * Geplante verkaufbare Menge je Variante (nur für das Entwurfs-Artefakt, nie für shopifyInput):
 * min(bestätigter Lieferantenbestand − stockBuffer, maxAvailablePerVariant); die Summe über die Varianten ist
 * ≤ maxOpenOrders, deterministisch in Variantenreihenfolge gekürzt. Unbestätigter oder unbekannter Bestand bzw.
 * Kapazität 0 ergibt 0 – in Phase 1 wegen goodsFunds = 0 der Normalfall und so beabsichtigt.
 */
export function plannedAvailability(
  basis: BasisCandidate,
  liq: Pick<LiquidityAssessment, "maxOpenOrders">,
  rules: LiquidityRules = LIQUIDITY_RULES,
): { shopSku: string; plannedAvailable: number }[] {
  let remaining = safeCount(liq.maxOpenOrders);
  return basis.perVariant.map((v) => {
    const stock = v.evaluation.quote.fulfillment.stock;
    const confirmedStock = isConfirmed(stock, (n) => Number.isFinite(n) && n >= 0) ? (factValue(stock) as number) : null;
    const wanted = confirmedStock === null ? 0 : Math.min(safeCount(confirmedStock - rules.stockBuffer), safeCount(rules.maxAvailablePerVariant));
    const planned = Math.min(wanted, remaining);
    remaining -= planned;
    return { shopSku: v.shopSku, plannedAvailable: planned };
  });
}
