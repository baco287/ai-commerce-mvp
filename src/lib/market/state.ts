// Gespeicherter Stand des Market Scout: Kandidaten (ohne Dubletten) und Laufprotokoll. Reine Funktionen.

import { MARKET_SCAN } from "./config";
import type { MarketSignal } from "./model";
import type { CandidateResult, CandidateState, MarketRun, StageResult } from "./pipeline";
import { REASON_META, type ReasonCode } from "./reasons";

export interface StoredCandidate {
  latest: CandidateResult;
  firstSeenAt: string;
  lastEvaluatedAt: string;
  /** In wie vielen Läufen der Kandidat bewertet wurde */
  runsSeen: number;
  /** Verlauf der Bewertung (neueste zuletzt, höchstens HISTORY_LIMIT Einträge) */
  history: { runId: string; at: string; score: number; state: CandidateState; codes?: ReasonCode[]; draftFingerprint?: string }[];
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
  const counts: Record<CandidateState, number> = { unreviewed: 0, deferred: 0, blocked: 0, review_ready: 0, approved: 0, draft_created: 0 };
  for (const r of results) counts[r.state]++;
  return counts;
}

/**
 * Übernimmt einen Lauf in den Stand. Wiederholbar und ohne Dubletten (Schlüssel = Kandidaten-Schlüssel).
 * Ein „ungeprüfter“ Eintrag überschreibt nie eine frühere Bewertung – er zeigt nur, dass das Thema noch aussteht.
 * Gespeichert wird nur die geschwärzte Form (`toStoredResult`): Für echte Kandidaten stehen Einkaufswerte, Konditionen,
 * Margen und Angebots-Schlüssel nur im Journal. Das Entwurfs-Artefakt (`draftArtifact`) wird nie übernommen.
 *
 * Idempotent: Ist der letzte Verlaufseintrag eines Kandidaten bereits von dieser Lauf-ID, werden weder `runsSeen`
 * erhöht noch der Verlauf ergänzt (z. B. bei einem wiederholten Speichern desselben Laufs).
 */
