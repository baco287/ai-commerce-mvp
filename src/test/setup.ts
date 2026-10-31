// Gemeinsame Test-Einrichtung: Tests dürfen nie von lokal importierten Lieferantendaten (.data/) abhängen.
// Der Speicher wird daher standardmäßig durch einen leeren ersetzt; einzelne Tests können ihn gezielt befüllen.

import { vi } from "vitest";
import { emptyOfferStore, type EvidenceEntry, type OfferStore } from "@/lib/suppliers/import";

export const testSupplierData: { store: OfferStore; evidence: EvidenceEntry[] } = { store: emptyOfferStore(), evidence: [] };

vi.mock("@/lib/suppliers/server/offer-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/suppliers/server/offer-store")>();
  return {
    ...actual,
    loadOfferStore: () => ({ store: testSupplierData.store }),
    loadEvidence: () => ({ entries: testSupplierData.evidence, errors: [] }),
  };
});
