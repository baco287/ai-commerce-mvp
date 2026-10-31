// Profit Controller (Paket C): Stückrechnung, Einzelstück, Retouren-Stress und Preisherkunft. Nur synthetische Testdaten.

import { describe, expect, it } from "vitest";
import { calculateMargin } from "@/lib/calc/pricing";
import { compareQuotes, LIQUIDITY_RULES, missing, supplierStated, type BasisCandidate, type ProductQuery, type SupplierQuote } from "@/lib/suppliers";
import { buildQuote, ok, type QuoteOverrides } from "@/lib/suppliers/quote-builder";
import { MARKET_SCAN, PROFIT_RULES } from "./config";
import { checkUnitEconomics, priceSourceOf, type SalePrice } from "./profit";

const NOW = new Date("2026-10-31T08:00:00Z");
const query: ProductQuery = { productId: "p-test", title: "Testprodukt", gtin: "2000000000015", quantity: 1, destinationCountry: "DE", safety: { ceRequired: true } };
/** NUR TEST: echtes (nicht-Demo) Preislisten-Angebot mit bestätigten Werten. */
const real = (id: string, o: Partial<QuoteOverrides> = {}): SupplierQuote =>
  buildQuote({ id, supplierName: `Lieferant ${id}`, demo: false, provenance: { kind: "price_list" }, ...o });
const evaluationOf = (q: SupplierQuote) => {
  const c = compareQuotes(query, [q]);
  return [...c.eligible, ...c.excluded][0];
};
const basisOf = (...quotes: SupplierQuote[]): BasisCandidate => ({
  supplierId: quotes[0].supplierId,
  supplierName: quotes[0].supplierName,
  demo: quotes.some((q) => q.demo),
  perVariant: quotes.map((q, i) => ({ shopSku: `V${i + 1}`, evaluation: evaluationOf(q) })),
});
const plan = (gross: number): SalePrice => ({ gross, basis: "plan", reference: "Planpreis (Test)", checkedAt: "2026-10-30" });
const market = (gross: number, checkedAt = "2026-10-30"): SalePrice => ({ gross, basis: "market_observation", reference: "Beobachtung (Test)", checkedAt });
const confirmedTax = { status: "regelbesteuert" as const, confirmed: true };

describe("Preisherkunft", () => {
  it("wertet Marktbeobachtungen nur bis staleAfterDays als Marktpreis, sonst als Planwert", () => {
    expect(priceSourceOf(market(19.9), NOW)).toBe("market");
    const old = new Date(NOW.getTime() - (MARKET_SCAN.staleAfterDays + 1) * 86_400_000).toISOString();
    expect(priceSourceOf(market(19.9, old), NOW)).toBe("plan");
    expect(priceSourceOf(market(19.9, "2026-11-05"), NOW)).toBe("plan"); // Zukunft
    expect(priceSourceOf(plan(19.9), NOW)).toBe("plan");
    expect(priceSourceOf({ gross: 19.9, basis: "demo_target" }, NOW)).toBe("demo_target");
    expect(priceSourceOf(null, NOW)).toBe("none");
    expect(priceSourceOf(plan(0), NOW)).toBe("none");
  });
});

