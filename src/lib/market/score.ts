// Opportunity Score: nachvollziehbare Bewertung eines Kandidaten (0–100) plus Unsicherheit (0–1).
//
// Grundsätze:
// - Jeder Bestandteil ist 0–100 oder „fehlt“. Fehlende Bestandteile zählen 0 Punkte UND erhöhen die Unsicherheit.
// - Unsichere Bestandteile (Demo-Werte, nicht verlässlich berechnete Marge) erhöhen die Unsicherheit zur Hälfte.
// - Kein Bestandteil wird geschätzt oder erfunden. Die Bewertung entscheidet nie über eine Freigabe.

import type { InterestMetrics, MarketCandidate, SimulatedSignals } from "./model";
import { RISK_LABELS, type RiskLevel } from "./risk";

export type ComponentKey = "demand" | "competition" | "profit" | "supplier" | "delivery" | "risk" | "dataQuality";

export const SCORE_WEIGHTS: Record<ComponentKey, number> = {
  demand: 0.25,
  competition: 0.1,
  profit: 0.2,
  supplier: 0.15,
  delivery: 0.1,
  risk: 0.1,
  dataQuality: 0.1,
};

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  demand: "Nachfrage & Trend",
  competition: "Wettbewerb",
  profit: "Gewinnpotenzial",
  supplier: "Lieferanten",
  delivery: "Liefergeschwindigkeit",
  risk: "Sicherheits- & Retourenrisiko",
  dataQuality: "Datenqualität",
};

export interface ScoreComponent {
  key: ComponentKey;
  label: string;
  weight: number;
  /** 0–100; null = fehlt */
  value: number | null;
  /** ok = belegt; uncertain = vorhanden, aber unsicher; missing = fehlt */
  status: "ok" | "uncertain" | "missing";
  detail: string;
}

export interface OpportunityScore {
  score: number;
  /** Anteil der Bewertung, der fehlt oder unsicher ist (0 = vollständig belegt, 1 = nichts belegt) */
  uncertainty: number;
  components: ScoreComponent[];
  /** Die stärksten belegten Gründe, warum der Kandidat interessant ist */
  highlights: string[];
}

/** Ergebnis der Lieferantenprüfung, soweit schon gelaufen (null = noch nicht geprüft). */
export interface SupplierFacts {
  eligible: number;
  /** davon echte (nicht Demo-)Angebote */
  realEligible: number;
  bestMaxDeliveryDays: number | null;
}

export interface ProfitFacts {
  marginPercent: number;
  /** Nur mit belegtem Verkaufspreis, nachgewiesenen Kosten und bestätigtem Steuerstatus verlässlich */
  reliable: boolean;
}

export interface ScoreInput {
  candidate: MarketCandidate;
  risk: RiskLevel;
  supplier: SupplierFacts | null;
  profit: ProfitFacts | null;
  /** Für die Bewertung der Aktualität */
  now: Date;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));
