import "server-only";

// Ablauf des Befehls `market:scan` / `pipeline:dry-run` (Paket H): Quellen, Lauf, Konsolenausgabe und – nur mit
// --save – Lock, Lauf-ID-Prüfung, Journal, Entwurfs-Artefakte und geschwärzter Stand. Kein zweiter Orchestrator:
// Bewertet wird ausschließlich über runMarketScan. Kein Netzwerk in dieser Datei (die Wikimedia-Quelle übergibt der
// Befehl nur mit --live), kein Shopify, kein Einkauf.
//
// Schreibt ausschließlich über market-store.ts unter .data/market (mit --now unter .data/market/simulated).
// Ohne --save wird NICHTS geschrieben – auch kein Lock.

import { join } from "node:path";
import { CATALOG_FILE, loadCatalog, type LoadedCatalog } from "./catalog-store";
import {
  acquireRunLock,
  isStopRequested,
  journalExists,
  loadCachedSignals,
  loadMarketState,
  MARKET_DATA_DIR,
  marketPaths,
  releaseRunLock,
  saveMarketState,
  writeDraftArtifact,
  writeJournal,
} from "./market-store";
import { loadEvidence, loadOfferStore } from "@/lib/suppliers/server/offer-store";
import type { CatalogProduct } from "../catalog";
import { MARKET_SCAN } from "../config";
import { buildJournal, canonicalSha256, configSha256, runInputs } from "../journal";
import type { MarketSignal } from "../model";
import { runMarketScan, type EvaluationDeps, type MarketRun } from "../pipeline";
import { defaultRunId, EXIT_CODES, formatCandidateLine, type ScanArgs } from "../scan-command";
import { createCatalogMarketSource, createDemoMarketSource, type MarketSource } from "../sources";
import { lastEvaluatedMap, mergeRun } from "../state";

export interface ScanRunnerOptions {
  args: ScanArgs;
  /** Echte Uhr beim Start (Lock-Alter, Standard-Lauf-ID ohne --now) */
  systemNow: Date;
  /** Echte Uhr für das Laufende; mit --now gilt die feste Uhr */
  clock: () => Date;
  /** Abhängigkeiten der Bewertung (data.ts marketEvaluationDeps) */
  evaluationDeps(now: Date, opts: { catalog: readonly CatalogProduct[]; cachedSignals: Map<string, MarketSignal[]> }): EvaluationDeps;
  /** Nur mit --live: reale Quelle (Wikimedia) inkl. Katalog-Verknüpfung über wikiTitle */
  liveSource?(now: Date, catalog: LoadedCatalog): MarketSource;
  appVersion: string;
  log(line?: string): void;
  /** Basisverzeichnis (Standard .data/market); Simulationen liegen darunter in simulated/ */
  dataDir?: string;
  catalogFile?: string;
  /** Angebotsspeicher und Nachweisdatei (Standard .data/suppliers/…) – nur für Tests mit Temp-Verzeichnis */
  offerStoreFile?: string;
  evidenceFile?: string;
  /** Abbruchschalter (Standard: Datei .data/market/STOP) */
  shouldStop?(): boolean;
}

export interface ScanRunnerResult {
  exitCode: number;
  run: MarketRun | null;
  /** Speicherverzeichnis des Laufs (produktiv bzw. simulated) */
  dir: string;
  runId: string;
  written: { journal?: string; drafts: { file: string; status: "written" | "exists" }[]; state?: string };
}