describe("Stückrechnung", () => {
  it("stellt ohne Verkaufspreis zurück (PRICE_MISSING)", () => {
    const e = checkUnitEconomics({ price: null, basis: basisOf(real("a")), demo: false, now: NOW });
    expect(e).toMatchObject({ margin: null, priceGross: null, priceSource: "none", stressContribution: null });
    expect(e.codes).toContain("PRICE_MISSING");
  });

  it("rechnet mit den teuersten Stückkosten über die Varianten plus Bearbeitungsgebühr – über checkProfit", () => {
    const cheap = real("a", { pricing: { unitPrice: ok(5), shippingCost: ok(2), importCost: ok(0) } });
    const dear = real("a", { id: "a-2", pricing: { unitPrice: ok(7), shippingCost: ok(2), importCost: ok(0) } });
    const e = checkUnitEconomics({ price: plan(29.9), basis: basisOf(cheap, dear), demo: false, now: NOW });
    expect(e.perUnitWorstCase).toBe(9 + PROFIT_RULES.handlingFeeAssumption);
    expect(e.margin).toEqual(calculateMargin(29.9, 9 + PROFIT_RULES.handlingFeeAssumption));
  });

  it("zählt die 3-%-Retourenrückstellung nicht doppelt: ohne Retouren ist der Stressbeitrag c0 = Beitrag + Rückstellung", () => {
    const e = checkUnitEconomics({ price: plan(29.9), basis: basisOf(real("a")), demo: false, now: NOW }, PROFIT_RULES, { ...LIQUIDITY_RULES, returnRateWorstCase: 0 });
    expect(e.stressContribution).toBeCloseTo(e.margin!.contribution + e.margin!.returnsReserve, 2);
  });

  it("rechnet den Warenwert als Verlust, wenn der Lieferant nicht bestätigt mit Gutschrift zurücknimmt", () => {
    const pricing = { unitPrice: ok(5), shippingCost: ok(2), importCost: ok(0) };
    const takesBack = checkUnitEconomics({ price: plan(19.9), basis: basisOf(real("a", { pricing })), demo: false, now: NOW });
    const shop = checkUnitEconomics({ price: plan(19.9), basis: basisOf(real("a", { pricing, dropshipping: { returnsHandledBy: ok("shop") } })), demo: false, now: NOW });
    const unknown = checkUnitEconomics({ price: plan(19.9), basis: basisOf(real("a", { pricing, dropshipping: { returnsHandledBy: missing() } })), demo: false, now: NOW });
    // Unterschied genau r × Wareneinsatz netto (Einkauf + Import, ohne Versand)
    expect(takesBack.stressContribution! - shop.stressContribution!).toBeCloseTo(LIQUIDITY_RULES.returnRateWorstCase * 5, 2);
    expect(unknown.stressContribution).toBe(shop.stressContribution);
    expect(takesBack.stressContribution).toBeGreaterThan(0);
    expect(shop.stressContribution).toBeLessThanOrEqual(0);
    expect(shop.codes).toContain("MARGIN_STRESS_NEGATIVE");
    expect(takesBack.codes).not.toContain("MARGIN_STRESS_NEGATIVE");
  });

  it("stellt bei Deckungsbeitrag unter dem Mindestwert zurück, auch wenn die Marge in Prozent reicht", () => {
    const e = checkUnitEconomics({ price: plan(14.9), basis: basisOf(real("a", { pricing: { unitPrice: ok(1), shippingCost: ok(0.5), importCost: ok(0) } })), demo: false, now: NOW });
    expect(e.margin!.contribution).toBeLessThan(PROFIT_RULES.minContributionEur);
    expect(e.margin!.marginPercent).toBeGreaterThan(0.1);
    expect(e.codes).toContain("MARGIN_BELOW_MIN");
    expect(e.codes).not.toContain("MARGIN_LOW");
  });

  it("meldet zu geringe Marge (MARGIN_LOW)", () => {
    const e = checkUnitEconomics({ price: plan(19.9), basis: basisOf(real("a", { pricing: { unitPrice: ok(9), shippingCost: ok(2), importCost: ok(0) } })), demo: false, now: NOW });
    expect(e.codes).toEqual(expect.arrayContaining(["MARGIN_LOW", "MARGIN_BELOW_MIN"]));
  });

  it("gilt nur mit Marktpreis, Preislisten-Kosten, bestätigtem Steuerstatus und belegtem Einzelstück als verlässlich", () => {
    const basis = basisOf(real("a"));
    expect(checkUnitEconomics({ price: market(29.9), basis, demo: false, now: NOW }, PROFIT_RULES, LIQUIDITY_RULES, confirmedTax).reliable).toBe(true);
    const planned = checkUnitEconomics({ price: plan(29.9), basis, demo: false, now: NOW }, PROFIT_RULES, LIQUIDITY_RULES, confirmedTax);
    expect(planned.reliable).toBe(false);
    expect(planned.codes).toContain("MARGIN_UNRELIABLE");
    // Heute ist der Steuerstatus unbestätigt → nie verlässlich
    expect(checkUnitEconomics({ price: market(29.9), basis, demo: false, now: NOW }).reliable).toBe(false);
    // Demo-Angebot: nie verlässlich
    expect(checkUnitEconomics({ price: market(29.9), basis: basisOf(buildQuote({ id: "d", supplierName: "Demo" })), demo: false, now: NOW }, PROFIT_RULES, LIQUIDITY_RULES, confirmedTax).reliable).toBe(false);
  });
});

