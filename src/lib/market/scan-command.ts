// Befehl `market:scan` / `pipeline:dry-run`: Argumente, Exit-Codes und Konsolenausgabe. Reine Funktionen (kein
// Datei- und Netzwerkzugriff) – der Ablauf mit Speicher, Lock und Journal liegt in server/scan-runner.ts.
//
// Für echte Kandidaten zeigt die Konsole KEINE Beträge zu Einkauf, Versand, Vorfinanzierung oder Marge – nur
// „siehe Journal“. Demo-Werte sind fiktiv und dürfen erscheinen.

import { LIQUIDITY_STATUS_LABELS } from "@/lib/suppliers";
import { MARKET_SCAN } from "./config";
import { CANDIDATE_STATE_LABELS, STAGE_LABELS, type CandidateResult } from "./pipeline";
import { isRedactionSafeText } from "./state";

/** Exit-Codes des Befehls (stabil – ein späterer Zeitplan wertet sie aus). */
export const EXIT_CODES = Object.freeze({
  /** ok bzw. Abbruch durch STOP (beabsichtigt, run_end.aborted) */
  ok: 0,
  /** schwerer Fehler (z. B. beschädigter Speicher bei --save) */
  fatal: 1,
  /** Argumentfehler (auch --now in der Zukunft oder zusammen mit --live) */
  usage: 2,
  /** Lauf-Sperre belegt (.data/market/LOCK) */
  locked: 3,
  /** Fehler im Lauf mit --strict */
  runErrors: 4,
  /** Lauf-ID bereits protokolliert (journal/<runId>.jsonl existiert) */
  duplicateRunId: 5,
});

export interface ScanArgs {
  live: boolean;
  save: boolean;
  status: boolean;
  strict: boolean;
  /** Simulierte Uhr (--now); null = echte Zeit */
  now: Date | null;
  /** Feste Lauf-ID (--run-id); null = aus der Uhrzeit */
  runId: string | null;
  limit: number | null;
  requests: number | null;
}

/** Erlaubte Lauf-IDs (= Dateiname des Journals) – identisch mit market-store.ts RUN_ID_PATTERN. */
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const FLAGS = new Set(["--live", "--save", "--status", "--strict"]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/** Prüft die Argumente. `systemNow` ist die echte Uhr (--now darf nicht danach liegen). */
export function parseScanArgs(list: string[], systemNow: Date): { ok: true; args: ScanArgs } | { ok: false; errors: string[] } {
  const args: ScanArgs = { live: false, save: false, status: false, strict: false, now: null, runId: null, limit: null, requests: null };
  const errors: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (FLAGS.has(a)) {
      args[a.slice(2) as "live" | "save" | "status" | "strict"] = true;
      continue;
    }
    const value = list[i + 1];
    if (a === "--limit" || a === "--requests") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) errors.push(`${a} braucht eine ganze Zahl ≥ 1.`);
      else args[a === "--limit" ? "limit" : "requests"] = n;
      i++;
    } else if (a === "--now") {
      const t = value !== undefined && ISO_UTC.test(value) ? new Date(value) : null;
      if (!t || !Number.isFinite(t.getTime())) errors.push("--now braucht einen Zeitpunkt in UTC, z. B. 2026-10-19T12:00:00Z.");
      else if (t.getTime() > systemNow.getTime()) errors.push("--now liegt nach der Systemzeit – Simulationen nur für vergangene Zeitpunkte.");
      else args.now = t;
      i++;
    } else if (a === "--run-id") {
      if (value === undefined || !RUN_ID.test(value)) errors.push("--run-id: nur Kleinbuchstaben, Ziffern und Bindestrich (höchstens 80 Zeichen).");
      else args.runId = value;
      i++;
    } else errors.push(`Unbekannte Option ${a}.`);
  }
  if (args.now && args.live) errors.push("--now und --live schließen sich aus (Simulationen laufen nur offline).");
  return errors.length ? { ok: false, errors } : { ok: true, args };
}

/** Lauf-ID aus dem Zeitpunkt: `run-…` bzw. für Simulationen `sim-…` (nur Kleinbuchstaben, Ziffern, Bindestrich). */
export const defaultRunId = (now: Date, simulated: boolean) => `${simulated ? "sim" : "run"}-${now.toISOString().replace(/[:.]/g, "-").toLowerCase()}`;

const eur = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;

/** Liquiditätsstatus und Kapazität offener Bestellungen (ohne Beträge). */
function liquidityLine(r: CandidateResult): string | null {
  const liq = r.liquidity;
  if (!liq) return r.supplier?.liquidityStatus ? `Liquidität: ${LIQUIDITY_STATUS_LABELS[r.supplier.liquidityStatus]}` : null;
  // Ohne Mittelnachweis bei Vorkasse genau diese Meldung (Abnahme Phase 1)
  if (liq.status === "prefinancing_unfunded") return `Liquidität: ${liq.maxOpenOrders} offene vorfinanzierte Bestellungen – Mittel unbelegt`;
  const capacity = liq.status.startsWith("prefinancing_") ? `${liq.maxOpenOrders} offene vorfinanzierte Bestellungen` : `${liq.maxOpenOrders} offene Bestellungen finanzierbar`;
  return `Liquidität: ${LIQUIDITY_STATUS_LABELS[liq.status]} · Kapazität: ${capacity}`;
}

