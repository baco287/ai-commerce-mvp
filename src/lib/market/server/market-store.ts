import "server-only";

// Lokaler Speicher des Market Scout in .data/market/ (von Git ignoriert). Nur serverseitig.
// Schreiben nur über den Befehl `npm run market:scan -- --save`. Kein Netzwerk.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emptyMarketState, isMarketState, type MarketState } from "../state";

// turbopackIgnore: Laufzeitdaten, nicht Teil des Builds.
export const MARKET_DATA_DIR = join(/* turbopackIgnore: true */ process.cwd(), ".data", "market");
export const MARKET_STATE_FILE = join(MARKET_DATA_DIR, "state.json");
/** Abbruchschalter ohne Code-Änderung: Existiert diese Datei, startet kein Lauf bzw. ein laufender stoppt. */
export const MARKET_STOP_FILE = join(MARKET_DATA_DIR, "STOP");

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

/** Schreibt atomar (temporäre Datei + Umbenennen). */
export function saveMarketState(state: MarketState, file = MARKET_STATE_FILE): void {
  mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(/* turbopackIgnore: true */ temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(/* turbopackIgnore: true */ temp, file);
}

export const isStopRequested = (file = MARKET_STOP_FILE) => existsSync(/* turbopackIgnore: true */ file);