describe("Einzelstückprüfung", () => {
  it("ist mit bestätigter Mindestabnahme ≤ 1 und Mindestbestellwert ≤ Warenwert belegt", () => {
    const e = checkUnitEconomics({ price: plan(29.9), basis: basisOf(real("a")), demo: false, now: NOW });
    expect(e.singleUnit).toEqual({ moq: 1, mov: 0, status: "proven" });
    expect(e.codes).not.toContain("SINGLE_UNIT_UNPROVEN");
  });

  it("stellt echte Kandidaten ohne Mindestabnahme bzw. Mindestbestellwert zurück (SINGLE_UNIT_UNPROVEN)", () => {
    const e = checkUnitEconomics({ price: plan(29.9), basis: basisOf(real("a", { pricing: { minOrderQuantity: missing(), minOrderValue: missing() } })), demo: false, now: NOW });
    expect(e.singleUnit).toEqual({ moq: null, mov: null, status: "unknown" });
    expect(e.codes).toContain("SINGLE_UNIT_UNPROVEN");
    expect(e.reliable).toBe(false);
  });

  it("vermerkt nur angegebene Werte als Hinweis und macht die Marge unzuverlässig (Entscheidung 3 offen)", () => {
    const stated = real("a", { pricing: { minOrderQuantity: supplierStated(1, "Preisliste"), minOrderValue: supplierStated(0, "Preisliste") } });
    const e = checkUnitEconomics({ price: market(29.9), basis: basisOf(stated), demo: false, now: NOW }, PROFIT_RULES, LIQUIDITY_RULES, confirmedTax);
    expect(e.singleUnit.status).toBe("stated");
    expect(e.codes).toContain("SINGLE_UNIT_STATED");
    expect(e.codes).not.toContain("SINGLE_UNIT_UNPROVEN");
    expect(e.reliable).toBe(false);
  });

  it("schließt eine Mindestabnahme von 10 Stück schon in der Eignungsprüfung aus (bestehender Code)", () => {
    const c = compareQuotes(query, [real("a", { pricing: { minOrderQuantity: ok(10) } })]);
    expect(c.eligible).toHaveLength(0);
    expect(c.excluded[0].eligibility.exclusions.map((x) => x.code)).toContain("stock_purchase_required");
  });
});

describe("Demo-Kandidaten", () => {
  it("sind immer gesperrt (DEMO_DATA); Margen-Schwellen stehen nur als Hinweis", () => {
    const demoQuote = buildQuote({ id: "d", supplierName: "Demo", pricing: { unitPrice: ok(9), shippingCost: ok(2), importCost: ok(0), minOrderQuantity: missing() } });
    const e = checkUnitEconomics({ price: { gross: 19.9, basis: "demo_target" }, basis: basisOf(demoQuote), demo: true, now: NOW });
    expect(e.priceSource).toBe("demo_target");
    expect(e.codes).toContain("DEMO_DATA");
    expect(e.codes.filter((c) => c.startsWith("MARGIN_") && c !== "MARGIN_UNRELIABLE")).toEqual([]);
    expect(e.codes).not.toContain("SINGLE_UNIT_UNPROVEN");
    expect(e.reasons.join(" ")).toMatch(/Demo – nur Hinweis/);
    expect(e.reliable).toBe(false);
  });
});
