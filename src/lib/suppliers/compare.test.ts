import { describe, expect, it } from "vitest";
import { compareQuotes } from "./compare";
import { missing, unconfirmed, type ProductQuery } from "./model";
import { buildQuote, ok, type QuoteOverrides } from "./quote-builder";
import { SCOUT_RULES } from "./rules";
import { costScore, reliabilityScore, scoreQuote, speedScore } from "./scoring";
import { assessFinancing } from "./financing";

const query: ProductQuery = {
  productId: "p-test",
  title: "Testprodukt",
  gtin: "2000000000015",
  quantity: 1,
  destinationCountry: "DE",
  safety: { ceRequired: true },
};

const said = <T>(v: T) => unconfirmed(v, "Selbstauskunft");
const quote = (o: Partial<QuoteOverrides> & { id: string }) => buildQuote({ supplierName: `Lieferant ${o.id}`, ...o });

/** Günstig, langsam, Vorkasse */
const cheap = quote({
  id: "cheap",
  pricing: { unitPrice: ok(6), shippingCost: ok(4), importCost: ok(1) },
  fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 8, max: 12 }) },
  payment: { terms: ok({ kind: "prepayment" }), creditLimit: missing() },
  reliability: { rating: ok(4.4), onTimeRate: ok(0.85), defectRate: ok(0.03) },
});
/** Teuer, sehr schnell */
const fast = quote({
  id: "fast",
  pricing: { unitPrice: ok(15), shippingCost: ok(3), importCost: ok(0) },
  fulfillment: { deliveryDays: ok({ min: 1, max: 2 }) },
});
/** Ausgewogen */
const balanced = quote({
  id: "balanced",
  pricing: { unitPrice: ok(8.5), shippingCost: ok(3), importCost: ok(0) },
  fulfillment: { shipsFrom: ok("PL"), deliveryDays: ok({ min: 3, max: 5 }) },
  payment: { terms: ok({ kind: "net_terms", days: 14 }), creditLimit: ok(300) },
});
/** Am günstigsten, aber Identität unklar */
const unclear = quote({
  id: "unclear",
  identity: { gtin: missing(), match: said("exact") },
  pricing: { unitPrice: ok(3), shippingCost: ok(2), importCost: ok(0) },
});

describe("Bewertung", () => {
  it("rechnet Kosten relativ zum günstigsten und Tempo linear zwischen Ideal und Maximum", () => {
    expect(costScore(10, 10)).toBe(100);
    expect(costScore(20, 10)).toBe(50);
    expect(speedScore(2)).toBe(100);
    expect(speedScore(1)).toBe(100);
    expect(speedScore(7)).toBe(50);
    expect(speedScore(SCOUT_RULES.maxDeliveryDays)).toBe(0);
  });

  it("belohnt fehlende oder unbestätigte Zuverlässigkeitsdaten nie", () => {
    const full = reliabilityScore(quote({ id: "a" }));
    const said80 = reliabilityScore(quote({ id: "b", reliability: { rating: said(4.6), onTimeRate: said(0.95), defectRate: said(0.01) } }));
    const none = reliabilityScore(quote({ id: "c", reliability: { rating: missing(), onTimeRate: missing(), defectRate: missing() } }));
    expect(said80).toBeCloseTo(full * 0.8);
    expect(none).toBe(0);
  });

  it("zieht je unbestätigter Angabe Punkte ab, gedeckelt", () => {
    const fin = assessFinancing(quote({ id: "x" }));
    const input = { perUnit: 13, cheapestPerUnit: 13, maxDeliveryDays: 4, financing: fin };
    const base = scoreQuote(quote({ id: "x" }), input);
    const one = scoreQuote(quote({ id: "y", pricing: { unitPrice: said(10) } }), input);
    const many = scoreQuote(
      quote({
        id: "z",
        pricing: { unitPrice: said(10), shippingCost: said(3), importCost: said(0) },
        fulfillment: { stock: said(500), deliveryDays: said({ min: 2, max: 4 }) },
        payment: { terms: ok({ kind: "net_terms", days: 30 }), creditLimit: missing() },
        reliability: { rating: said(4.6) },
      }),
      input,
    );
    expect(base.unconfirmedPenalty).toBe(0);
    expect(one).toMatchObject({ unconfirmedFacts: ["Einkaufspreis"], unconfirmedPenalty: 2 });
    expect(one.total).toBeCloseTo(base.total - 2, 5);
    expect(many.unconfirmedFacts).toHaveLength(6);
    expect(many.unconfirmedPenalty).toBe(SCOUT_RULES.maxUnconfirmedPenalty);
  });
});

