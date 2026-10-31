// Entscheidungsprotokoll (Journal) des Market Scout – append-only, eine Datei je Lauf: .data/market/journal/<runId>.jsonl
// (von Git ignoriert; keine Seite liest es). Reine Funktionen: Aufbau der Einträge und Fingerabdrücke.
//
// Das Journal ist der EINZIGE Ort für vertrauliche Werte echter Kandidaten (Einkaufspreis, Versandkosten, Konditionen,
// Marge, Vorfinanzierungsbetrag, Kreditrahmen, Angebots-Schlüssel). state.json und damit die Oberfläche erhalten nur
// die geschwärzte Form (state.ts `toStoredResult`), die Konsole zeigt für echte Kandidaten keine Beträge.
//
// Determinismus: Gleicher Lauf + gleiche Eingaben ergeben byte-gleiche Einträge (keine Zeitstempel außer den übergebenen,
// Schlüssel in kanonischer Reihenfolge, Kandidaten nach Schlüssel sortiert).

import { createHash } from "node:crypto";
import { ASSUMPTIONS, TAX_SETTINGS } from "@/lib/config/assumptions";
import { BUDGET, FUNDING } from "@/lib/config/budget";
import { LIQUIDITY_RULES, SCOUT_RULES, type DocType, type LiquidityAssessment, type LiquidityStatus } from "@/lib/suppliers";
import { MARKET_SCAN, PROFIT_RULES, REVIEW_READY_RULES, STORE_MANAGER_RULES } from "./config";
import { identityKey } from "./model";
import type { CandidateResult, CandidateState, MarketRun, StageKey, StageStatus } from "./pipeline";
import type { PriceSource, SingleUnitStatus } from "./profit";
import type { ReasonCode } from "./reasons";
import { countStates, type MarketState } from "./state";
import { canonicalJson } from "./store-manager";

/** Eingaben eines Laufs – ihr Fingerabdruck macht einen Lauf wiederholbar und nachprüfbar. */
export interface RunInputs {
  /** sha256 über alle übrigen Felder (kanonisches JSON) */
  fingerprint: string;
  /** Importierte Preislisten: Import-IDs und Datei-Prüfsummen (in Speicherreihenfolge) */
  offerStore: { importIds: string[]; fileSha256: string[] };
  /** Prüfsumme der Nachweise (kanonisches JSON der Einträge); null = keine */
  evidenceSha256: string | null;
  /** Prüfsumme der Katalogdatei; null = keine Datei */
  catalogSha256: string | null;
  /** Prüfsumme der verwendeten zwischengespeicherten Nachfragesignale; null = keine */
  cachedSignalsSha256: string | null;
  /** Prüfsumme der Konfiguration (configSha256) */
  configSha256: string;
  appVersion: string;
}

export type JournalMode = "offline" | "live";

export interface JournalRunStart {
  type: "run_start";
  runId: string;
  startedAt: string;
  mode: JournalMode;
  /** Simulierte Uhr (--now): Ergebnisse nur unter .data/market/simulated/, nie „bereit zur Prüfung“ */
  clockOverride: boolean;
  inputs: RunInputs;
  /** Gründe, die heute JEDE Automatisierung sperren (Steuerstatus unbestätigt, Mittel ohne Kontonachweis) */
  globalBlockers: ReasonCode[];
  /** Hinweise zum Lauf, z. B. ersetzte veraltete Lauf-Sperre */
  notes: string[];
}

