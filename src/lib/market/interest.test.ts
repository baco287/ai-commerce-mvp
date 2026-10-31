import { describe, expect, it } from "vitest";
import { fillDays, interestMetrics } from "./interest";
import type { DailyValue } from "./model";

/** Synthetische, gleichmäßige Testreihe: `days` Tage bis 2026-10-30 mit Wert aus `f(i)` (i = 0 ältester Tag). */
function series(days: number, f: (i: number) => number): DailyValue[] {
  const end = Date.parse("2026-10-30T00:00:00Z");
  return Array.from({ length: days }, (_, i) => ({ date: new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10), value: f(i) }));
}

describe("Interessen-Zeitreihen", () => {
  it("füllt fehlende Tage mit 0 auf (die API lässt Tage ohne Aufrufe weg)", () => {
    const filled = fillDays([{ date: "2026-10-20", value: 4 }, { date: "2026-10-22", value: 1 }], "2026-10-20", "2026-10-23");
    expect(filled).toEqual([
      { date: "2026-10-20", value: 4 },
      { date: "2026-10-21", value: 0 },
      { date: "2026-10-22", value: 1 },
      { date: "2026-10-23", value: 0 },
    ]);
  });

  it("berechnet 7- und 30-Tage-Trend gegenüber den Zeiträumen davor", () => {
    // 60 Tage: erste 30 Tage 10/Tag, letzte 30 Tage 15/Tag, letzte 7 davon 30/Tag
    const s = series(60, (i) => (i >= 53 ? 30 : i >= 30 ? 15 : 10));
    const m = interestMetrics(s);
    expect(m.avg30).toBe(Math.round(((23 * 15 + 7 * 30) / 30) * 10) / 10);
    expect(m.trend30).toBeCloseTo((23 * 15 + 7 * 30) / 30 / 10 - 1, 3);
    // letzte 7 Tage (30) gegenüber den 28 Tagen davor (5 Tage 10, 23 Tage 15)
    expect(m.trend7).toBeCloseTo(30 / ((5 * 10 + 23 * 15) / 28) - 1, 3);
    expect(m.seasonalIndex).toBeNull(); // weniger als ein Jahr Daten
    expect(m.lastDate).toBe("2026-10-30");
  });

  it("erkennt eine wiederkehrende Saison im Vorjahr", () => {
    // 400 Tage, Grundwert 10/Tag; vor einem Jahr in den 30 Tagen nach „heute“ 40/Tag
    const s = series(400, (i) => (i >= 400 - 365 && i < 400 - 335 ? 40 : 10));
    const m = interestMetrics(s);
    expect(m.seasonalIndex).not.toBeNull();
    expect(m.seasonalIndex!).toBeGreaterThan(3);
  });

  it("liefert bei sehr wenigen Aufrufen keinen Trend statt einer zufälligen Prozentzahl", () => {
    const m = interestMetrics(series(400, (i) => (i % 5 === 0 ? 1 : 0)));
    expect(m.trend7).toBeNull();
    expect(m.trend30).toBeNull();
    expect(m.seasonalIndex).toBeNull();
  });

  it("liefert ohne genug Historie keinen Trend", () => {
    const m = interestMetrics(series(20, () => 50));
    expect(m).toMatchObject({ avg7: 50, avg30: 50, trend7: null, trend30: null, seasonalIndex: null, days: 20 });
  });
});
