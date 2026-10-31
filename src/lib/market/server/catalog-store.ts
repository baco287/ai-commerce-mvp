import "server-only";

// Lokaler Zielproduktkatalog in .data/catalog/products.json (von Git ignoriert). Nur serverseitig, NUR LESEND:
// Der Katalog wird von Hand gepflegt – kein Code schreibt ihn. Kein Netzwerk. Format: docs/MARKET-SCOUT.md

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCatalog, type CatalogValidation } from "../catalog";

// turbopackIgnore: Laufzeitdaten, nicht Teil des Builds.
export const CATALOG_FILE = join(/* turbopackIgnore: true */ process.cwd(), ".data", "catalog", "products.json");

export type LoadedCatalog = CatalogValidation & {
  /** Lesefehler (Datei beschädigt) – der Katalog ist dann leer */
  error?: string;
  /** Prüfsumme der Datei für den Eingabe-Fingerabdruck eines Laufs; null = keine Datei */
  sha256: string | null;
};

/** Lädt und prüft den Katalog. Fehlt die Datei, ist der Katalog leer (kein Fehler). */
export function loadCatalog(now: Date, file = CATALOG_FILE): LoadedCatalog {
  if (!existsSync(/* turbopackIgnore: true */ file)) return { products: [], invalid: [], sha256: null };
  let bytes: Buffer;
  try {
    bytes = readFileSync(/* turbopackIgnore: true */ file);
  } catch {
    return { products: [], invalid: [], sha256: null, error: "Zielproduktkatalog ist nicht lesbar." };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    return { ...validateCatalog(JSON.parse(bytes.toString("utf8")), now), sha256 };
  } catch {
    return { products: [], invalid: [], sha256, error: "Zielproduktkatalog ist kein gültiges JSON (beschädigt?)." };
  }
}
