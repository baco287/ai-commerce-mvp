import "server-only";

// Lokaler Speicher des Market Scout in .data/market/ (von Git ignoriert). Nur serverseitig.
// Schreiben nur über den Befehl `npm run market:scan -- --save` (bzw. `npm run pipeline:dry-run`). Kein Netzwerk.
// Entwurfs-Artefakte (drafts/) und das Journal (journal/) sind lokale Dry-Run-Daten: keine Seite und kein
// Shopify-Befehl liest sie (Phase 1).
//
// Aufbau eines Speicherverzeichnisses (Standard .data/market, mit --now .data/market/simulated):
//   state.json (+ state.json.bak)   geschwärzter Stand für die Oberfläche (state.ts toStoredResult)
//   journal/<runId>.jsonl           Entscheidungsprotokoll, eine Datei je Lauf, nur neu angelegt (append-only)
//   drafts/<Schlüssel>.<fp>.json    Entwurfs-Artefakte, inhaltsadressiert, nur neu angelegt
//   LOCK                            Lauf-Sperre (nur bei --save), verhindert parallele Läufe
//   LOCK.takeover                   kurzlebige Übernahme-Sperre beim Ersetzen einer veralteten Lauf-Sperre
// Der Abbruchschalter .data/market/STOP gilt für alle Läufe, auch für Simulationen.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { journalText, type JournalEntry } from "../journal";
import type { MarketSignal } from "../model";
import { emptyMarketState, isMarketState, selectCachedSignals, type MarketState } from "../state";
import { draftArtifactFile, type DraftArtifact } from "../store-manager";

// turbopackIgnore: Laufzeitdaten, nicht Teil des Builds.
export const MARKET_DATA_DIR = join(/* turbopackIgnore: true */ process.cwd(), ".data", "market");
export const MARKET_STATE_FILE = join(MARKET_DATA_DIR, "state.json");
/** Abbruchschalter ohne Code-Änderung: Existiert diese Datei, startet kein Lauf bzw. ein laufender stoppt. */
export const MARKET_STOP_FILE = join(MARKET_DATA_DIR, "STOP");
/** Lokale Entwurfs-Artefakte (inhaltsadressiert, nie überschrieben) */
export const MARKET_DRAFTS_DIR = join(MARKET_DATA_DIR, "drafts");
/** Entscheidungsprotokoll (eine Datei je Lauf, nie überschrieben) – VERTRAULICH, von keiner Seite gelesen */
export const MARKET_JOURNAL_DIR = join(MARKET_DATA_DIR, "journal");
/** Simulationen mit fester Uhr (--now): eigener Stand, eigenes Journal, eigene Artefakte – nie der produktive Speicher */
export const MARKET_SIMULATED_DIR = join(MARKET_DATA_DIR, "simulated");

/** Ein Lock gilt so lange als belegt; danach wird er ersetzt (und im Journal vermerkt). */
export const RUN_LOCK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/**
 * Eine Sperre ohne lesbaren Zeitpunkt (beschädigt oder gerade im Entstehen) gilt erst als veraltet, wenn die Datei
 * älter als diese Frist ist (Änderungszeit der Datei, echte Uhr). Schützt einen Lauf, der seinen LOCK gerade anlegt.
 */
export const RUN_LOCK_UNREADABLE_GRACE_MS = 60 * 1000;

/** Pfade eines Speicherverzeichnisses */
export const marketPaths = (dir = MARKET_DATA_DIR) => ({
  dir,
  state: join(dir, "state.json"),
  lock: join(dir, "LOCK"),
  lockTakeover: join(dir, "LOCK.takeover"),
  journal: join(dir, "journal"),
  drafts: join(dir, "drafts"),
});

export function loadMarketState(file = MARKET_STATE_FILE): { state: MarketState; error?: string } {
  if (!existsSync(/* turbopackIgnore: true */ file)) return { state: emptyMarketState() };
  try {
    const parsed: unknown = JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8"));
    if (!isMarketState(parsed)) return { state: emptyMarketState(), error: "Market-Scout-Speicher hat ein unbekanntes Format." };
    return { state: parsed };
  } catch {
    return { state: emptyMarketState(), error: "Market-Scout-Speicher ist nicht lesbar (beschädigt?)." };
  }
}

/**
 * Schreibt atomar (temporäre Datei + Umbenennen). Vorher wird der bisherige Stand als `state.json.bak` gesichert.
 * Der Stand enthält nur geschwärzte Ergebnisse (mergeRun → toStoredResult).
 */
