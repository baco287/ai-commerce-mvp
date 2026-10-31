import "server-only";

// Merkt sich den Zeitpunkt der letzten erfolgreichen Synchronisierung – auch über Neustarts hinweg,
// damit er bei einem späteren Fehler weiter angezeigt werden kann.
// Datei liegt lokal in .data/ (von Git ignoriert) und enthält nur Zeitpunkte und Anzahlen, nie Zugangsdaten.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface SyncState {
  /** Produkte erfolgreich gelesen (read_products) */
  productsAt?: string;
  productCount?: number;
  /** Bestand erfolgreich gelesen (read_inventory) */
  inventoryAt?: string;
  inventoryVariantCount?: number;
}

// turbopackIgnore: Laufzeitdatei, nicht Teil des Builds – sonst zieht Turbopack das ganze Projekt in die Serverausgabe.
export const DEFAULT_SYNC_STATE_FILE = join(/* turbopackIgnore: true */ process.cwd(), ".data", "shopify-sync-state.json");

const isIso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Liest den gespeicherten Stand; fehlende oder beschädigte Datei = noch keine Synchronisierung. */
export async function loadSyncState(file = DEFAULT_SYNC_STATE_FILE): Promise<SyncState> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    const state: SyncState = {};
    if (isIso(raw.productsAt)) state.productsAt = raw.productsAt;
    if (isCount(raw.productCount)) state.productCount = raw.productCount;
    if (isIso(raw.inventoryAt)) state.inventoryAt = raw.inventoryAt;
    if (isCount(raw.inventoryVariantCount)) state.inventoryVariantCount = raw.inventoryVariantCount;
    return state;
  } catch {
    return {};
  }
}

/** Übernimmt je Bereich (Produkte, Bestand) nur einen neueren Zeitpunkt – samt zugehöriger Anzahl. */
export function mergeSyncState(stored: SyncState, update: SyncState): SyncState {
  const next = { ...stored };
  const newer = (a: string | undefined, b: string | undefined) => a !== undefined && (b === undefined || Date.parse(a) >= Date.parse(b));
  if (newer(update.productsAt, stored.productsAt)) {
    next.productsAt = update.productsAt;
    if (update.productCount !== undefined) next.productCount = update.productCount;
  }
  if (newer(update.inventoryAt, stored.inventoryAt)) {
    next.inventoryAt = update.inventoryAt;
    if (update.inventoryVariantCount !== undefined) next.inventoryVariantCount = update.inventoryVariantCount;
  }
  return next;
}

// Gleichzeitige Seitenaufrufe nacheinander abarbeiten, damit kein Lesen-Ändern-Schreiben verloren geht.
let queue: Promise<unknown> = Promise.resolve();

/** Ergänzt den gespeicherten Stand. Schreibt atomar; Schreibfehler brechen die Anzeige nicht ab. */
export function recordSync(update: SyncState, file = DEFAULT_SYNC_STATE_FILE): Promise<SyncState> {
  const run = queue.then(async () => {
    const next = mergeSyncState(await loadSyncState(file), update);
    const temp = `${file}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      await rename(temp, file);
    } catch {
      // Nur ein Komfortmerkmal – die Live-Daten sind trotzdem gültig.
      await rm(temp, { force: true }).catch(() => undefined);
    }
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
