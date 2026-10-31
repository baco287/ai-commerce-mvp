// Auswertung von Interessen-Zeitreihen (z. B. Wikipedia-Aufrufe je Tag). Reine Funktionen, deterministisch.

import type { DailyValue, InterestMetrics } from "./model";

/** Unterhalb dieses Durchschnitts (Aufrufe/Tag) sind Veränderungen zu verrauscht für einen Trend. */
export const MIN_AVG_FOR_TREND = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round = (v: number, digits = 3) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * Füllt fehlende Tage zwischen `start` und `end` (einschließlich) mit 0 auf.
 * Die Wikimedia-API lässt Tage ohne Aufrufe einfach weg – sie zählen als 0, nicht als „unbekannt“.
 */
export function fillDays(values: DailyValue[], start: string, end: string): DailyValue[] {
  const byDate = new Map(values.map((v) => [v.date, v.value]));
  const out: DailyValue[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += DAY_MS) {
    const date = isoDay(t);
    out.push({ date, value: byDate.get(date) ?? 0 });
  }
  return out;
}

/** Veränderung `recent` gegenüber `before`; null, wenn der Vergleichszeitraum zu wenig Daten hat. */
function change(recent: number, before: number): number | null {
  if (before < MIN_AVG_FOR_TREND && recent < MIN_AVG_FOR_TREND) return null;
  if (before <= 0) return null;
  return round(recent / before - 1);
}

/**
 * Kennzahlen einer lückenlosen, aufsteigend sortierten Tagesreihe:
 * - trend7:  Ø letzte 7 Tage gegenüber Ø der 28 Tage davor
 * - trend30: Ø letzte 30 Tage gegenüber Ø der 30 Tage davor
 * - seasonalIndex: Ø der 30 Tage, die vor einem Jahr auf „heute“ folgten, im Verhältnis zum Ø des letzten Jahres
 */
export function interestMetrics(series: DailyValue[]): InterestMetrics {
  const v = series.map((d) => d.value);
  const n = v.length;
  const avg7 = mean(v.slice(-7));
  const avg30 = mean(v.slice(-30));
  const trend7 = n >= 35 ? change(avg7, mean(v.slice(-35, -7))) : null;
  const trend30 = n >= 60 ? change(avg30, mean(v.slice(-60, -30))) : null;

  let seasonalIndex: number | null = null;
  if (n >= 365) {
    const yearMean = mean(v.slice(-365));
    const nextMonthLastYear = mean(v.slice(n - 365, n - 335));
    if (yearMean >= MIN_AVG_FOR_TREND) seasonalIndex = round(nextMonthLastYear / yearMean);
  }

  return {
    avg7: round(avg7, 1),
    avg30: round(avg30, 1),
    trend7,
    trend30,
    seasonalIndex,
    days: n,
    lastDate: series.at(-1)?.date ?? null,
  };
}
