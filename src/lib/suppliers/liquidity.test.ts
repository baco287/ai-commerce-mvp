// Liquidität im Worst Case und gemeinsame Basisauswahl (Paket B), Kapazität, Erstattungsrisiko, Zuordnung zur Stufe
// und geplante Menge (Paket C). Nur synthetische Testdaten.

import { describe, expect, it } from "vitest";
import { BUDGET, FUNDING } from "@/lib/config/budget";
import { compareQuotes, selectCalculationBasis, type BasisCandidate } from "./compare";
import { DEMO_QUERIES, demoQuotesFor } from "./demo/demo-suppliers";
import type { FundingContext } from "./funding";
import { assessLiquidity, goodsFunds, LIQUIDITY_RULES, liquidityStageEffect, plannedAvailability, worstCaseScoutRules } from "./liquidity";
import { missing, supplierStated, type ProductQuery, type SupplierQuote } from "./model";
import { buildQuote, ok, type QuoteOverrides } from "./quote-builder";

const query: ProductQuery = { productId: "p-test", title: "Testprodukt", gtin: "2000000000015", quantity: 1, destinationCountry: "DE", safety: { ceRequired: true } };
const quote = (id: string, o: Partial<QuoteOverrides> = {}): SupplierQuote =>
  buildQuote({ id, supplierName: `Lieferant ${id}`, supplierId: id, ...o });
const basisOf = (q: SupplierQuote): BasisCandidate => {
  const c = compareQuotes(query, [q]);
  return { supplierId: q.supplierId, supplierName: q.supplierName, demo: q.demo, perVariant: [{ shopSku: "S", evaluation: [...c.eligible, ...c.excluded][0] }] };
};
const verified = (availableFunds: number): FundingContext => ({ availableFunds, fundsVerified: true, fundsSource: "Kontoauszug (Test)", safetyReserve: FUNDING.safetyReserve });

describe("Mittel für Wareneinkauf", () => {
  it("sind ohne Kontonachweis 0 € – und mit heutigem Budget auch mit Nachweis 0 € (kein Topf für Wareneinkauf)", () => {
    expect(goodsFunds()).toBe(0);
    expect(goodsFunds(BUDGET, { availableFunds: 500, verified: true, safetyReserve: 70 })).toBe(0);
  });

  it("zählen ausgegebenes Geld nicht doppelt und begrenzen auf den Kontostand", () => {
    const budget = { total: 500, spent: 150, plannedAllocation: [{ key: "shop", amount: 150 }, { key: "reserve", amount: 70 }] };
    // 500 − 150 = 350 frei; offene Töpfe max(0, 150 − 150) = 0; Reserve 70 → 280
    expect(goodsFunds(budget, { availableFunds: 1000, verified: true, safetyReserve: 70 })).toBe(280);
    // Kontostand kleiner als das Budget: 200 − 0 − 70
    expect(goodsFunds(budget, { availableFunds: 200, verified: true, safetyReserve: 70 })).toBe(130);
    expect(goodsFunds(budget, { availableFunds: Number.NaN, verified: true, safetyReserve: 70 })).toBe(0);
  });
});

