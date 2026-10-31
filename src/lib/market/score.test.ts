import { describe, expect, it } from "vitest";
import { TAX_SETTINGS } from "@/lib/config/assumptions";
import { calculateMargin } from "@/lib/calc/pricing";
import type { InterestMetrics, MarketCandidate } from "./model";
import { checkProfit } from "./profit";
import { assessRisk } from "./risk";
import { SCORE_WEIGHTS, scoreOpportunity } from "./score";

const NOW = new Date("2026-10-31T08:00:00Z");
const interest = (m: Partial<InterestMetrics> = {}): InterestMetrics => ({
  avg7: 120,
  avg30: 100,
  trend7: 0.2,
  trend30: 0.1,
  seasonalIndex: 1.2,
  days: 400,
  lastDate: "2026-10-30",
  ...m,
});
const realCandidate = (m?: Partial<InterestMetrics>): MarketCandidate => ({
  key: "wiki:de.wikipedia:Test",
  title: "Testthema",
  discoveredVia: "Test",
  demo: false,
  signals: [{ sourceId: "wikimedia-pageviews", sourceName: "Wikipedia", kind: "public_interest", demo: false, retrievedAt: NOW.toISOString(), reference: "https://de.wikipedia.org/wiki/Test", interest: interest(m) }],
});

describe("Risikoeinstufung", () => {
  it("sperrt genehmigungspflichtige und gefährliche Warengruppen", () => {
    expect(assessRisk("Taschenmesser").level).toBe("prohibited");
    expect(assessRisk("Armbrust").level).toBe("prohibited");
    expect(assessRisk("Baby-Trinkbecher").level).toBe("prohibited");
  });

  it("stuft Elektrik hoch, Lebensmittelkontakt mittel und einfache Gebrauchsgegenstände gering ein", () => {
    expect(assessRisk("Luftentfeuchter", "Haushaltsgerät").level).toBe("high");
    expect(assessRisk("Trinkflasche").level).toBe("medium");
    expect(assessRisk("Kabelmanagement").level).toBe("low");
    expect(assessRisk("Lederhandschuh").level).not.toBe("high"); // „LED“ nur als eigenes Wort
  });

  it("nennt eine Einstufung über die Kategorie ausdrücklich und lässt Unbekanntes unbekannt", () => {
    expect(assessRisk("Tecnolumen-Klassiker", "Leuchte").reasons[0]).toMatch(/nach Kategorie „Leuchte“/);
    expect(assessRisk("Aquaskipper").level).toBe("unknown");
  });
});

