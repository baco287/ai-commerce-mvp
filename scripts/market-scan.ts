// Market Scout – automatische Produktrecherche als Befehl (für manuelle und spätere zeitgesteuerte Läufe).
//
//   npm run market:scan                      Testlauf mit der Demo-Quelle, schreibt nichts
//   npm run market:scan -- --live            zusätzlich reale Quelle (Wikimedia), schreibt nichts
//   npm run market:scan -- --live --save     speichert das Ergebnis in .data/market/state.json (fürs Dashboard)
//   npm run market:scan -- --status          zeigt den gespeicherten Stand und das Laufprotokoll
//   Optionen: --limit <Kandidaten>  --requests <Abrufe>   (nur kleiner als die Grenzen in MARKET_SCAN)
//
// Abbruchschalter: Datei .data/market/STOP anlegen. Kein Einkauf, keine Werbung, keine Veröffentlichung,
// kein Shopify-Schreibzugriff, keine kostenpflichtigen Quellen. Dokumentation: docs/MARKET-SCOUT.md

import { marketEvaluationDeps } from "@/lib/data";
import {
  CANDIDATE_STATE_LABELS,
  createDemoMarketSource,
  createWikimediaSource,
  lastEvaluatedMap,
  LINKED_TOPICS,
  MARKET_SCAN,
  mergeRun,
  runMarketScan,
  STAGE_LABELS,
  WATCHED_CATEGORIES,
  type MarketSource,
} from "@/lib/market";
import { createWikimediaFetchJson } from "@/lib/market/server/wikimedia-client";
import { isStopRequested, loadMarketState, MARKET_STATE_FILE, MARKET_STOP_FILE, saveMarketState } from "@/lib/market/server/market-store";

const FLAGS = new Set(["--live", "--save", "--status"]);
const OPTIONS = new Set(["--limit", "--requests"]);
const log = (line = "") => console.log(line);

function parseArgs(list: string[]) {
  const flags = new Set<string>();
  const options = new Map<string, number>();
  const errors: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (FLAGS.has(a)) flags.add(a);
    else if (OPTIONS.has(a)) {
      const n = Number(list[i + 1]);
      if (!Number.isInteger(n) || n < 1) errors.push(`${a} braucht eine ganze Zahl ≥ 1.`);
      else options.set(a, n);
      i++;
    } else errors.push(`Unbekannte Option ${a}.`);
  }
  return { flags, options, errors };
}

function status(): number {
  const { state, error } = loadMarketState();
  log(`Market-Scout-Speicher: ${MARKET_STATE_FILE}`);
  if (error) log(`  ! ${error}`);
  log(`  ${Object.keys(state.candidates).length} Kandidaten, ${state.runs.length} Läufe protokolliert`);
  for (const r of state.runs.slice(-5)) {
    const counts = Object.entries(r.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${CANDIDATE_STATE_LABELS[k as keyof typeof CANDIDATE_STATE_LABELS]}`).join(", ");
    log(`  • ${r.startedAt.slice(0, 16)} [${r.mode}] ${r.requests.used}/${r.requests.limit} Abrufe – ${counts || "keine Kandidaten"}${r.aborted ? ` – abgebrochen: ${r.aborted}` : ""}`);
  }
  log(`Abbruchschalter: ${isStopRequested() ? "AKTIV" : "nicht gesetzt"} (${MARKET_STOP_FILE})`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length) {
    args.errors.forEach((e) => log(`Fehler: ${e}`));
    return 2;
  }
  if (args.flags.has("--status")) return status();

  const now = new Date();
  const live = args.flags.has("--live");
  const save = args.flags.has("--save");
  const sources: MarketSource[] = [createDemoMarketSource(now)];
  if (live) {
    sources.push(
      createWikimediaSource({
        fetchJson: createWikimediaFetchJson(),
        now,
        categories: WATCHED_CATEGORIES,
        linkedTopics: LINKED_TOPICS,
        membersPerCategory: MARKET_SCAN.membersPerCategory,
      }),
    );
  }
  const previous = loadMarketState();
  if (previous.error && save) {
    log(`Abbruch: ${previous.error} Der Speicher wird nicht überschrieben.`);
    return 1;
  }

  log(`Market Scout ${live ? "mit realer Quelle (Wikimedia)" : "nur mit Demo-Quelle"}${save ? " – Ergebnis wird gespeichert" : " – Testlauf, nichts wird gespeichert"}`);
  const run = await runMarketScan({
    ...marketEvaluationDeps(now),
    runId: `run-${now.toISOString().replace(/[:.]/g, "-")}`,
    sources,
    allowNetwork: live,
    shouldStop: () => isStopRequested(),
    lastEvaluated: lastEvaluatedMap(previous.state),
    maxRequests: Math.min(args.options.get("--requests") ?? MARKET_SCAN.maxRequestsPerRun, MARKET_SCAN.maxRequestsPerRun),
    maxCandidates: Math.min(args.options.get("--limit") ?? MARKET_SCAN.maxCandidatesPerRun, MARKET_SCAN.maxCandidatesPerRun),
  });

  for (const s of run.sources) log(`Quelle ${s.name}: ${s.status}${s.message ? ` – ${s.message}` : ""}`);
  log(`Abrufe: ${run.requests.used}/${run.requests.limit}, Kosten: ${run.costEur} €${run.aborted ? `, abgebrochen: ${run.aborted}` : ""}`);
  log();
  const sorted = [...run.results].filter((r) => r.state !== "unreviewed").sort((a, b) => b.score.score - a.score.score);
  for (const r of sorted) {
    const interest = r.candidate.signals.find((s) => s.interest)?.interest;
    const trend = interest
      ? ` | Ø ${String(interest.avg30).replace(".", ",")}/Tag, 30 Tage ${interest.trend30 === null ? "–" : `${Math.round(interest.trend30 * 100)} %`}`
      : "";
    log(`${String(r.score.score).padStart(3)}/100 (Unsicherheit ${Math.round(r.score.uncertainty * 100)} %) ${CANDIDATE_STATE_LABELS[r.state].padEnd(14)} ${r.candidate.title}${r.candidate.demo ? " [DEMO]" : ""}${trend}`);
    const reached = r.stages.filter((s) => s.status !== "skipped").map((s) => `${STAGE_LABELS[s.key]} ${s.status === "ok" ? "✓" : "✗"}`);
    if (reached.length) log(`        ${reached.join(" → ")}`);
    for (const reason of r.stateReasons) log(`        – ${reason}`);
    if (r.draft.status === "dry_run_prepared") log(`        Entwurf: ${r.draft.title} (Dry-Run, nicht angelegt)`);
  }
  const open = run.results.filter((r) => r.state === "unreviewed");
  if (open.length) log(`\n${open.length} weitere Themen ungeprüft (folgen in späteren Läufen): ${open.slice(0, 8).map((r) => r.candidate.title).join(", ")}${open.length > 8 ? " …" : ""}`);
  if (run.errors.length) {
    log();
    run.errors.forEach((e) => log(`! ${e}`));
  }

  if (save) {
    saveMarketState(mergeRun(previous.state, run));
    log();
    log(`Gespeichert: ${MARKET_STATE_FILE}`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