describe("Liquidität im Worst Case", () => {
  it("rechnet mit 14 + 3 Tagen Auszahlung statt dem Erwartungswert von 7 Tagen", () => {
    expect(worstCaseScoutRules().payoutDelayDays).toBe(LIQUIDITY_RULES.payoutDelayWorstCaseDays + LIQUIDITY_RULES.termBufferDays);
    const prepay = assessLiquidity(basisOf(quote("v", { payment: { terms: ok({ kind: "prepayment" }), creditLimit: missing() } })), null);
    expect(prepay.funding.gapDays).toBe(17);
  });

  it("wertet Vorkasse ohne Kontonachweis als unbelegte Vorfinanzierung", () => {
    const l = assessLiquidity(basisOf(quote("v", { payment: { terms: ok({ kind: "prepayment" }), creditLimit: missing() } })), null);
    expect(l).toMatchObject({ status: "prefinancing_unfunded", securedWithoutPrefinancing: false, goodsFunds: 0 });
    // Mit Kontonachweis, aber ohne Mittel für Wareneinkauf: übersteigt die Mittel
    expect(assessLiquidity(basisOf(quote("v", { payment: { terms: ok({ kind: "prepayment" }), creditLimit: missing() } })), null, verified(500)).status).toBe(
      "prefinancing_exceeds_funds",
    );
  });

  it("wertet ein bestätigtes Zahlungsziel von 30 Tagen als unbelegt gesichert – nie als vorfinanzierungsfrei", () => {
    const l = assessLiquidity(basisOf(quote("n30", { payment: { terms: ok({ kind: "net_terms", days: 30 }), creditLimit: missing() } })), null);
    expect(l.status).toBe("terms_unsecured");
    expect(l.securedWithoutPrefinancing).toBe(false);
    expect(l.codes).toContain("LIQ_CREDIT_UNKNOWN");
  });

  it("wertet 14 Tage Zahlungsziel als Vorfinanzierung (Worst Case 17 Tage)", () => {
    expect(assessLiquidity(basisOf(quote("n14", { payment: { terms: ok({ kind: "net_terms", days: 14 }) } })), null).status).toBe("prefinancing_unfunded");
  });

  it("ist bei unbekannter Zahlungsbedingung „unknown“", () => {
    expect(assessLiquidity(basisOf(quote("u", { payment: { terms: missing() } })), null).status).toBe("unknown");
  });

  it("meldet unbelegte Rücknahme mit Gutschrift", () => {
    const l = assessLiquidity(basisOf(quote("r", { dropshipping: { returnsHandledBy: missing() } })), null);
    expect(l.codes).toContain("LIQ_REFUND_UNKNOWN");
    expect(assessLiquidity(basisOf(quote("r2")), null).codes).not.toContain("LIQ_REFUND_UNKNOWN");
  });
});

