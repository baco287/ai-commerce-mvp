// Profit Controller des Market Scout – nutzt ausschließlich die bestehende Kalkulation (calc/pricing.ts).
// checkProfit: Deckungsbeitrag mit Steuerstatus und die Frage, ob das Ergebnis VERLÄSSLICH ist (unverändert).
// checkUnitEconomics (Paket C): Stückrechnung je Verkauf über die Kalkulationsbasis – Worst-Case-Stückkosten über die
// Varianten plus Bearbeitungsgebühr, Einzelstückprüfung (Mindestabnahme/Mindestbestellwert) und Retouren-Stress mit
// Warenverlust. Es gibt keine zweite Margenrechnung: Die Marge kommt immer aus checkProfit → calculateMargin.

import { calculateMargin, type MarginBreakdown } from "@/lib/calc/pricing";
import { ASSUMPTIONS, RECOMMENDATION_RULES, TAX_SETTINGS, type TaxStatus } from "@/lib/config/assumptions";
import { isConfirmed, LIQUIDITY_RULES, type BasisCandidate, type Fact, type LiquidityRules, type QuoteEvaluation } from "@/lib/suppliers";
import { MARKET_SCAN, PROFIT_RULES, type ProfitRules } from "./config";
import type { ReasonCode } from "./reasons";

/**
 * Herkunft des Verkaufspreises:
 * - market      – belegte Marktbeobachtung, höchstens MARKET_SCAN.staleAfterDays alt
 * - plan        – Planwert (oder veraltete Marktbeobachtung)
 * - demo_target – Demo-Zielpreis
 * - none        – kein Preis
 */
export type PriceSource = "market" | "plan" | "demo_target" | "none";

/** Verkaufspreis eines Kandidaten (Katalog: salePrice; Demo: Zielpreis des Demo-Produkts). */
export interface SalePrice {
  /** Brutto (EUR) */
  gross: number;
  basis: "market_observation" | "plan" | "demo_target";
  /** Beleg bzw. Herleitung */
  reference?: string;
  /** Datum der Beobachtung bzw. Prüfung (ISO) */
  checkedAt?: string;
}

const DAY_MS = 86_400_000;

/** Ein Katalogpreis „market_observation“ zählt nur bis staleAfterDays als Marktpreis, danach als Planwert. */
export function priceSourceOf(price: SalePrice | null, now: Date, staleAfterDays: number = MARKET_SCAN.staleAfterDays): PriceSource {
  if (!price || !Number.isFinite(price.gross) || price.gross <= 0) return "none";
  if (price.basis === "demo_target") return "demo_target";
  if (price.basis !== "market_observation" || !price.checkedAt) return "plan";
  const checked = Date.parse(price.checkedAt);
  const age = now.getTime() - checked;
  return Number.isFinite(checked) && age >= 0 && age <= staleAfterDays * DAY_MS ? "market" : "plan";
}

export interface ProfitInput {
  /** Geplanter Verkaufspreis brutto; null = kein Preis bekannt */
  priceGross: number | null;
  priceSource: PriceSource;
  /** Einkauf + Versand + Import je Stück, netto; null = kein geeigneter Lieferant */
  landedCostNet: number | null;
  /** Kosten aus nachgewiesenen (nicht nur angegebenen) Lieferantendaten */
  costVerified: boolean;
  demo: boolean;
}

export interface ProfitCheck {
  taxStatus: TaxStatus;
  /** null = nicht berechenbar */
  margin: MarginBreakdown | null;
  /** Darf die Marge als Entscheidungsgrundlage gelten? */
  reliable: boolean;
  /** Warum die Marge fehlt oder nicht verlässlich ist */
  reasons: string[];
}

/**
 * Deckungsbeitrag nach MwSt. (je Steuerstatus), Zahlungsgebühr, Werbekosten je Verkauf (Annahme) und Retourenreserve.
 * Kleinunternehmer: keine USt. auf den Verkauf, dafür wird die nicht abziehbare Vorsteuer auf die Kosten aufgeschlagen.
 */