export function saveMarketState(state: MarketState, file = MARKET_STATE_FILE): void {
  mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
  if (existsSync(/* turbopackIgnore: true */ file)) {
    writeFileSync(/* turbopackIgnore: true */ `${file}.bak`, readFileSync(/* turbopackIgnore: true */ file));
  }
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(/* turbopackIgnore: true */ temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(/* turbopackIgnore: true */ temp, file);
}

export const isStopRequested = (file = MARKET_STOP_FILE) => existsSync(/* turbopackIgnore: true */ file);

/**
 * Zwischengespeicherte Nachfragesignale (nur lesend) aus state.json, höchstens MARKET_SCAN.staleAfterDays alt.
 * `sha256` ist der Fingerabdruck der verwendeten Signale (kanonisches JSON, Schlüssel sortiert) für die
 * Wiederholbarkeit eines Laufs; null = keine Signale.
 */
export function loadCachedSignals(now: Date, file = MARKET_STATE_FILE): { signals: Map<string, MarketSignal[]>; sha256: string | null; error?: string } {
  const { state, error } = loadMarketState(file);
  const signals = selectCachedSignals(state, now);
  if (signals.size === 0) return { signals, sha256: null, ...(error && { error }) };
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
  const sha256 = createHash("sha256").update(JSON.stringify(canonical([...signals.entries()]))).digest("hex");
  return { signals, sha256, ...(error && { error }) };
}

/** Legt eine Datei nur neu an (`wx`); existiert sie, bleibt sie unverändert ("exists"). */
function writeNew(file: string, content: string): "written" | "exists" {
  mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
  try {
    writeFileSync(/* turbopackIgnore: true */ file, content, { encoding: "utf8", flag: "wx" });
    return "written";
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return "exists";
    throw e;
  }
}

/**
 * Legt ein Entwurfs-Artefakt unter `<dir>/drafts/<Schlüssel>.<Fingerabdruck[0..12]>.json` ab – nur neu anlegen (`wx`),
 * nie überschreiben. Gleicher Inhalt (gleicher Fingerabdruck) ergibt keine zweite Datei: Rückgabe "exists".
 */
export function writeDraftArtifact(artifact: DraftArtifact, dir = MARKET_DATA_DIR): { status: "written" | "exists"; file: string } {
  const file = join(/* turbopackIgnore: true */ dir, draftArtifactFile(artifact));
  return { status: writeNew(file, `${JSON.stringify(artifact, null, 2)}\n`), file };
}

/** Erlaubte Lauf-IDs (auch Dateiname des Journals): Kleinbuchstaben, Ziffern, Bindestrich. */
export const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

function journalFile(runId: string, dir: string): string {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Ungültige Lauf-ID "${runId}".`);
  return join(/* turbopackIgnore: true */ marketPaths(dir).journal, `${runId}.jsonl`);
}

/** Ist diese Lauf-ID bereits protokolliert? (Idempotenz: dann wird nichts gespeichert, Exit-Code 5) */
export const journalExists = (runId: string, dir = MARKET_DATA_DIR) => existsSync(/* turbopackIgnore: true */ journalFile(runId, dir));

/** Schreibt das Journal eines Laufs (`journal/<runId>.jsonl`) – nur neu anlegen; existiert es, bleibt es unverändert. */
export function writeJournal(runId: string, entries: JournalEntry[], dir = MARKET_DATA_DIR): { status: "written" | "exists"; file: string } {
  const file = journalFile(runId, dir);
  return { status: writeNew(file, journalText(entries)), file };
}

export type RunLock = { ok: true; file: string; token: string; note?: string } | { ok: false; file: string; since: string | null };

interface SeenLock {
  /** Dateiinhalt wörtlich (Vergleich „noch dieselbe Sperre?“) */
  raw: string;
  /** Zeitpunkt aus dem Inhalt; null = unlesbar */
  since: string | null;
  pid: unknown;
  token: unknown;
  /** Änderungszeit der Datei (echte Uhr) */
  mtimeMs: number;
}

/** Liest eine Sperrdatei. null = existiert nicht (mehr). Andere Lesefehler gelten als frisch belegt (konservativ). */
function readLock(file: string): SeenLock | null {
  try {
    const raw = readFileSync(/* turbopackIgnore: true */ file, "utf8");
    const mtimeMs = statSync(/* turbopackIgnore: true */ file).mtimeMs;
    type LockFields = { pid?: unknown; at?: unknown; token?: unknown };
    let parsed: LockFields = {};
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === "object") parsed = value as LockFields;
    } catch {
      parsed = {};
    }
    const at = parsed.at;
    const since = typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : null;
    return { raw, since, pid: parsed.pid, token: parsed.token, mtimeMs };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { raw: "", since: null, pid: undefined, token: undefined, mtimeMs: Date.now() };
  }
}

/** Veraltet: Zeitpunkt älter als 6 h – oder unlesbar und die Datei älter als die Schonfrist. Zukunft gilt als belegt. */
function lockIsStale(lock: SeenLock, now: Date): boolean {
  if (lock.since !== null) return now.getTime() - Date.parse(lock.since) >= RUN_LOCK_MAX_AGE_MS;
  return Date.now() - lock.mtimeMs >= RUN_LOCK_UNREADABLE_GRACE_MS;
}

/** Inhalt einer Lauf-Sperre: Prozess-ID, Zeitpunkt und Besitzer-Kennung (für releaseRunLock) */
const lockContent = (now: Date, token: string) => `${JSON.stringify({ pid: process.pid, at: now.toISOString(), token })}\n`;

function removeIfExists(file: string): void {
  try {
    unlinkSync(/* turbopackIgnore: true */ file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/**
 * Ersetzt eine veraltete Lauf-Sperre atomar – nur wenn `<dir>/LOCK` noch wörtlich die gesehene Sperre `seen` ist.
 * Die Übernahme läuft unter der kurzlebigen Übernahme-Sperre `LOCK.takeover` (nur neu anlegen, `wx`): Von zwei
 * Läufen, die dieselbe veraltete Sperre sahen, ersetzt sie höchstens einer; der andere bekommt { ok: false }.
 * Ersetzt wird über temporäre Datei + Umbenennen (nie Löschen und neu Anlegen); danach wird zurückgelesen.
 * Exportiert für die Regressionstests der Wettlaufsituation; im Betrieb nur über acquireRunLock.
 */
export function replaceStaleRunLock(dir: string, seen: { raw: string; since: string | null }, now: Date): RunLock {
  const paths = marketPaths(dir);
  const file = paths.lock;
  const token = randomUUID();
  const content = lockContent(now, token);
  // Ein anderer Lauf ersetzt gerade – dann gilt die Sperre als belegt. Eine liegen gebliebene Übernahme-Sperre
  // (Absturz genau während der Übernahme) muss von Hand gelöscht werden; die Meldung nennt die Datei.
  if (writeNew(paths.lockTakeover, content) !== "written") return { ok: false, file: paths.lockTakeover, since: seen.since };
  try {
    const current = readLock(file);
    if (current === null) {
      // Inzwischen freigegeben: normal anlegen (konkurriert sauber über `wx`).
      return writeNew(file, content) === "written" ? { ok: true, file, token } : { ok: false, file, since: readLock(file)?.since ?? null };
    }
    // Ein anderer Lauf hat die Sperre schon ersetzt (oder ihr Besitzer hat sie erneuert) – nicht anfassen.
    if (current.raw !== seen.raw) return { ok: false, file, since: current.since };
    const temp = `${file}.${process.pid}.${token}.tmp`;
    writeFileSync(/* turbopackIgnore: true */ temp, content, "utf8");
    renameSync(/* turbopackIgnore: true */ temp, file);
    const check = readLock(file);
    if (check?.raw !== content) return { ok: false, file, since: check?.since ?? null };
    return { ok: true, file, token, note: `Veraltete Lauf-Sperre ersetzt (${seen.since ?? "Zeitpunkt unbekannt"}).` };
  } finally {
    // Die Übernahme-Sperre gehört diesem Aufruf (oben mit `wx` angelegt).
    removeIfExists(paths.lockTakeover);
  }
}

/**
 * Lauf-Sperre (nur bei --save): legt `<dir>/LOCK` mit `wx` an (Inhalt: Prozess-ID, Zeitpunkt, Besitzer-Kennung).
 * - belegt und jünger als 6 h (oder Zeitpunkt in der Zukunft) → { ok: false } (kein Lauf, nichts wird geschrieben)
 * - älter, oder unlesbar und älter als 1 min → atomar ersetzt (replaceStaleRunLock); `note` gehört in run_start.notes
 * - zwischen Anlegen und Lesen freigegeben → genau ein neuer Versuch
 * `now` ist die echte Uhr (auch bei Simulationen mit --now). `token` gibt man an releaseRunLock zurück.
 */
export function acquireRunLock(dir = MARKET_DATA_DIR, now: Date = new Date()): RunLock {
  const file = marketPaths(dir).lock;
  const token = randomUUID();
  const content = lockContent(now, token);
  if (writeNew(file, content) === "written") return { ok: true, file, token };
  const seen = readLock(file);
  if (seen === null) {
    return writeNew(file, content) === "written" ? { ok: true, file, token } : { ok: false, file, since: readLock(file)?.since ?? null };
  }
  if (!lockIsStale(seen, now)) return { ok: false, file, since: seen.since };
  return replaceStaleRunLock(dir, seen, now);
}

/**
 * Gibt die Lauf-Sperre frei (im finally – auch nach einer Ausnahme) – aber nur die eigene: Gelöscht wird nur, wenn
 * der Inhalt die Besitzer-Kennung `token` trägt (ohne `token`: die eigene Prozess-ID). Eine inzwischen von einem
 * anderen Lauf übernommene Sperre bleibt bestehen. Fehlt sie, passiert nichts. Rückgabe: true = gelöscht.
 */
export function releaseRunLock(dir = MARKET_DATA_DIR, token?: string): boolean {
  const file = marketPaths(dir).lock;
  const current = readLock(file);
  if (current === null) return false;
  const owned = token !== undefined ? current.token === token : current.pid === process.pid;
  if (!owned) return false;
  removeIfExists(file);
  return true;
}