describe("Opportunity Score", () => {
  it("zählt fehlende Bestandteile mit 0 Punkten und als Unsicherheit – nie positiv", () => {
    const s = scoreOpportunity({ candidate: realCandidate(), risk: "unknown", supplier: null, profit: null, now: NOW });
    const missing = s.components.filter((c) => c.status === "missing").map((c) => c.key).sort();
    expect(missing).toEqual(["competition", "delivery", "profit", "risk", "supplier"]);
    const expectedUncertainty = missing.reduce((sum, k) => sum + SCORE_WEIGHTS[k as keyof typeof SCORE_WEIGHTS], 0);
    expect(s.uncertainty).toBeCloseTo(expectedUncertainty, 2);
    // Nur Nachfrage und Datenqualität tragen Punkte
    const demand = s.components.find((c) => c.key === "demand")!.value!;
    expect(s.score).toBe(Math.round(SCORE_WEIGHTS.demand * demand + SCORE_WEIGHTS.dataQuality * 100));
  });

  it("bewertet ohne jedes Signal mit 0 Nachfrage und hoher Unsicherheit", () => {
    const c = { ...realCandidate(), signals: [] };
    const s = scoreOpportunity({ candidate: c, risk: "low", supplier: null, profit: null, now: NOW });
    expect(s.components.find((x) => x.key === "demand")).toMatchObject({ value: null, status: "missing" });
    expect(s.uncertainty).toBeGreaterThanOrEqual(0.7);
  });

  it("wertet steigendes Interesse höher als fallendes", () => {
    const up = scoreOpportunity({ candidate: realCandidate({ trend30: 0.5, trend7: 0.4 }), risk: "low", supplier: null, profit: null, now: NOW });
    const down = scoreOpportunity({ candidate: realCandidate({ trend30: -0.5, trend7: -0.4 }), risk: "low", supplier: null, profit: null, now: NOW });
    expect(up.score).toBeGreaterThan(down.score);
  });

  it("macht eine nicht verlässliche Marge zum unsicheren Bestandteil", () => {
    const supplier = { eligible: 2, realEligible: 2, bestMaxDeliveryDays: 4 };
    const reliable = scoreOpportunity({ candidate: realCandidate(), risk: "low", supplier, profit: { marginPercent: 0.3, reliable: true }, now: NOW });
    const unreliable = scoreOpportunity({ candidate: realCandidate(), risk: "low", supplier, profit: { marginPercent: 0.3, reliable: false }, now: NOW });
    expect(unreliable.uncertainty).toBeGreaterThan(reliable.uncertainty);
    expect(unreliable.components.find((c) => c.key === "profit")?.status).toBe("uncertain");
  });

  it("senkt die Datenqualität bei veralteten oder sehr dünnen Daten", () => {
    const stale = scoreOpportunity({ candidate: realCandidate({ lastDate: "2026-10-01" }), risk: "low", supplier: null, profit: null, now: NOW });
    const thin = scoreOpportunity({ candidate: realCandidate({ avg30: 0.5 }), risk: "low", supplier: null, profit: null, now: NOW });
    expect(stale.components.find((c) => c.key === "dataQuality")!.value).toBeLessThanOrEqual(50);
    expect(thin.components.find((c) => c.key === "dataQuality")!.value).toBeLessThanOrEqual(30);
  });
});

describe("Profit Check (bestehende Kalkulation)", () => {
  it("rechnet ohne Preis oder Kosten keine Marge", () => {
    expect(checkProfit({ priceGross: null, priceSource: "none", landedCostNet: 10, costVerified: true, demo: false })).toMatchObject({ margin: null, reliable: false });
    expect(checkProfit({ priceGross: 30, priceSource: "market", landedCostNet: null, costVerified: false, demo: false }).margin).toBeNull();
  });

  it("nutzt calculateMargin unverändert bei Regelbesteuerung", () => {
    const p = checkProfit({ priceGross: 29.9, priceSource: "demo_target", landedCostNet: 13.8, costVerified: false, demo: true });
    expect(p.margin).toEqual(calculateMargin(29.9, 13.8));
  });

  it("rechnet für Kleinunternehmer ohne USt. auf den Verkauf, aber mit nicht abziehbarer Vorsteuer", () => {
    const p = checkProfit(
      { priceGross: 29.9, priceSource: "market", landedCostNet: 10, costVerified: true, demo: false },
      { status: "kleinunternehmer", confirmed: true },
    );
    expect(p.margin?.vat).toBe(0);
    expect(p.margin?.landedCost).toBeCloseTo(11.9, 2);
    expect(p.reliable).toBe(true);
  });

  it("gilt nur mit belegtem Marktpreis, nachgewiesenen Kosten, echten Daten und bestätigtem Steuerstatus als verlässlich", () => {
    const base = { priceGross: 29.9, priceSource: "market" as const, landedCostNet: 10, costVerified: true, demo: false };
    const confirmedTax = { status: "regelbesteuert" as const, confirmed: true };
    expect(checkProfit(base, confirmedTax).reliable).toBe(true);
    expect(checkProfit({ ...base, priceSource: "demo_target" }, confirmedTax).reliable).toBe(false);
    expect(checkProfit({ ...base, costVerified: false }, confirmedTax).reliable).toBe(false);
    expect(checkProfit({ ...base, demo: true }, confirmedTax).reliable).toBe(false);
    // Heute ist der Steuerstatus nicht bestätigt → nie verlässlich
    expect(TAX_SETTINGS.confirmed).toBe(false);
    expect(checkProfit(base).reliable).toBe(false);
  });
});
