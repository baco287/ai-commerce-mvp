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

vi.mock("@/lib/suppliers/server/offer-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/suppliers/server/offer-store")>();
  return {
    ...actual,
    loadOfferStore: () => ({ store: testSupplierData.store }),
    loadEvidence: () => ({ entries: testSupplierData.evidence, errors: [] }),
  };
});