describe("Liquidität: Kapazität, Erstattungsrisiko und Zuordnung zur Stufe (Paket C)", () => {
  const prepay = () => quote("v", { payment: { terms: ok({ kind: "prepayment" }), creditLimit: missing() } });
  /** NUR TEST: Budget mit Umlauf-Topf (heute gibt es keinen – Entscheidung 7): 1000 − 0 − 70 Reserve = 930 € */
  const testBudget = { total: 1000, spent: 0, plannedAllocation: [{ key: "reserve", amount: 70 }] };
  const numbers = (l: ReturnType<typeof assessLiquidity>) =>
    [l.goodsFunds, l.upfrontPerOrder, l.refundExposurePerOrder, l.creditCapacity, l.maxOpenOrders, l.maxOrdersPerDay].filter((v) => v !== null) as number[];

  it("stellt Vorkasse ohne Kontonachweis zurück – 0 offene Bestellungen, Mittel unbelegt", () => {
    const l = assessLiquidity(basisOf(prepay()), 29.9);
    expect(l).toMatchObject({ status: "prefinancing_unfunded", maxOpenOrders: 0, maxOrdersPerDay: 0, securedWithoutPrefinancing: false });
    expect(l.details).toContain("0 offene vorfinanzierte Bestellungen – Mittel unbelegt.");
    expect(liquidityStageEffect(l)).toEqual({ status: "deferred", codes: ["LIQ_PREFINANCING_UNFUNDED", "LIQ_CAPACITY_ZERO", "LIQ_CREDIT_UNKNOWN"] });
  });

  it("sperrt ein bestätigtes 30-Tage-Ziel ohne Kreditrahmen nur (kein LIQ_CAPACITY_ZERO), ohne NaN/Infinity", () => {
    const l = assessLiquidity(basisOf(quote("n30", { payment: { terms: ok({ kind: "net_terms", days: 30 }), creditLimit: missing() } })), 29.9);
    expect(l).toMatchObject({ status: "terms_unsecured", upfrontPerOrder: 0, creditCapacity: null, maxOpenOrders: 0, securedWithoutPrefinancing: false });
    const effect = liquidityStageEffect(l);
    expect(effect.status).toBe("blocked");
    expect(effect.codes).toEqual(["LIQ_TERM_UNSECURED", "LIQ_CREDIT_UNKNOWN"]);
    expect(effect.codes).not.toContain("LIQ_CAPACITY_ZERO");
    expect(numbers(l).every(Number.isFinite)).toBe(true);
  });

  it("stellt unbekannte Zahlungsbedingungen zurück (LIQ_UNKNOWN)", () => {
    const l = assessLiquidity(basisOf(quote("u", { payment: { terms: missing() } })), 29.9);
    expect(l).toMatchObject({ status: "unknown", upfrontPerOrder: null, maxOpenOrders: 0 });
    expect(liquidityStageEffect(l)).toMatchObject({ status: "deferred", codes: ["LIQ_UNKNOWN"] });
  });

  it("rechnet bei Vorfinanzierung mit Kontonachweis floor(Mittel / (Vorkasse + Erstattungsrisiko))", () => {
    const l = assessLiquidity(basisOf(prepay()), 29.9, verified(1000), LIQUIDITY_RULES, testBudget);
    // Mittel 930; Vorkasse 10 + 3 = 13 €; Erstattungsrisiko 10 % × (29,90 + 5) = 3,49 €
    expect(l).toMatchObject({ status: "prefinancing_within_funds", goodsFunds: 930, upfrontPerOrder: 13, refundExposurePerOrder: 3.49 });
    expect(l.maxOpenOrders).toBe(Math.floor(930 / (13 + 3.49)));
    // Bindungsdauer = Lücke bis zur Worst-Case-Auszahlung (17 Tage)
    expect(l.maxOrdersPerDay).toBe(Math.floor(l.maxOpenOrders / 17));
    // Vorfinanzierung ist nie automatisierbar
    expect(liquidityStageEffect(l)).toEqual({ status: "blocked", codes: ["LIQ_PREFINANCING_REQUIRED", "LIQ_CREDIT_UNKNOWN"] });
    expect(l.securedWithoutPrefinancing).toBe(false);
  });

  it("begrenzt ein Zahlungsziel auf min(Kreditrahmen-Kapazität, Erstattungskapazität aus eigenen Mitteln)", () => {
    // buildQuote: net30 bestätigt, Kreditrahmen 500 € bestätigt, Bestellkosten 13 €
    const withFunds = assessLiquidity(basisOf(quote("n30")), 29.9, verified(1000), LIQUIDITY_RULES, testBudget);
    expect(withFunds.creditCapacity).toBe(Math.floor(500 / 13));
    expect(withFunds.maxOpenOrders).toBe(Math.min(Math.floor(500 / 13), Math.floor(930 / 3.49)));
    expect(withFunds.maxOrdersPerDay).toBe(Math.floor(withFunds.maxOpenOrders / 30));
    // Ohne Kontonachweis trägt der Kreditrahmen allein keine Bestellung: Erstattungen sind nicht gedeckt
    const without = assessLiquidity(basisOf(quote("n30")), 29.9);
    expect(without).toMatchObject({ status: "terms_unsecured", creditCapacity: Math.floor(500 / 13), maxOpenOrders: 0, securedWithoutPrefinancing: false });
    // Ohne Verkaufspreis ist das Erstattungsrisiko nicht bezifferbar → keine Kapazität
    const noPrice = assessLiquidity(basisOf(quote("n30")), null, verified(1000), LIQUIDITY_RULES, testBudget);
    expect(noPrice).toMatchObject({ refundExposurePerOrder: null, maxOpenOrders: 0 });
  });

  it("ordnet jeden Status genau einer Wirkung zu – nie „ok“", () => {
    const statuses = ["terms_cover_worst_case", "terms_unsecured", "prefinancing_unfunded", "prefinancing_exceeds_funds", "prefinancing_within_funds", "unknown"] as const;
    const table = statuses.map((status) => [status, liquidityStageEffect({ status, maxOpenOrders: 3, codes: [] })]);
    expect(table).toEqual([
      ["terms_cover_worst_case", { status: "blocked", codes: ["LIQ_TERM_UNSECURED"] }],
      ["terms_unsecured", { status: "blocked", codes: ["LIQ_TERM_UNSECURED"] }],
      ["prefinancing_unfunded", { status: "deferred", codes: ["LIQ_PREFINANCING_UNFUNDED"] }],
      ["prefinancing_exceeds_funds", { status: "deferred", codes: ["LIQ_PREFINANCING_EXCEEDS"] }],
      ["prefinancing_within_funds", { status: "blocked", codes: ["LIQ_PREFINANCING_REQUIRED"] }],
      ["unknown", { status: "deferred", codes: ["LIQ_UNKNOWN"] }],
    ]);
    // Kapazität 0 stellt nur Vorfinanzierungs-Status zusätzlich zurück
    expect(liquidityStageEffect({ status: "prefinancing_within_funds", maxOpenOrders: 0, codes: [] })).toEqual({ status: "deferred", codes: ["LIQ_PREFINANCING_REQUIRED", "LIQ_CAPACITY_ZERO"] });
    expect(liquidityStageEffect({ status: "terms_unsecured", maxOpenOrders: Number.NaN, codes: [] }).codes).toEqual(["LIQ_TERM_UNSECURED"]);
  });

  it("meldet mit heutigen Werten nie „vorfinanzierungsfrei gesichert“ und nie NaN/Infinity", () => {
    for (const q of [prepay(), quote("n30"), quote("n14", { payment: { terms: ok({ kind: "net_terms", days: 14 }) } }), quote("u", { payment: { terms: missing() } })]) {
      for (const price of [null, 29.9, Number.NaN, Number.POSITIVE_INFINITY]) {
        const l = assessLiquidity(basisOf(q), price);
        expect(l.securedWithoutPrefinancing).toBe(false);
        expect(numbers(l).every(Number.isFinite), `${q.id} ${price}`).toBe(true);
        expect(Number.isInteger(l.maxOpenOrders) && Number.isInteger(l.maxOrdersPerDay)).toBe(true);
      }
    }
  });
});