describe("Vergleich und Empfehlung", () => {
  const result = compareQuotes(query, [cheap, fast, balanced, unclear]);

  it("ermittelt günstigsten, schnellsten und insgesamt besten geeigneten Lieferanten", () => {
    expect(result.recommendations.cheapest?.quoteId).toBe("cheap");
    expect(result.recommendations.fastest?.quoteId).toBe("fast");
    expect(result.recommendations.best?.quoteId).toBe("balanced");
    expect(result.eligible.map((e) => [e.quote.id, e.score?.total])).toEqual([
      // balanced: 0,4·95,7 + 0,25·70 + 0,25·91,8 + 0,1·100
      ["balanced", 88.7],
      // fast: 0,4·61,1 + 0,25·100 + 0,25·91,8 + 0,1·100
      ["fast", 82.4],
      // cheap: 0,4·100 + 0,25·0 + 0,25·81,3 + 0,1·0
      ["cheap", 60.3],
    ]);
  });

  it("listet ausgeschlossene Angebote mit Gründen und empfiehlt sie nie", () => {
    expect(result.excluded.map((e) => [e.quote.id, e.eligibility.exclusions.map((x) => x.code)])).toEqual([["unclear", ["identity_unconfirmed"]]]);
    expect(result.excluded[0].score).toBeNull();
    const recommended = Object.values(result.recommendations).map((r) => r?.quoteId);
    expect(recommended).not.toContain("unclear");
  });

  it("begründet jede Empfehlung nachvollziehbar", () => {
    const { cheapest, fastest, best } = result.recommendations;
    expect(cheapest?.reasons.join(" ")).toMatch(/Niedrigste Gesamtkosten.*11,00\s€ je Stück/);
    expect(cheapest?.reasons).toContain("Vorkasse – Vorfinanzierung nötig.");
    expect(fastest?.reasons[0]).toMatch(/1–2 Tage/);
    expect(fastest?.reasons[1]).toMatch(/3 Tage kürzer als bei Lieferant balanced/);
    expect(best?.reasons[0]).toBe("Höchste Gesamtbewertung: 88,7 von 100 (Kosten 95,7, Tempo 70, Zuverlässigkeit 91,8, Finanzierung 100).");
    expect(best?.reasons).toContain("Bestätigtes Zahlungsziel 14 Tage – keine Vorfinanzierung.");
    expect(best?.reasons.some((r) => r.includes("teurer als das günstigste Angebot (Lieferant cheap)"))).toBe(true);
    for (const r of [cheapest, fastest, best]) expect(r?.reasons).toContain("Demo-Daten – keine echte Einkaufsgrundlage.");
  });

  it("ist deterministisch und unabhängig von der Reihenfolge der Angebote", () => {
    const reversed = compareQuotes(query, [unclear, balanced, fast, cheap]);
    expect(reversed).toEqual(result);
  });

  it("löst Gleichstände eindeutig auf", () => {
    const a = quote({ id: "b-twin" });
    const b = quote({ id: "a-twin" });
    const r = compareQuotes(query, [a, b]);
    expect(r.recommendations.cheapest?.quoteId).toBe("a-twin");
    expect(r.recommendations.fastest?.quoteId).toBe("a-twin");
    expect(r.recommendations.best?.quoteId).toBe("a-twin");
    expect(r.recommendations.fastest?.reasons[1]).toMatch(/Gleiche Höchstlieferzeit/);
  });

  it("gibt keine Empfehlung, wenn kein Angebot geeignet ist", () => {
    const r = compareQuotes(query, [unclear]);
    expect(r.recommendations).toEqual({ cheapest: null, fastest: null, best: null });
    expect(r.notes).toContain("Kein geeignetes Angebot: alle 1 Angebote wurden ausgeschlossen.");
    expect(compareQuotes(query, []).notes).toContain("Keine Angebote gefunden.");
  });

  it("warnt, wenn alle geeigneten Angebote Vorfinanzierung brauchen", () => {
    const r = compareQuotes(query, [cheap]);
    expect(r.notes).toContain("Alle geeigneten Angebote erfordern Vorfinanzierung – vor einem Einkauf Zahlungsziel verhandeln.");
    expect(r.recommendations.best?.reasons).toContain("Einziges geeignetes Angebot.");
  });
});
