import { describe, expect, it } from "vitest";
import { checkEligibility } from "./eligibility";
import { evidenceFor, type EvidenceKey, type EvidenceStatus } from "./evidence";
import { missing, unconfirmed, type ProductQuery } from "./model";
import { buildQuote, ok, type QuoteOverrides } from "./quote-builder";

const query: ProductQuery = {
  productId: "p-test",
  title: "Testprodukt",
  gtin: "2000000000015",
  quantity: 1,
  destinationCountry: "DE",
  safety: { ceRequired: true },
};

const said = <T>(v: T) => unconfirmed(v, "Selbstauskunft");
const status = (o: Partial<QuoteOverrides>, q: ProductQuery = query): Record<EvidenceKey, EvidenceStatus> =>
  Object.fromEntries(evidenceFor(buildQuote({ id: "q", supplierName: "Test", ...o }), q).map((e) => [e.key, e.status])) as Record<
    EvidenceKey,
    EvidenceStatus
  >;

describe("Nachweise eines Angebots", () => {
  it("zeigt ein vollständig belegtes Angebot als bestätigt", () => {
    expect(Object.values(status({}))).toEqual(Array(8).fill("ok"));
  });

  it("unterscheidet bestätigt, nur behauptet, fehlend und bestätigt nicht vorhanden", () => {
    expect(status({ reliability: { sampleTested: said(true) } }).sampleTested).toBe("unconfirmed");
    expect(status({ reliability: { sampleTested: missing() } }).sampleTested).toBe("missing");
    expect(status({ reliability: { sampleTested: ok(false) } }).sampleTested).toBe("negative");
    expect(status({ dropshipping: { blindShipping: said(true) } }).blindShipping).toBe("unconfirmed");
    expect(status({ safety: { documents: [] } }).documents).toBe("missing");
  });

  it("markiert CE als nicht erforderlich, wenn das Produkt keine CE-Kennzeichnung braucht", () => {
    expect(status({ safety: { ceMarking: missing() } }, { ...query, safety: { ceRequired: false } }).ce).toBe("not_required");
    expect(status({ safety: { ceMarking: missing() } }).ce).toBe("missing");
  });

  it("bewertet die Produktidentität wie die Eignungsprüfung", () => {
    expect(status({ identity: { gtin: missing(), match: ok("exact") } }).identity).toBe("ok");
    expect(status({ identity: { gtin: missing(), match: said("exact") } }).identity).toBe("unconfirmed");
    expect(status({ identity: { gtin: said("2000000000099") } }).identity).toBe("negative");
    expect(status({ identity: { gtin: missing(), match: missing() } }).identity).toBe("missing");
  });

  it("zählt eine leere verantwortliche Person in der EU nicht als Nachweis – und schließt das Angebot aus", () => {
    const empty = { safety: { euResponsiblePerson: ok("  ") } };
    expect(status(empty).euResponsiblePerson).toBe("missing");
    const e = checkEligibility(buildQuote({ id: "q", supplierName: "Test", ...empty }), query);
    expect(e.exclusions).toEqual([{ code: "safety_unclear", message: "Verantwortliche Person in der EU (GPSR) leer." }]);
  });

  it("zeigt für jedes geeignete Angebot alle Pflichtnachweise der Produktsicherheit als bestätigt", () => {
    // Geeignet heißt: Identität, CE (falls nötig), verantwortliche Person, Sicherheitshinweise und Direktversand sind bestätigt
    const q = buildQuote({ id: "q", supplierName: "Test", reliability: { sampleTested: missing() }, dropshipping: { blindShipping: said(true) } });
    expect(checkEligibility(q, query).eligible).toBe(true);
    const s = status({ reliability: { sampleTested: missing() }, dropshipping: { blindShipping: said(true) } });
    for (const key of ["identity", "ce", "euResponsiblePerson", "safetyInformationDe", "dropshipping"] as const) expect(s[key], key).toBe("ok");
  });
});