describe("Geplante verkaufbare Menge", () => {
  const twoVariants = (stock1: SupplierQuote["fulfillment"]["stock"], stock2: SupplierQuote["fulfillment"]["stock"]): BasisCandidate => {
    const a = basisOf(quote("a", { fulfillment: { stock: stock1 } }));
    const b = basisOf(quote("a", { id: "a-2", fulfillment: { stock: stock2 } }));
    return { ...a, perVariant: [{ ...a.perVariant[0], shopSku: "V1" }, { ...b.perVariant[0], shopSku: "V2" }] };
  };

  it("ist 0 bei unbekanntem oder unbestätigtem Bestand und höchstens 5 sonst", () => {
    expect(plannedAvailability(twoVariants(missing(), supplierStated(500, "Preisliste")), { maxOpenOrders: 100 })).toEqual([
      { shopSku: "V1", plannedAvailable: 0 },
      { shopSku: "V2", plannedAvailable: 0 },
    ]);
    expect(plannedAvailability(twoVariants(ok(500), ok(4)), { maxOpenOrders: 100 })).toEqual([
      { shopSku: "V1", plannedAvailable: LIQUIDITY_RULES.maxAvailablePerVariant },
      { shopSku: "V2", plannedAvailable: 4 - LIQUIDITY_RULES.stockBuffer },
    ]);
  });

  it("kürzt deterministisch in Variantenreihenfolge auf die Kapazität (Summe ≤ maxOpenOrders)", () => {
    const planned = plannedAvailability(twoVariants(ok(500), ok(500)), { maxOpenOrders: 7 });
    expect(planned.map((p) => p.plannedAvailable)).toEqual([5, 2]);
    expect(plannedAvailability(twoVariants(ok(500), ok(500)), { maxOpenOrders: 0 }).every((p) => p.plannedAvailable === 0)).toBe(true);
    expect(plannedAvailability(twoVariants(ok(500), ok(500)), { maxOpenOrders: Number.POSITIVE_INFINITY }).every((p) => p.plannedAvailable === 0)).toBe(true);
  });

  it("ist mit heutigen Mitteln (0 € für Wareneinkauf) überall 0", () => {
    const basis = basisOf(quote("n30"));
    expect(plannedAvailability(basis, assessLiquidity(basis, 29.9))).toEqual([{ shopSku: "S", plannedAvailable: 0 }]);
  });
});