export function checkProfit(input: ProfitInput, tax = TAX_SETTINGS): ProfitCheck {
  const reasons: string[] = [];
  if (input.priceGross === null) reasons.push("Kein belegter Verkaufspreis (keine Marktpreisquelle angebunden).");
  if (input.landedCostNet === null) reasons.push("Keine Einkaufskosten – kein geeigneter Lieferant.");
  if (input.priceGross === null || input.landedCostNet === null) {
    return { taxStatus: tax.status, margin: null, reliable: false, reasons };
  }

  const margin =
    tax.status === "kleinunternehmer"
      ? calculateMargin(input.priceGross, input.landedCostNet * (1 + ASSUMPTIONS.vatRate), { ...ASSUMPTIONS, vatRate: 0 })
      : calculateMargin(input.priceGross, input.landedCostNet);

  if (input.demo) reasons.push("Demo-Daten (Preis und/oder Lieferant simuliert).");
  if (input.priceSource !== "market") reasons.push("Verkaufspreis ist ein Planwert, kein belegter Marktpreis.");
  if (!input.costVerified) reasons.push("Einkaufskosten nicht nachgewiesen.");
  if (!tax.confirmed) reasons.push(`Steuerstatus „${tax.status}“ noch nicht bestätigt.`);
  reasons.push(`Werbekosten je Verkauf sind eine Annahme (${ASSUMPTIONS.adCostPerOrder.toFixed(2).replace(".", ",")} €).`);

  const reliable = !input.demo && input.priceSource === "market" && input.costVerified && tax.confirmed;
  return { taxStatus: tax.status, margin, reliable, reasons };
}

// ---------------------------------------------------------------------------------------------------------------
// Stückrechnung (Profit Controller)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Einzelstückbezug:
 * - proven  – Mindestabnahme ≤ 1 und Mindestbestellwert ≤ Warenwert eines Stücks, beides bestätigt
 * - stated  – beides angegeben und passend, aber mindestens eines nur unbestätigt
 * - unknown – eines fehlt oder passt nicht (fail-closed)
 */
export type SingleUnitStatus = "proven" | "stated" | "unknown";

