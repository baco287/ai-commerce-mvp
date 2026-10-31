// Market Scout – durchgängiger Dry-Run der Pipeline als Befehl (für manuelle und spätere zeitgesteuerte Läufe).
//
//   npm run market:scan                      Dry-Run offline: Demo-Quelle + lokaler Zielproduktkatalog
//                                            (.data/catalog/products.json, nur lesend) + importierte Preislisten und
//                                            Nachweise + zwischengespeicherte Nachfragesignale; schreibt NICHTS (auch keinen Lock)
//   npm run market:scan -- --save            zusätzlich: Lock, state.json (geschwärzt), journal/<runId>.jsonl, drafts/*.json
//                                            – nur unter .data/market
//   npm run pipeline:dry-run                 = market:scan -- --save
//   npm run market:scan -- --now 2026-10-19T12:00:00Z [--run-id demo-1] [--save]
//                                            Simulation mit fester Uhr: nie „bereit zur Prüfung“; mit --save nur nach
//                                            .data/market/simulated/; --now nach der Systemzeit oder mit --live → Exit 2
//   npm run market:scan -- --strict          Exit 4, wenn der Lauf Fehler meldet
//   npm run market:scan -- --live [--save]   zusätzlich reale Quelle (Wikimedia) – nur auf ausdrücklichen Start
//   npm run market:scan -- --status          zeigt den gespeicherten Stand und das Laufprotokoll
//   Optionen: --limit <Kandidaten>  --requests <Abrufe>   (nur kleiner als die Grenzen in MARKET_SCAN)
//
// Exit-Codes: 0 ok bzw. STOP · 1 schwerer Fehler · 2 Argumentfehler · 3 Lauf-Sperre belegt · 4 Fehler mit --strict ·
// 5 Lauf-ID bereits protokolliert. Abbruchschalter: Datei .data/market/STOP anlegen. Kein Einkauf, keine Werbung,
// keine Veröffentlichung, kein Shopify-Schreibzugriff, keine kostenpflichtigen Quellen. Dokumentation: docs/MARKET-SCOUT.md

import packageJson from "../package.json";
import { marketEvaluationDeps } from "@/lib/data";
import {
  CANDIDATE_STATE_LABELS,
  createWikimediaSource,
  EXIT_CODES,
  formatCandidateLine,
  LINKED_TOPICS,
  MARKET_SCAN,
  parseScanArgs,
  SCAN_USAGE,
  WATCHED_CATEGORIES,
} from "@/lib/market";
import { createWikimediaFetchJson } from "@/lib/market/server/wikimedia-client";
import { isStopRequested, loadMarketState, MARKET_STATE_FILE, MARKET_STOP_FILE } from "@/lib/market/server/market-store";
import { runScanCommand } from "@/lib/market/server/scan-runner";

/** Ausgabe je Kandidat – exportiert, damit sie geprüft werden kann (keine Beträge echter Kandidaten). */
export { formatCandidateLine };

const log = (line = "") => console.log(line);

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
  return EXIT_CODES.ok;
}

async function main(): Promise<number> {
  const systemNow = new Date();
  const parsed = parseScanArgs(process.argv.slice(2), systemNow);
  if (!parsed.ok) {
    parsed.errors.forEach((e) => log(`Fehler: ${e}`));
    log();
    SCAN_USAGE.forEach((l) => log(l));
    return EXIT_CODES.usage;
  }
  if (parsed.args.status) return status();
  const { exitCode } = await runScanCommand({
    args: parsed.args,
    systemNow,
    clock: () => new Date(),
    evaluationDeps: marketEvaluationDeps,
    // Nur mit --live: Katalogprodukte mit wikiTitle werden über ihren Artikel gemessen (Verknüpfung über catalogId)
    liveSource: (now, catalog) =>
      createWikimediaSource({
        fetchJson: createWikimediaFetchJson(),
        now,
        categories: WATCHED_CATEGORIES,
        linkedTopics: [...LINKED_TOPICS, ...catalog.products.flatMap((p) => (p.wikiTitle ? [{ title: p.wikiTitle, catalogId: p.id }] : []))],
        membersPerCategory: MARKET_SCAN.membersPerCategory,
      }),
    appVersion: packageJson.version,
    log,
  });
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(EXIT_CODES.fatal);
  },
);