describe("Gemeinsame Basisauswahl: Liquidität vor Preis", () => {
  it("nimmt den teureren Lieferanten mit 30 Tagen Zahlungsziel vor dem günstigen mit 14 Tagen", () => {
    const cheap = quote("billig", { pricing: { unitPrice: ok(5), shippingCost: ok(2), importCost: ok(0) }, payment: { terms: ok({ kind: "net_terms", days: 14 }) } });
    const terms = quote("ziel30", { pricing: { unitPrice: ok(8), shippingCost: ok(2), importCost: ok(0) } });
    const r = selectCalculationBasis([{ shopSku: "S", comparison: compareQuotes(query, [cheap, terms]) }]);
    expect(r.basis?.supplierId).toBe("ziel30");
    expect(r.liquidity?.status).toBe("terms_unsecured");
    expect(r.considered).toEqual([
      { supplierId: "ziel30", status: "terms_unsecured" },
      { supplierId: "billig", status: "prefinancing_unfunded" },
    ]);
  });

  it("schließt Lieferanten aus, die nicht jede Variante abdecken, und entscheidet deterministisch", () => {
    const a1 = quote("a", { productId: "v1" });
    const b1 = quote("b", { productId: "v1" });
    const a2 = quote("a", { productId: "v2", id: "a-v2" });
    const r = selectCalculationBasis([
      { shopSku: "V1", comparison: compareQuotes(query, [b1, a1]) },
      { shopSku: "V2", comparison: compareQuotes(query, [a2]) },
    ]);
    expect(r.basis?.supplierId).toBe("a");
    expect(r.basis?.perVariant.map((v) => [v.shopSku, v.evaluation.quote.id])).toEqual([
      ["V1", "a"],
      ["V2", "a-v2"],
    ]);
    // Gleichstand in Liquidität, Preis und Lieferzeit → alphabetisch
    const tie = selectCalculationBasis([{ shopSku: "S", comparison: compareQuotes(query, [b1, a1]) }]);
    expect(tie.basis?.supplierId).toBe("a");
    expect(selectCalculationBasis([{ shopSku: "V1", comparison: compareQuotes(query, [b1]) }, { shopSku: "V2", comparison: compareQuotes(query, [a2]) }]).basis).toBeNull();
  });

  it("wählt für die Demo-LED-Lichtleiste den Lieferanten mit belegtem 30-Tage-Ziel (Pipeline), ohne die Dashboard-Basis zu ändern", () => {
    const led = DEMO_QUERIES["p-led"];
    const comparison = compareQuotes(led, demoQuotesFor("p-led"));
    expect(comparison.recommendations.cheapest?.quoteId).toBe("demo-eu:eurolight:p-led");
    expect(selectCalculationBasis([{ shopSku: "p-led", comparison }]).basis?.supplierId).toBe("lumio");
  });
});