/**
 * Ausgabe je Kandidat (mehrzeilig): Bewertung, Zustand, Stufen, [Codes], Begründungen, Liquiditätsstatus und
 * Kapazität, Entwurf mit Artefaktpfad. Für echte Kandidaten keine €-Beträge (Einkauf, Versand, Vorfinanzierung,
 * Marge) – Begründungen mit Beträgen oder Angebots-Schlüsseln entfallen („siehe Journal“).
 */
export function formatCandidateLine(r: CandidateResult): string {
  const lines: string[] = [];
  const interest = r.candidate.signals.find((s) => s.interest)?.interest;
  const trend = interest ? ` | Ø ${String(interest.avg30).replace(".", ",")}/Tag, 30 Tage ${interest.trend30 === null ? "–" : `${Math.round(interest.trend30 * 100)} %`}` : "";
  lines.push(
    `${String(r.score.score).padStart(3)}/100 (Unsicherheit ${Math.round(r.score.uncertainty * 100)} %) ${CANDIDATE_STATE_LABELS[r.state].padEnd(18)} ${r.candidate.title}${r.candidate.demo ? " [DEMO]" : ""}${trend}`,
  );
  const reached = r.stages.filter((s) => s.status !== "skipped").map((s) => `${STAGE_LABELS[s.key]} ${s.status === "ok" ? "✓" : "✗"}`);
  if (reached.length) lines.push(`        ${reached.join(" → ")}`);
  if (r.reasonCodes?.length) lines.push(`        [${r.reasonCodes.join(", ")}]`);
  const reasons = r.candidate.demo ? r.stateReasons : r.stateReasons.filter(isRedactionSafeText);
  for (const reason of reasons) lines.push(`        – ${reason}`);
  if (reasons.length < r.stateReasons.length) lines.push("        – weitere Einzelheiten (mit Beträgen) siehe Journal");
  if (r.supplier) {
    if (r.candidate.demo) {
      const margin = r.profit?.contribution != null && r.profit.marginPercent != null ? `, Deckungsbeitrag ${eur(r.profit.contribution)} (${Math.round(r.profit.marginPercent * 100)} %)` : "";
      lines.push(`        Kalkulationsbasis: ${r.supplier.supplierName}${/demo/i.test(r.supplier.supplierName) ? "" : " (Demo)"}, ${eur(r.supplier.perUnit)} je Stück${margin}`);
    } else lines.push(`        Kalkulationsbasis: ${r.supplier.supplierName} – Einkauf, Versand, Vorfinanzierung und Marge siehe Journal`);
  }
  const liquidity = liquidityLine(r);
  if (liquidity) lines.push(`        ${liquidity}`);
  if (r.draft.status === "dry_run_prepared") {
    const completeness = r.draft.complete === undefined ? "" : r.draft.complete ? ", vollständig" : `, unvollständig: ${(r.draft.missing ?? []).join(", ")}`;
    lines.push(`        Entwurf: ${r.draft.title} (Dry-Run, nicht angelegt${completeness})${r.draft.artifact ? ` – Artefakt ${r.draft.artifact.file}` : ""}`);
  }
  return lines.join("\n");
}

/** Hilfetext (Kopf der Konsolenausgabe bei Argumentfehlern). */
export const SCAN_USAGE = [
  "Aufruf: npm run market:scan [-- Optionen]",
  "  (ohne)          Dry-Run offline: Demo + Katalog + Preislisten + Nachweise + zwischengespeicherte Signale; schreibt nichts",
  "  --save          zusätzlich speichern: Lock, state.json (geschwärzt), journal/<runId>.jsonl, drafts/*.json (.data/market)",
  "  --now <UTC>     Simulation mit fester Uhr (nie „bereit zur Prüfung“); mit --save nur nach .data/market/simulated/",
  "  --run-id <id>   feste Lauf-ID (Wiederholung derselben ID mit --save: Exit 5)",
  "  --strict        Exit 4, wenn der Lauf Fehler meldet",
  "  --live          zusätzlich Wikimedia abfragen (nur auf ausdrücklichen Start; nicht mit --now)",
  `  --limit <n>     höchstens n neu gemessene Kandidaten (≤ ${MARKET_SCAN.maxCandidatesPerRun})`,
  `  --requests <n>  höchstens n Abrufe (≤ ${MARKET_SCAN.maxRequestsPerRun})`,
  "  --status        gespeicherten Stand und Laufprotokoll anzeigen",
];
