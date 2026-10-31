// Pflichtunterlagen als feste Dokumenttypen (Paket D): Abgleich ausschließlich über den Typ, nie über Freitext.

import { describe, expect, it } from "vitest";
import { DEMO_QUERIES, DEMO_REQUIRED_DOCUMENTS, demoQuotesFor } from "./demo/demo-suppliers";
import { DOC_TYPE_LABELS, documentTypesOf, hasRequiredDocument, openRequiredDocuments } from "./documents";
import { applyEvidence, type EvidenceEntry } from "./import/evidence";
import { DOC_TYPES } from "./model";
import { buildQuote } from "./quote-builder";

const proof: EvidenceEntry = {
  offerKey: "s::A",
  productGtin: DEMO_QUERIES["p-stand"].gtin,
  field: "safety.document",
  docType: "gpsr",
  value: "Herstellerangaben (GPSR) Nr. 7",
  document: "Datenblatt Nr. 7",
  checkedBy: "Prüfer Test",
  checkedAt: "2026-10-01",
};

describe("Pflichtunterlagen über Dokumenttypen", () => {
  it("erfüllt die Pflicht mit einem Nachweis „… (geprüft <Datum>)“ und Dokumenttyp", () => {
    const quote = buildQuote({ id: "s", supplierName: "Echt GmbH", demo: false, safety: { documents: [] } });
    expect(hasRequiredDocument(quote, "gpsr")).toBe(false);
    const proven = applyEvidence(quote, "s::A", DEMO_QUERIES["p-stand"].gtin, [proof]);
    expect(proven.safety.documents).toEqual(["Herstellerangaben (GPSR) Nr. 7 (geprüft 2026-10-01)"]);
    expect(hasRequiredDocument(proven, "gpsr")).toBe(true);
    expect(documentTypesOf(proven)).toEqual(["gpsr"]);
  });

  it("erfüllt eu_doc mit der Demo-Unterlage „Konformitätserklärung (Demo)“", () => {
    const quote = buildQuote({ id: "d", supplierName: "Demo" });
    expect(quote.safety.documents).toEqual(["Konformitätserklärung (Demo)"]);
    expect(hasRequiredDocument(quote, "eu_doc")).toBe(true);
  });

  it("lässt reinen Freitext ohne Typ nie eine Pflicht erfüllen – auch wenn er wie die Pflichtunterlage beginnt", () => {
    const quote = buildQuote({ id: "f", supplierName: "Freitext", safety: { documents: [`${DOC_TYPE_LABELS.gpsr} (geprüft 2026-10-01)`] } });
    expect(documentTypesOf(quote)).toEqual([]);
    expect(hasRequiredDocument(quote, "gpsr")).toBe(false);
    // Nachweis ohne docType (am Prüfweg vorbei übergeben) erfüllt ebenfalls nichts
    const untyped: EvidenceEntry = { ...proof, docType: undefined };
    const q = applyEvidence(buildQuote({ id: "s", supplierName: "Echt", demo: false, safety: { documents: [] } }), "s::A", proof.productGtin, [untyped]);
    expect(hasRequiredDocument(q, "gpsr")).toBe(false);
    expect(q.provenance?.evidenceConflicts?.join(" ")).toMatch(/ohne Dokumenttyp/);
  });

  it("bildet jede Demo-Pflicht auf einen Dokumenttyp ab und zeigt offene Unterlagen unverändert an", () => {
    const led = DEMO_QUERIES["p-led"];
    expect(led.requiredDocTypes).toEqual(["eu_doc", "red_doc", "weee"]);
    const eurolight = demoQuotesFor("p-led").find((q) => q.supplierId === "eurolight")!;
    expect(openRequiredDocuments(eurolight, led)).toEqual([DEMO_REQUIRED_DOCUMENTS.weee]);
    for (const label of Object.values(DEMO_REQUIRED_DOCUMENTS)) expect(Object.values(DOC_TYPE_LABELS)).toContain(label);
    expect(Object.keys(DOC_TYPE_LABELS).sort()).toEqual([...DOC_TYPES].sort());
  });

  it("wertet Freitext-Pflichten ohne Typ immer als offen (fail-closed)", () => {
    const quote = buildQuote({ id: "x", supplierName: "X", safety: { documents: ["Sonderprüfung (Demo)"], documentTypes: [] } });
    const query = { ...DEMO_QUERIES["p-stand"], requiredDocTypes: [], safety: { ceRequired: false, requiredDocuments: ["Sonderprüfung"] } };
    expect(openRequiredDocuments(quote, query)).toEqual(["Sonderprüfung"]);
  });
});