export async function runScanCommand(o: ScanRunnerOptions): Promise<ScanRunnerResult> {
  const { args, log } = o;
  const simulated = args.now !== null;
  const now = args.now ?? o.systemNow;
  const base = o.dataDir ?? MARKET_DATA_DIR;
  const dir = simulated ? join(base, "simulated") : base;
  const paths = marketPaths(dir);
  const runId = args.runId ?? defaultRunId(now, simulated);
  const result: ScanRunnerResult = { exitCode: EXIT_CODES.ok, run: null, dir, runId, written: { drafts: [] } };
  const exit = (code: number) => ({ ...result, exitCode: code });

  // Lock nur mit --save – und VOR dem Lesen des Stands, damit kein paralleler Lauf dazwischen speichert.
  let lockNote: string | undefined;
  let lockToken: string | undefined;
  if (args.save) {
    const lock = acquireRunLock(dir, o.systemNow);
    if (!lock.ok) {
      log(`Abbruch: Lauf-Sperre belegt seit ${lock.since ?? "unbekannt"} (${lock.file}). Läuft ein anderer Lauf? Nichts wurde geschrieben.`);
      return exit(EXIT_CODES.locked);
    }
    lockNote = lock.note;
    lockToken = lock.token;
  }
  try {
    if (args.save && journalExists(runId, dir)) {
      log(`Abbruch: Lauf-ID „${runId}“ bereits protokolliert (${join(paths.journal, `${runId}.jsonl`)}). Nichts wurde geändert.`);
      return exit(EXIT_CODES.duplicateRunId);
    }
    const previous = loadMarketState(paths.state);
    const offers = loadOfferStore(o.offerStoreFile);
    const evidence = loadEvidence(o.evidenceFile);
    const catalog = loadCatalog(now, o.catalogFile ?? CATALOG_FILE);
    // Unbrauchbare Eingabedateien: Ein schreibender Lauf würde sonst still ohne Angebote, Nachweise oder Katalog
    // bewerten und das als gültigen Stand speichern (echte Kandidaten fälschlich „zurückgestellt“, Katalogprodukte
    // mit altem Zustand). Daher wie beim beschädigten Stand: mit --save abbrechen, nichts schreiben.
    const fatalInputs = [previous.error, offers.error, evidence.fatal, catalog.error].filter((e): e is string => !!e);
    if (args.save && fatalInputs.length > 0) {
      log(`Abbruch: ${fatalInputs.join(" ")} Der Speicher wird nicht überschrieben.`);
      return exit(EXIT_CODES.fatal);
    }
    // Ohne --save läuft der Dry-Run weiter, meldet die Probleme aber als Lauffehler (sichtbar, mit --strict Exit 4) –
    // ebenso einzelne ungültige Nachweise (die übrigen Nachweise gelten weiter).
    const inputErrors = [...new Set([...fatalInputs, ...evidence.errors])];
    const cached = loadCachedSignals(now, paths.state);
    log(
      `Zielproduktkatalog: ${catalog.sha256 === null ? "keine Datei" : `${catalog.products.length} gültige, ${catalog.invalid.length} ungültige Produkte`}${catalog.error ? ` – ! ${catalog.error}` : ""}`,
    );
    log(`Zwischengespeicherte Nachfragesignale (≤ ${MARKET_SCAN.staleAfterDays} Tage): ${cached.signals.size}`);
    log(
      `Market Scout ${args.live ? "mit realer Quelle (Wikimedia)" : "offline (Demo-Quelle, Katalog, Preislisten, zwischengespeicherte Signale)"}` +
        `${simulated ? ` – SIMULATION mit fester Uhr ${now.toISOString()}` : ""}` +
        `${args.save ? ` – wird gespeichert (${dir})` : " – Dry-Run, nichts wird gespeichert"} – Lauf ${runId}`,
    );

    const sources: MarketSource[] = [createDemoMarketSource(now), createCatalogMarketSource(catalog)];
    if (args.live && o.liveSource) sources.push(o.liveSource(now, catalog));
    const run = await runMarketScan({
      ...o.evaluationDeps(now, { catalog: catalog.products, cachedSignals: cached.signals }),
      runId,
      clockOverride: simulated,
      sources,
      allowNetwork: args.live,
      shouldStop: o.shouldStop ?? (() => isStopRequested()),
      lastEvaluated: lastEvaluatedMap(previous.state),
      maxRequests: Math.min(args.requests ?? MARKET_SCAN.maxRequestsPerRun, MARKET_SCAN.maxRequestsPerRun),
      maxCandidates: Math.min(args.limit ?? MARKET_SCAN.maxCandidatesPerRun, MARKET_SCAN.maxCandidatesPerRun),
      clock: simulated ? () => now : o.clock,
    });
    run.errors.unshift(...inputErrors);
    result.run = run;

    for (const s of run.sources) log(`Quelle ${s.name}: ${s.status}${s.message ? ` – ${s.message}` : ""}`);
    log(`Abrufe: ${run.requests.used}/${run.requests.limit}, Kosten: ${run.costEur} €${run.aborted ? `, abgebrochen: ${run.aborted}` : ""}`);
    log();
    const sorted = run.results
      .filter((r) => r.state !== "unreviewed")
      .sort((a, b) => b.score.score - a.score.score || (a.candidate.key < b.candidate.key ? -1 : a.candidate.key > b.candidate.key ? 1 : 0));
    for (const r of sorted) log(formatCandidateLine(r));
    const open = run.results.filter((r) => r.state === "unreviewed");
    if (!args.save && run.results.some((r) => r.draftArtifact)) log("\nHinweis: Artefaktpfade sind nur Vorschau – ohne --save wird nichts geschrieben.");
    if (open.length) log(`\n${open.length} weitere Themen ungeprüft (folgen in späteren Läufen): ${open.slice(0, 8).map((r) => r.candidate.title).join(", ")}${open.length > 8 ? " …" : ""}`);
    if (run.errors.length) {
      log();
      run.errors.forEach((e) => log(`! ${e}`));
    }

    if (args.save) {
      const inputs = runInputs({
        offerStore: { importIds: offers.store.imports.map((i) => i.importId), fileSha256: offers.store.imports.map((i) => i.fileSha256) },
        evidenceSha256: evidence.entries.length > 0 ? canonicalSha256(evidence.entries) : null,
        catalogSha256: catalog.sha256,
        cachedSignalsSha256: cached.sha256,
        configSha256: configSha256(),
        appVersion: o.appVersion,
      });
      // Artefakte erst nach vollständiger Bewertung (kein halbes Artefakt); gleicher Inhalt ergibt keine neue Datei.
      result.written.drafts = run.results.flatMap((r) => (r.draftArtifact ? [writeDraftArtifact(r.draftArtifact, dir)] : []));
      const journal = writeJournal(runId, buildJournal(run, inputs, previous.state, { clockOverride: simulated, notes: lockNote ? [lockNote] : [] }), dir);
      result.written.journal = journal.file;
      saveMarketState(mergeRun(previous.state, run), paths.state);
      result.written.state = paths.state;
      log();
      log(`Gespeichert: ${paths.state} (geschwärzt)`);
      log(`Journal: ${journal.file}${journal.status === "exists" ? " (bereits vorhanden – unverändert)" : ""}`);
      log(`Entwurfs-Artefakte: ${result.written.drafts.filter((w) => w.status === "written").length} neu, ${result.written.drafts.filter((w) => w.status === "exists").length} unverändert (${paths.drafts})`);
      log(`Eingabe-Fingerabdruck: ${inputs.fingerprint.slice(0, 16)}…`);
    }
    if (args.strict && run.errors.length > 0) {
      log(`Exit ${EXIT_CODES.runErrors}: Der Lauf meldet ${run.errors.length} Fehler (--strict).`);
      return exit(EXIT_CODES.runErrors);
    }
    return exit(EXIT_CODES.ok);
  } finally {
    // Nur die eigene Sperre freigeben (Besitzer-Kennung) – eine inzwischen fremde bleibt bestehen.
    if (args.save && lockToken !== undefined) releaseRunLock(dir, lockToken);
  }
}
