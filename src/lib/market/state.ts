// Gespeicherter Stand des Market Scout: Kandidaten (ohne Dubletten) und Laufprotokoll. Reine Funktionen.

import type { CandidateResult, CandidateState, MarketRun } from "./pipeline";

export interface StoredCandidate {
  latest: CandidateResult;
  firstSeenAt: string;
  lastEvaluatedAt: string;
  /** In wie vielen Läufen der Kandidat bewertet wurde */
  runsSeen: number;
  /** Verlauf der Bewertung (neueste zuletzt, höchstens HISTORY_LIMIT Einträge) */
  history: { runId: string; at: string; score: number; state: CandidateState }[];
}

export interface RunLogEntry {
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: MarketRun["mode"];
  requests: MarketRun["requests"];
  costEur: 0;
  aborted?: string;
  errors: string[];
  sources: MarketRun["sources"];
  counts: Record<CandidateState, number>;
}

export interface MarketState {
  version: 1;
  candidates: Record<string, StoredCandidate>;
  runs: RunLogEntry[];
}

export const HISTORY_LIMIT = 10;
export const RUN_LOG_LIMIT = 30;

export const emptyMarketState = (): MarketState => ({ version: 1, candidates: {}, runs: [] });

export function countStates(results: CandidateResult[]): Record<CandidateState, number> {
  const counts: Record<CandidateState, number> = { unreviewed: 0, deferred: 0, blocked: 0, approved: 0, draft_created: 0 };
  for (const r of results) counts[r.state]++;
  return counts;
}

/**
 * Übernimmt einen Lauf in den Stand. Wiederholbar und ohne Dubletten (Schlüssel = Kandidaten-Schlüssel).
 * Ein „ungeprüfter“ Eintrag überschreibt nie eine frühere Bewertung – er zeigt nur, dass das Thema noch aussteht.
 */
export function mergeRun(state: MarketState, run: MarketRun): MarketState {
  const candidates = { ...state.candidates };
  for (const r of run.results) {
    const prev = candidates[r.candidate.key];
    if (r.state === "unreviewed") {
      if (!prev) candidates[r.candidate.key] = { latest: r, firstSeenAt: run.startedAt, lastEvaluatedAt: "", runsSeen: 0, history: [] };
      continue;
    }
    candidates[r.candidate.key] = {
      latest: r,
      firstSeenAt: prev?.firstSeenAt ?? run.startedAt,
      lastEvaluatedAt: r.evaluatedAt,
      runsSeen: (prev?.runsSeen ?? 0) + 1,
      history: [...(prev?.history ?? []), { runId: run.runId, at: r.evaluatedAt, score: r.score.score, state: r.state }].slice(-HISTORY_LIMIT),
    };
  }
  const entry: RunLogEntry = {
    runId: run.runId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    mode: run.mode,
    requests: run.requests,
    costEur: 0,
    aborted: run.aborted,
    errors: run.errors,
    sources: run.sources,
    counts: countStates(run.results),
  };
  return { version: 1, candidates, runs: [...state.runs.filter((x) => x.runId !== run.runId), entry].slice(-RUN_LOG_LIMIT) };
}

/** Letzter Bewertungszeitpunkt je Kandidat – bestimmt die Reihenfolge im nächsten Lauf. */
export const lastEvaluatedMap = (state: MarketState) =>
  new Map(Object.entries(state.candidates).map(([key, c]) => [key, c.lastEvaluatedAt]));

export function isMarketState(v: unknown): v is MarketState {
  return !!v && typeof v === "object" && (v as MarketState).version === 1 && typeof (v as MarketState).candidates === "object" && Array.isArray((v as MarketState).runs);
}
