import type { DemandSignals } from "@/lib/types";

/** Gewichtung der Nachfragesignale (Summe = 1). */
export const DEMAND_WEIGHTS = {
  searchTrend: 0.35,
  socialBuzz: 0.25,
  lowCompetition: 0.25,
  seasonality: 0.15,
} as const;

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/**
 * Nachfragebewertung 0–100. Hohe Konkurrenz senkt den Wert.
 * Die Eingangssignale sind im MVP simuliert.
 */
export function demandScore(s: DemandSignals): number {
  const score =
    DEMAND_WEIGHTS.searchTrend * clamp(s.searchTrend) +
    DEMAND_WEIGHTS.socialBuzz * clamp(s.socialBuzz) +
    DEMAND_WEIGHTS.lowCompetition * (100 - clamp(s.competition)) +
    DEMAND_WEIGHTS.seasonality * clamp(s.seasonality);
  return Math.round(score);
}

export function demandLabel(score: number): "hoch" | "mittel" | "niedrig" {
  if (score >= 70) return "hoch";
  if (score >= 50) return "mittel";
  return "niedrig";
}