export interface JournalCandidate {
  type: "candidate";
  runId: string;
  key: string;
  identityKey: string;
  demo: boolean;
  clockOverride: boolean;
  state: CandidateState;
  /** Zustand im zuletzt gespeicherten Stand vor diesem Lauf (null = neu) */
  previousState: CandidateState | null;
  codes: ReasonCode[];
  reasons: string[];
  stages: { key: StageKey; status: StageStatus; codes: ReasonCode[] }[];
  /** VERTRAULICH: Angebots-Schlüssel und -IDs der Kalkulationsbasis */
  supplier: { supplierId: string | null; demo: boolean; offerKeys: string[]; quoteIds: string[]; considered: { supplierId: string; status: LiquidityStatus }[] } | null;
  /** VERTRAULICH: Stückrechnung */
  economics: {
    priceGross: number | null;
    priceSource: PriceSource | null;
    priceReference?: string;
    perUnitWorstCase: number | null;
    contribution: number | null;
    marginPercent: number | null;
    stressContribution: number | null;
    reliable: boolean;
    singleUnit: SingleUnitStatus | null;
  } | null;
  /** VERTRAULICH: Liquidität der Basis; workingCapitalWhatIf = Vorfinanzierung je Bestellung × Bindungstage × 1 Bestellung/Tag (Entscheidung 7) */
  liquidity:
    | (Pick<
        LiquidityAssessment,
        "status" | "securedWithoutPrefinancing" | "goodsFunds" | "upfrontPerOrder" | "refundExposurePerOrder" | "creditCapacity" | "maxOpenOrders" | "maxOrdersPerDay" | "codes"
      > & { workingCapitalWhatIf: number | null })
    | null;
  compliance: { requiredDocTypes: DocType[]; missingDocTypes: DocType[] } | null;
  draft: { file?: string; fingerprint?: string; complete: boolean; violations: string[]; availability?: { shopSku: string; plannedAvailable: number }[] };
}

export interface JournalRunEnd {
  type: "run_end";
  runId: string;
  finishedAt: string;
  counts: Record<CandidateState, number>;
  errors: string[];
  /** Gesetzt, wenn der Lauf vorzeitig endete (z. B. Abbruchschalter STOP) */
  aborted?: string;
}

export type JournalEntry = JournalRunStart | JournalCandidate | JournalRunEnd;

export const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");

/** Fingerabdruck eines Werts: sha256 über kanonisches JSON (Schlüssel sortiert). */
export const canonicalSha256 = (value: unknown) => sha256Hex(canonicalJson(value));

/**
 * Prüfsumme der Konfiguration, die eine Bewertung beeinflusst: MARKET_SCAN, PROFIT_RULES, LIQUIDITY_RULES, ASSUMPTIONS,
 * SCOUT_RULES, TAX_SETTINGS, BUDGET und FUNDING (ohne den Freitext `source`), dazu die Regeln für Entwurf und
 * „bereit zur Prüfung“. Ändert sich ein Wert, ändert sich der Eingabe-Fingerabdruck jedes Laufs.
 */
export function configSha256(): string {
  const { source: _source, ...funding } = FUNDING;
  void _source;
  return canonicalSha256({
    MARKET_SCAN,
    PROFIT_RULES,
    LIQUIDITY_RULES,
    ASSUMPTIONS,
    SCOUT_RULES,
    TAX_SETTINGS,
    BUDGET,
    FUNDING: funding,
    STORE_MANAGER_RULES,
    REVIEW_READY_RULES,
  });
}

/** Fingerabdruck der Eingaben eines Laufs (sha256 über kanonisches JSON). */
export function inputFingerprint(parts: Omit<RunInputs, "fingerprint">): string {
  return canonicalSha256(parts);
}

/** RunInputs mit berechnetem Fingerabdruck. */
export function runInputs(parts: Omit<RunInputs, "fingerprint">): RunInputs {
  return { fingerprint: inputFingerprint(parts), ...parts };
}