const clip = (v: number) => Math.min(1, Math.max(-1, v));
const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)} %`;
const round1 = (v: number) => Math.round(v * 10) / 10;

function demandFromInterest(m: InterestMetrics): { value: number; detail: string; partial: boolean } {
  // Niveau logarithmisch: 1 Aufruf/Tag = 0, 10 = 25, 100 = 50, 1.000 = 75, 10.000 = 100
  const level = clamp(25 * Math.log10(Math.max(m.avg30, 1)));
  const momentum = m.trend30 === null && m.trend7 === null ? null : clamp(50 + 30 * clip(m.trend30 ?? 0) + 20 * clip(m.trend7 ?? 0));
  const season = m.seasonalIndex === null ? null : clamp(50 * m.seasonalIndex);
  const value = 0.6 * level + 0.25 * (momentum ?? 0) + 0.15 * (season ?? 0);
  const parts = [`Ø ${String(m.avg30).replace(".", ",")} Aufrufe/Tag (30 Tage)`];
  if (m.trend30 !== null) parts.push(`${pct(m.trend30)} ggü. Vormonat`);
  if (m.trend7 !== null) parts.push(`${pct(m.trend7)} in 7 Tagen`);
  if (m.seasonalIndex !== null) parts.push(`Saisonindex ${m.seasonalIndex.toFixed(2).replace(".", ",")}`);
  else parts.push("Saison unbekannt");
  return { value: round1(value), detail: parts.join(", "), partial: momentum === null || season === null };
}

function demandFromSimulated(s: SimulatedSignals): number {
  // Wie calc/demand.ts, aber ohne Wettbewerb (eigener Bestandteil)
  return round1((0.35 * clamp(s.searchTrend) + 0.25 * clamp(s.socialBuzz) + 0.15 * clamp(s.seasonality)) / 0.75);
}

const RISK_VALUES: Record<RiskLevel, number | null> = { low: 100, medium: 60, high: 30, prohibited: 0, unknown: null };

function dataQuality(c: MarketCandidate, now: Date): { value: number; detail: string } {
  const real = c.signals.find((s) => !s.demo && s.interest);
  if (real?.interest) {
    const m = real.interest;
    const ageDays = m.lastDate ? (now.getTime() - Date.parse(`${m.lastDate}T00:00:00Z`)) / 86_400_000 : Infinity;
    let value = m.days >= 365 ? 100 : m.days >= 60 ? 70 : 40;
    if (m.avg30 < 2) value = Math.min(value, 30);
    if (ageDays > 3) value = Math.min(value, 50);
    return { value, detail: `${m.days} Tage reale Zeitreihe, letzter Tag ${m.lastDate ?? "–"}${m.avg30 < 2 ? ", sehr wenige Aufrufe" : ""}` };
  }
  if (c.signals.some((s) => s.demo)) return { value: 20, detail: "Nur simulierte Demo-Signale" };
  return { value: 0, detail: "Keine Marktsignale" };
}

export function scoreOpportunity(input: ScoreInput): OpportunityScore {
  const { candidate: c, risk, supplier, profit, now } = input;
  const comps: ScoreComponent[] = [];
  const add = (key: ComponentKey, value: number | null, status: ScoreComponent["status"], detail: string) =>
    comps.push({ key, label: COMPONENT_LABELS[key], weight: SCORE_WEIGHTS[key], value: value === null ? null : round1(value), status: value === null ? "missing" : status, detail });

  // Nachfrage
  const real = c.signals.find((s) => !s.demo && s.interest)?.interest;
  const sim = c.signals.find((s) => s.demo && s.simulated)?.simulated;
  if (real) {
    const d = demandFromInterest(real);
    add("demand", d.value, d.partial ? "uncertain" : "ok", `Öffentliches Interesse: ${d.detail}`);
  } else if (sim) {
    add("demand", demandFromSimulated(sim), "uncertain", "Simulierte Demo-Signale – keine reale Nachfrage");
  } else add("demand", null, "missing", "Keine Nachfragedaten");

  // Wettbewerb: keine rechtmäßig nutzbare kostenlose Quelle angebunden
  if (sim) add("competition", 100 - clamp(sim.competition), "uncertain", `Simulierte Wettbewerbsdichte ${sim.competition}/100`);
  else add("competition", null, "missing", "Keine Wettbewerbsdaten (keine freie, rechtmäßig nutzbare Quelle)");

  // Gewinn
  if (profit) {
    add("profit", clamp((profit.marginPercent / 0.4) * 100), profit.reliable ? "ok" : "uncertain", `Marge ${Math.round(profit.marginPercent * 100)} %${profit.reliable ? "" : " – nicht verlässlich berechnet"}`);
  } else add("profit", null, "missing", "Marge nicht berechenbar");

  // Lieferanten und Lieferzeit
  if (supplier) {
    const n = supplier.eligible;
    add("supplier", n === 0 ? 0 : n === 1 ? 70 : 100, supplier.realEligible > 0 ? "ok" : "uncertain", n === 0 ? "Kein geeigneter Lieferant" : `${n} geeignete Angebote${supplier.realEligible === 0 ? " (nur Demo)" : ""}`);
    if (supplier.bestMaxDeliveryDays !== null) {
      // 2 Tage oder schneller = 100, 12 Tage = 0 (wie im Supplier Scout)
      add("delivery", clamp(((12 - supplier.bestMaxDeliveryDays) / 10) * 100), supplier.realEligible > 0 ? "ok" : "uncertain", `bis ${supplier.bestMaxDeliveryDays} Tage`);
    } else add("delivery", null, "missing", "Keine Lieferzeit");
  } else {
    add("supplier", null, "missing", "Lieferanten noch nicht geprüft");
    add("delivery", null, "missing", "Lieferzeit noch nicht geprüft");
  }

  // Risiko und Datenqualität
  add("risk", RISK_VALUES[risk], "ok", `Risiko ${RISK_LABELS[risk]}`);
  const dq = dataQuality(c, now);
  add("dataQuality", dq.value, "ok", dq.detail);

  const score = Math.round(comps.reduce((s, x) => s + x.weight * (x.value ?? 0), 0));
  const uncertainty = Math.min(1, comps.reduce((s, x) => s + (x.status === "missing" ? x.weight : x.status === "uncertain" ? x.weight / 2 : 0), 0));
  const highlights = comps
    .filter((x) => x.status === "ok" && x.value !== null && x.value >= 60 && x.key !== "dataQuality")
    .sort((a, b) => b.weight * (b.value ?? 0) - a.weight * (a.value ?? 0))
    .map((x) => `${x.label}: ${x.detail}`);
  return { score, uncertainty: Math.round(uncertainty * 100) / 100, components: comps, highlights };
}