export function mergeRun(state: MarketState, run: MarketRun): MarketState {
  const candidates = { ...state.candidates };
  for (const result of run.results) {
    const r = toStoredResult(result);
    const prev = candidates[r.candidate.key];
    if (r.state === "unreviewed") {
      if (!prev) candidates[r.candidate.key] = { latest: r, firstSeenAt: run.startedAt, lastEvaluatedAt: "", runsSeen: 0, history: [] };
      continue;
    }
    const sameRun = prev?.history.at(-1)?.runId === run.runId;
    candidates[r.candidate.key] = {
      latest: r,
      firstSeenAt: prev?.firstSeenAt ?? run.startedAt,
      lastEvaluatedAt: r.evaluatedAt,
      runsSeen: sameRun ? prev.runsSeen : (prev?.runsSeen ?? 0) + 1,
      history: sameRun
        ? prev.history
        : [
            ...(prev?.history ?? []),
            {
              runId: run.runId,
              at: r.evaluatedAt,
              score: r.score.score,
              state: r.state,
              ...(r.reasonCodes && { codes: r.reasonCodes }),
              ...(r.draft.artifact && { draftFingerprint: r.draft.artifact.fingerprint }),
            },
          ].slice(-HISTORY_LIMIT),
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

/**
 * Texte, die in geschwärzten Ständen nicht erscheinen dürfen: €-Beträge, Geldbeträge mit Dezimalkomma bzw. -punkt,
 * Prozentangaben (Marge) und Angebots-Schlüssel (`supplierId::supplierSku`).
 */
const CONFIDENTIAL_TEXT = /€|\bEUR\b|\d+[.,]\d{2}\b|\d\s*%|::/;
export const isRedactionSafeText = (text: string) => !CONFIDENTIAL_TEXT.test(text);

/** Stufentexte eines echten Kandidaten – ausschließlich aus den Codes erzeugt (Labels ohne Beträge). */
function redactedStage(stage: StageResult): StageResult {
  const codes = stage.codes ?? [];
  const details =
    codes.length > 0
      ? codes.map((c) => REASON_META[c].label)
      : stage.status === "skipped"
        ? ["Übersprungen – vorherige Stufe nicht bestanden."]
        : stage.status === "ok"
          ? ["Bestanden – Einzelheiten nur im Journal."]
          : ["Einzelheiten nur im Journal."];
  return { key: stage.key, status: stage.status, details, ...(stage.codes && { codes: stage.codes }) };
}

/**
 * Geschwärzte Form eines Ergebnisses für state.json und damit für die Oberfläche (Paket G).
 * - Demo-Kandidaten bleiben unverändert (nur ohne Artefakt) – ihre Werte sind fiktiv und als Demo gekennzeichnet.
 * - Echte Kandidaten behalten nur Zustand, Codes, Begründungen ohne Beträge, Stufenstatus mit Texten aus den Codes,
 *   Score und Signale, Compliance-Dokumenttypen und die Entwurfs-Zusammenfassung (Datei, Fingerabdruck, Vollständigkeit).
 *   Lieferant, Stückrechnung, Liquidität, geplante Menge, Angebots- und Angebots-Schlüssel stehen NUR im Journal.
 *   Die Margen-Komponente des Score verliert Wert und Text (der Wert ließe auf die Marge schließen).
 */
export function toStoredResult(result: CandidateResult): CandidateResult {
  const r: CandidateResult = { ...result };
  delete r.draftArtifact;
  if (result.candidate.demo) return r;
  delete r.liquidity;
  delete r.availability;
  const codes = result.reasonCodes ?? [];
  const reasons = result.stateReasons.filter(isRedactionSafeText);
  const components = result.score.components.map((c) =>
    c.key === "profit" && c.value !== null ? { ...c, value: null, status: "missing" as const, detail: "Vertraulich – nur im Journal" } : c,
  );
  return {
    ...r,
    stateReasons: reasons.length > 0 || codes.length === 0 ? reasons : codes.map((c) => REASON_META[c].label),
    stages: result.stages.map(redactedStage),
    score: {
      ...result.score,
      components,
      highlights: result.score.highlights.filter((h) => !h.startsWith(components.find((c) => c.key === "profit")?.label ?? "\u0000") && isRedactionSafeText(h)),
    },
    supplier: null,
    profit: null,
    draft: { ...result.draft, violations: result.draft.violations.filter(isRedactionSafeText), note: isRedactionSafeText(result.draft.note) ? result.draft.note : "Dry-Run-Entwurf – Einzelheiten nur im Journal." },
    redacted: true,
  };
}

/** Letzter Bewertungszeitpunkt je Kandidat – bestimmt die Reihenfolge im nächsten Lauf. */
export const lastEvaluatedMap = (state: MarketState) =>
  new Map(Object.entries(state.candidates).map(([key, c]) => [key, c.lastEvaluatedAt]));

export function isMarketState(v: unknown): v is MarketState {
  return !!v && typeof v === "object" && (v as MarketState).version === 1 && typeof (v as MarketState).candidates === "object" && Array.isArray((v as MarketState).runs);
}

/**
 * Zwischengespeicherte Nachfragesignale aus dem gespeicherten Stand: je Kandidat (kanonischer Schlüssel) die echten,
 * gemessenen Signale (keine Demo-Werte), deren Messung höchstens `maxAgeDays` vor `now` liegt (nicht in der Zukunft).
 * `retrievedAt` bleibt der Zeitpunkt der ursprünglichen Messung – ein Signal veraltet also auch über mehrere Läufe.
 * Rein und deterministisch (Schlüssel sortiert).
 */
export function selectCachedSignals(state: MarketState, now: Date, maxAgeDays: number = MARKET_SCAN.staleAfterDays): Map<string, MarketSignal[]> {
  const maxAgeMs = maxAgeDays * 86_400_000;
  const result = new Map<string, MarketSignal[]>();
  for (const key of Object.keys(state.candidates).sort()) {
    const signals = state.candidates[key]?.latest?.candidate?.signals;
    if (!Array.isArray(signals)) continue;
    const fresh = signals.filter((s) => {
      if (!s || s.demo || !s.interest || typeof s.retrievedAt !== "string") return false;
      const age = now.getTime() - Date.parse(s.retrievedAt);
      return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
    });
    if (fresh.length) result.set(key, fresh.map((s) => ({ ...s, cached: true })));
  }
  return result;
}
