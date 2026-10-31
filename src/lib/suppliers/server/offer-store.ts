import "server-only";

// Lokaler Speicher für importierte Lieferantenangebote und Nachweise. Nur serverseitig.
// Liegt in .data/suppliers/ (von Git ignoriert): echte Preislisten und Konditionen gehören nicht ins
// öffentliche Repository. Schreiben nur über den Befehl `npm run suppliers:import -- … --apply`.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emptyOfferStore, validateEvidence, type EvidenceEntry, type OfferStore } from "../import";

// turbopackIgnore: Laufzeitdaten, nicht Teil des Builds.
export const SUPPLIER_DATA_DIR = join(/* turbopackIgnore: true */ process.cwd(), ".data", "suppliers");
export const OFFER_STORE_FILE = join(SUPPLIER_DATA_DIR, "offers.json");
export const EVIDENCE_FILE = join(SUPPLIER_DATA_DIR, "evidence.json");

export interface LoadedStore {
  store: OfferStore;
  /** Lesefehler – dann wird mit leerem Bestand gearbeitet und NICHT überschrieben */
  error?: string;
}

function isStore(v: unknown): v is OfferStore {
  return !!v && typeof v === "object" && (v as OfferStore).version === 1 && typeof (v as OfferStore).offers === "object" && Array.isArray((v as OfferStore).imports);
}

export function loadOfferStore(file = OFFER_STORE_FILE): LoadedStore {
  if (!existsSync(/* turbopackIgnore: true */ file)) return { store: emptyOfferStore() };
  try {
    const parsed: unknown = JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8"));
    if (!isStore(parsed)) return { store: emptyOfferStore(), error: "Angebotsspeicher hat ein unbekanntes Format." };
    return { store: parsed };
  } catch {
    return { store: emptyOfferStore(), error: "Angebotsspeicher ist nicht lesbar (beschädigt?)." };
  }
}

export function loadEvidence(file = EVIDENCE_FILE): { entries: EvidenceEntry[]; errors: string[] } {
  if (!existsSync(/* turbopackIgnore: true */ file)) return { entries: [], errors: [] };
  try {
    return validateEvidence(JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8")));
  } catch {
    return { entries: [], errors: ["Nachweisdatei ist nicht lesbar (kein gültiges JSON)."] };
  }
}

/**
 * Schreibt den Speicher atomar (temporäre Datei + Umbenennen) und legt vorher eine Sicherung des alten
 * Stands an. Gibt den Pfad der Sicherung zurück (oder null beim ersten Import).
 */
export function saveOfferStore(store: OfferStore, options: { file?: string; backupTag: string }): string | null {
  const file = options.file ?? OFFER_STORE_FILE;
  mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
  let backup: string | null = null;
  if (existsSync(/* turbopackIgnore: true */ file)) {
    backup = join(dirname(file), "backups", `offers-${options.backupTag.replace(/[^a-zA-Z0-9-]/g, "-")}.json`);
    mkdirSync(/* turbopackIgnore: true */ dirname(backup), { recursive: true });
    writeFileSync(/* turbopackIgnore: true */ backup, readFileSync(/* turbopackIgnore: true */ file));
  }
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(/* turbopackIgnore: true */ temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(/* turbopackIgnore: true */ temp, file);
  return backup;
}
