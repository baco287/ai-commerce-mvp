// Gemeinsame Test-Einrichtung.
// - Tests dürfen nie von lokal importierten Lieferantendaten (.data/) abhängen: Der Speicher wird standardmäßig
//   durch einen leeren ersetzt; einzelne Tests können ihn gezielt befüllen.
// - Tests dürfen nie ins Netz – erst recht nicht zu Shopify: Echtes fetch ist gesperrt, Zugangsdaten aus der
//   Umgebung werden entfernt. Tests, die Shopify simulieren, übergeben eine eigene fetch-Funktion.

import { vi } from "vitest";
import { emptyOfferStore, type EvidenceEntry, type OfferStore } from "@/lib/suppliers/import";

export const NETWORK_BLOCKED_MESSAGE = "Netzwerkzugriff ist in Tests gesperrt (src/test/setup.ts).";
const blocked = () => {
  throw new Error(NETWORK_BLOCKED_MESSAGE);
};
vi.stubGlobal("fetch", vi.fn(async () => blocked()));
vi.stubGlobal("WebSocket", vi.fn(blocked));
for (const key of Object.keys(process.env)) if (key.startsWith("SHOPIFY_")) delete process.env[key];

export const testSupplierData: { store: OfferStore; evidence: EvidenceEntry[] } = { store: emptyOfferStore(), evidence: [] };

// Auch der Market-Scout-Speicher (.data/market) bleibt in Tests leer, und kein Abbruchschalter ist gesetzt.
vi.mock("@/lib/market/server/market-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market/server/market-store")>();
  const { emptyMarketState } = await import("@/lib/market/state");
  return { ...actual, loadMarketState: () => ({ state: emptyMarketState() }), isStopRequested: () => false };
});

// Der lokale Zielproduktkatalog (.data/catalog) bleibt in Tests leer – außer ein Test übergibt ausdrücklich eine Datei.
vi.mock("@/lib/market/server/catalog-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/market/server/catalog-store")>();
  return {
    ...actual,
    loadCatalog: (now: Date, file?: string) => (file === undefined ? { products: [], invalid: [], sha256: null } : actual.loadCatalog(now, file)),
  };
});

vi.mock("@/lib/suppliers/server/offer-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/suppliers/server/offer-store")>();
  return {
    ...actual,
    // Mit ausdrücklich übergebener Datei (nur Tests mit Temp-Verzeichnis) wird die echte Ladefunktion geprüft.
    loadOfferStore: (file?: string) => (file === undefined ? { store: testSupplierData.store } : actual.loadOfferStore(file)),
    loadEvidence: (file?: string) => (file === undefined ? { entries: testSupplierData.evidence, errors: [] } : actual.loadEvidence(file)),
  };
});