export interface UnitEconomics extends ProfitCheck {
  priceGross: number | null;
  priceSource: PriceSource;
  priceReference?: string;
  /** Höchste Stückkosten über die Varianten (CostBreakdown.perUnit) + Bearbeitungsgebühr – VERTRAULICH */
  perUnitWorstCase: number | null;
  /**
   * Deckungsbeitrag im Retouren-Stress (EUR) – VERTRAULICH:
   * (1 − r) × c0 − r × Verlust je Retoure, c0 = Deckungsbeitrag ohne die Retourenrückstellung aus calculateMargin
   */
  stressContribution: number | null;
  /** Höchste Mindestabnahme bzw. höchster Mindestbestellwert über die Basisangebote; null = mindestens einer fehlt */
  singleUnit: { moq: number | null; mov: number | null; status: SingleUnitStatus };
  /** Begründungs-Codes der Stückrechnung (ohne Liquidität) */
  codes: ReasonCode[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const eur = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;
const SINGLE_UNIT_RANK: Record<SingleUnitStatus, number> = { proven: 0, stated: 1, unknown: 2 };
const maxOrNull = (values: (number | undefined)[]) =>
  values.length > 0 && values.every((v): v is number => v !== undefined && Number.isFinite(v)) ? Math.max(...values) : null;
const valueOf = (f: Fact<number>) => (f.status === "missing" ? undefined : f.value);

/** Einzelstückprüfung eines Basisangebots (Bestellmenge 1). */
function singleUnitOf(e: QuoteEvaluation): SingleUnitStatus {
  const { minOrderQuantity: moqFact, minOrderValue: movFact } = e.quote.pricing;
  const moq = valueOf(moqFact);
  const mov = valueOf(movFact);
  const orderValue = e.cost?.unitPrice;
  if (moq === undefined || mov === undefined || orderValue === undefined) return "unknown";
  if (!Number.isFinite(moq) || moq > 1 || !Number.isFinite(mov) || mov > orderValue) return "unknown";
  return isConfirmed(moqFact) && isConfirmed(movFact) ? "proven" : "stated";
}

/**
 * Stückrechnung je Verkauf über die Kalkulationsbasis (Worst Case über die Varianten).
 * - Marge: checkProfit(landedCostNet = perUnitWorstCase, costVerified = alle Basisangebote aus Preislisten mit
 *   bestätigtem Einkaufspreis) – keine zweite Kalkulation.
 * - Retouren-Stress (unbekannte Werte im Worst Case, nie zurückgestellt):
 *     r = returnRateWorstCase, c0 = contribution + returnsReserve (keine Doppelzählung der Rückstellung)
 *     Verlust = Werbekosten + Versand + Rücksendung + Zahlungsgebühr + Bearbeitungsgebühr + Warenverlust
 *     Warenverlust = 0 nur bei bestätigter Rücknahme mit Gutschrift durch ALLE Basislieferanten, sonst Wareneinsatz
 *     netto (Einkauf + Import, ohne Versand)
 *     stressContribution = (1 − r) × c0 − r × Verlust
 * - Codes: PRICE_MISSING, MARGIN_LOW (< watchMinMargin), MARGIN_BELOW_MIN (< minContributionEur),
 *   MARGIN_STRESS_NEGATIVE (≤ 0), SINGLE_UNIT_UNPROVEN, SINGLE_UNIT_STATED, MARGIN_UNRELIABLE. Demo-Kandidaten erhalten
 *   stattdessen DEMO_DATA (gesperrt); Margen-Schwellen und fehlender Einzelstückbeleg stehen dort nur als Text.
 */
export function checkUnitEconomics(
  input: { price: SalePrice | null; basis: BasisCandidate | null; demo: boolean; now: Date },
  rules: ProfitRules = PROFIT_RULES,
  liq: LiquidityRules = LIQUIDITY_RULES,
  tax = TAX_SETTINGS,
): UnitEconomics {
  const priceSource = priceSourceOf(input.price, input.now);
  const priceGross = priceSource === "none" || !input.price ? null : input.price.gross;
  const evaluations = input.basis?.perVariant.map((v) => v.evaluation) ?? [];
  const costs = evaluations.map((e) => e.cost);
  const allCosts = costs.length > 0 && costs.every((c) => c !== null && Number.isFinite(c.perUnit));
  const perUnitWorstCase = allCosts ? round2(Math.max(...costs.map((c) => c!.perUnit)) + rules.handlingFeeAssumption) : null;
  const costVerified =
    evaluations.length > 0 && evaluations.every((e) => e.quote.provenance?.kind === "price_list" && isConfirmed(e.quote.pricing.unitPrice));
  const demo = input.demo || !!input.basis?.demo;
  const profit = checkProfit({ priceGross, priceSource, landedCostNet: perUnitWorstCase, costVerified, demo }, tax);

  // Einzelstück: ungünstigstes Basisangebot
  const singleStatus = evaluations.length === 0 ? "unknown" : evaluations.map(singleUnitOf).reduce((a, b) => (SINGLE_UNIT_RANK[b] > SINGLE_UNIT_RANK[a] ? b : a));
  const singleUnit = {
    moq: maxOrNull(evaluations.map((e) => valueOf(e.quote.pricing.minOrderQuantity))),
    mov: maxOrNull(evaluations.map((e) => valueOf(e.quote.pricing.minOrderValue))),
    status: singleStatus,
  };

  // Retouren-Stress
  let stressContribution: number | null = null;
  const supplierTakesBack =
    evaluations.length > 0 && evaluations.every((e) => isConfirmed(e.quote.dropshipping.returnsHandledBy, (v) => v === "supplier"));
  if (profit.margin && allCosts) {
    const m = profit.margin;
    // Kleinunternehmer: Vorsteuer nicht abziehbar – Kosten wie in checkProfit brutto
    const costFactor = tax.status === "kleinunternehmer" ? 1 + ASSUMPTIONS.vatRate : 1;
    const r = liq.returnRateWorstCase;
    const c0 = m.contribution + m.returnsReserve;
    const shipping = Math.max(...costs.map((c) => c!.shippingCost)) * costFactor;
    const goods = Math.max(...costs.map((c) => c!.unitPrice + c!.importCost)) * costFactor;
    const loss = m.adCost + shipping + liq.returnShippingAssumption + m.paymentFee + rules.handlingFeeAssumption * costFactor + (supplierTakesBack ? 0 : goods);
    const stress = (1 - r) * c0 - r * loss;
    stressContribution = Number.isFinite(stress) ? round2(stress) : null;
  }

  const codes: ReasonCode[] = [];
  const reasons = [...profit.reasons];
  // Demo-Daten sind nie Entscheidungsgrundlage: immer gesperrt (DEMO_DATA). Margen-Schwellen werden für Demo nur
  // protokolliert, damit die Demo die ganze Kette zeigen kann; echte Kandidaten werden zurückgestellt.
  if (demo) codes.push("DEMO_DATA");
  const marginCode = (code: ReasonCode, text: string) => {
    if (!demo) codes.push(code);
    reasons.push(demo ? `${text} (Demo – nur Hinweis)` : text);
  };
  if (priceGross === null) codes.push("PRICE_MISSING");
  if (perUnitWorstCase === null) codes.push("SUPPLIER_NONE");
  if (profit.margin) {
    if (profit.margin.marginPercent < RECOMMENDATION_RULES.watchMinMargin) {
      marginCode("MARGIN_LOW", `Marge unter ${Math.round(RECOMMENDATION_RULES.watchMinMargin * 100)} %.`);
    }
    if (profit.margin.contribution < rules.minContributionEur) {
      marginCode("MARGIN_BELOW_MIN", `Deckungsbeitrag unter dem Mindestwert von ${eur(rules.minContributionEur)} je Verkauf.`);
    }
    if (stressContribution === null || stressContribution <= 0) {
      marginCode(
        "MARGIN_STRESS_NEGATIVE",
        `Deckungsbeitrag im Retouren-Stress (${Math.round(liq.returnRateWorstCase * 100)} % Retouren${supplierTakesBack ? "" : ", Warenwert als Verlust"}) nicht positiv.`,
      );
    }
  }
  if (!supplierTakesBack && evaluations.length > 0) reasons.push("Rücknahme mit Gutschrift unbelegt – im Retouren-Stress ist der Warenwert verloren.");
  if (singleUnit.status === "unknown") {
    // Echte Kandidaten werden zurückgestellt; Demo-Kandidaten nur mit Hinweis (Demo bleibt ohnehin gesperrt)
    if (!demo) codes.push("SINGLE_UNIT_UNPROVEN");
    reasons.push("Einzelstückbezug nicht belegt – Mindestabnahme bzw. Mindestbestellwert fehlt oder passt nicht zu einem Stück.");
  } else if (singleUnit.status === "stated") {
    // Entscheidung des Inhabers offen (Entscheidung 3) – Voreinstellung: nur Hinweis, Marge nicht verlässlich
    codes.push("SINGLE_UNIT_STATED");
    reasons.push("Einzelstückbezug nur vom Lieferanten angegeben – Marge nicht verlässlich.");
  }
  const reliable = profit.reliable && singleUnit.status === "proven";
  if (profit.margin && !reliable) codes.push("MARGIN_UNRELIABLE");

  return {
    ...profit,
    reliable,
    reasons,
    priceGross,
    priceSource,
    ...(input.price?.reference !== undefined && priceSource !== "none" && { priceReference: input.price.reference }),
    perUnitWorstCase,
    stressContribution,
    singleUnit,
    codes,
  };
}