/** Gründe, die heute jede Automatisierung sperren – stehen in jedem Lauf (run_start.globalBlockers). */
export function globalBlockers(): ReasonCode[] {
  return [...(TAX_SETTINGS.confirmed ? [] : (["TAX_UNCONFIRMED"] as const)), ...(FUNDING.verified ? [] : (["FUNDS_UNVERIFIED"] as const))];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function candidateEntry(r: CandidateResult, runId: string, previous: MarketState, clockOverride: boolean): JournalCandidate {
  const liq = r.liquidity;
  const gapDays = liq?.funding.gapDays ?? null;
  const whatIf = liq && liq.upfrontPerOrder !== null && gapDays !== null && Number.isFinite(liq.upfrontPerOrder * gapDays) ? round2(liq.upfrontPerOrder * gapDays * 1) : null;
  return {
    type: "candidate",
    runId,
    key: r.candidate.key,
    identityKey: identityKey(r.candidate),
    demo: r.candidate.demo,
    clockOverride,
    state: r.state,
    previousState: previous.candidates[r.candidate.key]?.latest.state ?? null,
    codes: r.reasonCodes ?? [],
    reasons: r.stateReasons,
    stages: r.stages.map((s) => ({ key: s.key, status: s.status, codes: s.codes ?? [] })),
    supplier: r.supplier
      ? {
          supplierId: r.supplier.supplierId ?? null,
          demo: r.supplier.demo,
          offerKeys: r.supplier.offerKeys ?? [],
          quoteIds: r.supplier.quoteIds ?? [r.supplier.quoteId],
          considered: r.supplier.considered ?? [],
        }
      : null,
    economics: r.profit
      ? {
          priceGross: r.profit.priceGross,
          priceSource: r.profit.priceSource ?? null,
          perUnitWorstCase: r.profit.perUnitWorstCase ?? null,
          contribution: r.profit.contribution,
          marginPercent: r.profit.marginPercent,
          stressContribution: r.profit.stressContribution ?? null,
          reliable: r.profit.reliable,
          singleUnit: r.profit.singleUnit?.status ?? null,
        }
      : null,
    liquidity: liq
      ? {
          status: liq.status,
          securedWithoutPrefinancing: liq.securedWithoutPrefinancing,
          goodsFunds: liq.goodsFunds,
          upfrontPerOrder: liq.upfrontPerOrder,
          refundExposurePerOrder: liq.refundExposurePerOrder,
          creditCapacity: liq.creditCapacity,
          maxOpenOrders: liq.maxOpenOrders,
          maxOrdersPerDay: liq.maxOrdersPerDay,
          codes: liq.codes,
          workingCapitalWhatIf: whatIf,
        }
      : null,
    compliance: r.compliance ? { requiredDocTypes: r.compliance.requiredDocTypes ?? [], missingDocTypes: r.compliance.missingDocTypes ?? [] } : null,
    draft: {
      ...(r.draft.artifact && { file: r.draft.artifact.file, fingerprint: r.draft.artifact.fingerprint }),
      complete: r.draft.complete ?? false,
      violations: r.draft.violations,
      ...(r.availability && { availability: r.availability }),
    },
  };
}

/**
 * Baut das Journal eines Laufs: run_start, je Kandidat ein Eintrag (sortiert nach Schlüssel), run_end – auch bei
 * Abbruch (z. B. STOP) mit `aborted`. `previous` ist der gespeicherte Stand VOR diesem Lauf (für previousState).
 */
export function buildJournal(
  run: MarketRun,
  inputs: RunInputs,
  previous: MarketState,
  opts: { clockOverride?: boolean; notes?: string[] } = {},
): JournalEntry[] {
  const clockOverride = opts.clockOverride === true;
  const byKey = (a: CandidateResult, b: CandidateResult) => (a.candidate.key < b.candidate.key ? -1 : a.candidate.key > b.candidate.key ? 1 : 0);
  return [
    {
      type: "run_start",
      runId: run.runId,
      startedAt: run.startedAt,
      mode: run.mode === "live" ? "live" : "offline",
      clockOverride,
      inputs,
      globalBlockers: globalBlockers(),
      notes: opts.notes ?? [],
    },
    ...[...run.results].sort(byKey).map((r) => candidateEntry(r, run.runId, previous, clockOverride)),
    {
      type: "run_end",
      runId: run.runId,
      finishedAt: run.finishedAt,
      counts: countStates(run.results),
      errors: run.errors,
      ...(run.aborted && { aborted: run.aborted }),
    },
  ];
}

/** Eine Zeile je Eintrag (JSON Lines), Schlüssel in kanonischer Reihenfolge – byte-gleich bei gleichen Einträgen. */
export const journalText = (entries: JournalEntry[]) => entries.map((e) => canonicalJson(e)).join("\n") + "\n";
