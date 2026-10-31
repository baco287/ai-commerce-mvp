import { describe, expect, it } from "vitest";
import { DEMO_QUERIES } from "./demo/demo-suppliers";
import { checkEligibility } from "./eligibility";
import {
  gtinClass,
  isDemoGtin,
  normalizeGtin14,
  normalizeMpn,
  offerIdentityKey,
  sameDemoGtin,
  sameGtin,
  sameGtinDigits,
  sameGtinOrDemoGtin,
} from "./identity";
import { applyEvidence, type EvidenceEntry } from "./import/evidence";
import { priceListQuotesFor } from "./import/adapter";
import { emptyOfferStore, type OfferStore, type StoredOffer } from "./import/types";
import { missing, type ProductQuery } from "./model";
import { buildQuote, ok } from "./quote-builder";

/** NUR TEST: hängt an fiktive Ziffernfolgen die gültige GS1-Prüfziffer an. Keine echten Produkte. */
function gtin(body: string): string {
  const sum = body
    .split("")
    .map(Number)
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

// NUR TEST: fiktive GTINs mit gültiger Prüfziffer
const GLOBAL_13 = gtin("401234500001"); // 13 Stellen, Präfix 401 → global
const GLOBAL_12 = gtin("01234567890"); // 12 Stellen (UPC), Nummernsystem 0 → global
const DEMO = DEMO_QUERIES["p-led"].gtin; // fiktive Demo-GTIN (Präfix 200)

describe("GTIN-Kern: Normalisierung", () => {
  it("bildet GTIN-8, -12, -13 und -14 derselben Nummer auf dieselbe GTIN-14 ab", () => {
    expect(GLOBAL_13).toHaveLength(13);
    expect(normalizeGtin14(GLOBAL_13)).toBe(`0${GLOBAL_13}`);
    expect(normalizeGtin14(`0${GLOBAL_13}`)).toBe(`0${GLOBAL_13}`);
    expect(GLOBAL_12).toHaveLength(12);
    expect(normalizeGtin14(GLOBAL_12)).toBe(`00${GLOBAL_12}`);
    expect(normalizeGtin14(`0${GLOBAL_12}`)).toBe(`00${GLOBAL_12}`);
    expect(normalizeGtin14(`00${GLOBAL_12}`)).toBe(`00${GLOBAL_12}`);
    const g8 = gtin("4012345");
    expect(g8).toHaveLength(8);
    expect(normalizeGtin14(g8)).toBe(`000000${g8}`);
    expect(normalizeGtin14(` ${GLOBAL_13} `)).toBe(`0${GLOBAL_13}`);
  });

  it("lehnt falsche Prüfziffer, falsche Länge und Nicht-Ziffern ab", () => {
    const wrong = `${GLOBAL_13.slice(0, 12)}${(Number(GLOBAL_13[12]) + 1) % 10}`;
    for (const raw of [wrong, "12345", "1234567890", "40123450000a", "", undefined]) {
      expect(normalizeGtin14(raw), String(raw)).toBeNull();
      expect(gtinClass(raw), String(raw)).toBe("invalid");
    }
  });
});

describe("GTIN-Kern: Klassen", () => {
  it("stuft eingeschränkte GS1-Präfixe als restricted ein", () => {
    for (const body of ["020000000001", "045000000001", "055000000001", "200000000001", "299000000001", "980000000001", "999000000001"]) {
      expect(gtinClass(gtin(body)), body).toBe("restricted");
    }
    expect(gtinClass(DEMO)).toBe("restricted");
  });

  it("stuft GTIN-8 mit Präfix 0 oder 2 als restricted ein, andere GTIN-8 als global", () => {
    expect(gtinClass(gtin("0123456"))).toBe("restricted");
    expect(gtinClass(gtin("2123456"))).toBe("restricted");
    expect(gtinClass(gtin("4012345"))).toBe("global");
  });

  it("erkennt Umverpackungen (Indikator 1–8) und variable Mengen (Indikator 9)", () => {
    for (const indicator of ["1", "5", "8"]) expect(gtinClass(gtin(`${indicator}401234500001`)), indicator).toBe("trade_unit");
    expect(gtinClass(gtin("9401234500001"))).toBe("restricted");
  });

  it("lässt ISBN/ISMN (978/979) und gewöhnliche Präfixe global", () => {
    expect(gtinClass(gtin("978300000001"))).toBe("global");
    expect(gtinClass(gtin("979000000001"))).toBe("global");
    expect(gtinClass(GLOBAL_13)).toBe("global");
    expect(gtinClass(GLOBAL_12)).toBe("global");
  });
});

describe("GTIN-Kern: Vergleiche", () => {
  it("sameGtin gilt nur für globale GTINs – in jeder Schreibweise", () => {
    expect(sameGtin(GLOBAL_13, `0${GLOBAL_13}`)).toBe(true);
    expect(sameGtin(GLOBAL_12, `00${GLOBAL_12}`)).toBe(true);
    expect(sameGtin(GLOBAL_13, GLOBAL_12)).toBe(false);
    // Nie für eingeschränkte, Umverpackungs- oder ungültige Nummern – auch nicht bei identischem Text
    for (const raw of [DEMO, gtin("045000000001"), gtin("1401234500001"), gtin("9401234500001"), "12345", undefined]) {
      expect(sameGtin(raw, raw), String(raw)).toBe(false);
    }
  });

  it("sameGtinDigits vergleicht nur die Nummer (kein Identitätsbeleg)", () => {
    expect(sameGtinDigits(DEMO, `0${DEMO}`)).toBe(true);
    expect(sameGtinDigits(DEMO, DEMO_QUERIES["p-stand"].gtin)).toBe(false);
    expect(sameGtinDigits(undefined, undefined)).toBe(false);
  });

  it("lässt übergangsweise nur dieselbe Demo-GTIN zu, keine anderen eingeschränkten Nummern", () => {
    expect(isDemoGtin(DEMO)).toBe(true);
    expect(sameGtinOrDemoGtin(DEMO, `0${DEMO}`)).toBe(true);
    const otherInstore = gtin("210000000001");
    expect(sameGtinOrDemoGtin(otherInstore, otherInstore)).toBe(false);
    expect(sameGtinOrDemoGtin(GLOBAL_13, `0${GLOBAL_13}`)).toBe(true);
  });

  it("sameDemoGtin gilt nur für Demo-Abfragen UND synthetische Angebote", () => {
    const offer = (synthetic: boolean, g = DEMO): StoredOffer => ({
      key: "x::1",
      data: { supplierId: "x", supplierName: "X", supplierSku: "1", gtin: g, title: "T", unitPrice: 1, currency: "EUR", dataSource: "Test" },
      provenance: { importId: "i", importedAt: "2026-10-01T00:00:00.000Z", file: "f.csv", fileSha256: "a", row: 2, synthetic },
      firstImportedAt: "2026-10-01T00:00:00.000Z",
      lastSeenImportId: "i",
      history: [],
    });
    const demoQuery = DEMO_QUERIES["p-led"];
    expect(sameDemoGtin(demoQuery, offer(true))).toBe(true);
    expect(sameDemoGtin(demoQuery, offer(false))).toBe(false);
    expect(sameDemoGtin({ ...demoQuery, productId: "catalog:etwas" }, offer(true))).toBe(false);
    expect(sameDemoGtin(demoQuery, offer(true, DEMO_QUERIES["p-stand"].gtin))).toBe(false);
  });

  it("normalisiert Herstellernummern ohne Leer- und Trennzeichen", () => {
    expect(normalizeMpn(" ab-12 3.4/x_y ")).toBe("AB1234XY");
    expect(normalizeMpn("AB-1234")).toBe(normalizeMpn("ab 1234"));
    expect(normalizeMpn("  ")).toBeUndefined();
    expect(normalizeMpn(undefined)).toBeUndefined();
  });

  it("bildet den Identitätsschlüssel eines Angebots über globale GTIN, sonst über Lieferant und Artikelnummer", () => {
    expect(offerIdentityKey({ supplierId: "s", supplierSku: "A-1", gtin: GLOBAL_13 })).toBe(`gtin:0${GLOBAL_13}`);
    expect(offerIdentityKey({ supplierId: "s", supplierSku: "A-1", gtin: DEMO })).toBe("sku:s::A-1");
    expect(offerIdentityKey({ supplierId: "s", supplierSku: "A-1" })).toBe("sku:s::A-1");
  });
});

describe("GTIN-Kern in Eignung, Preislisten-Zuordnung und Nachweisen", () => {
  const realQuery: ProductQuery = { productId: "catalog:test", title: "Testartikel", gtin: GLOBAL_13, quantity: 1, destinationCountry: "DE", safety: { ceRequired: false } };

  it("akzeptiert eine bestätigte globale GTIN auch in anderer Schreibweise", () => {
    const q = buildQuote({ id: "r", supplierName: "Echt", demo: false, identity: { gtin: ok(`0${GLOBAL_13}`), match: missing() } });
    expect(checkEligibility(q, realQuery).exclusions).toEqual([]);
  });

  it("schließt echte Angebote mit Umverpackungs-GTIN aus (verdeckte Mindestabnahme)", () => {
    const carton = gtin("1401234500001");
    const q = buildQuote({ id: "r", supplierName: "Echt", demo: false, identity: { gtin: ok(carton) } });
    const e = checkEligibility(q, { ...realQuery, gtin: carton });
    expect(e.exclusions.map((x) => x.code)).toEqual(["stock_purchase_required"]);
  });

  it("zählt eine eingeschränkte GTIN eines echten Angebots nicht als Identitätsbeleg", () => {
    const instore = gtin("210000000001");
    const q = buildQuote({ id: "r", supplierName: "Echt", demo: false, identity: { gtin: ok(instore), match: missing() } });
    const e = checkEligibility(q, { ...realQuery, gtin: instore });
    expect(e.exclusions.map((x) => x.code)).toEqual(["identity_unconfirmed"]);
    expect(e.warnings.map((w) => w.code)).toContain("gtin_not_global");
  });

  it("ordnet Preislisten-Zeilen und Nachweise über die normalisierte globale GTIN zu, nie über eingeschränkte", () => {
    const row = (key: string, g: string): StoredOffer => ({
      key,
      data: { supplierId: "s", supplierName: "S", supplierSku: key.split("::")[1], gtin: g, title: "T", unitPrice: 5, currency: "EUR", dataSource: "Test" },
      provenance: { importId: "i", importedAt: "2026-10-01T00:00:00.000Z", file: "f.csv", fileSha256: "a", row: 2, synthetic: false },
      firstImportedAt: "2026-10-01T00:00:00.000Z",
      lastSeenImportId: "i",
      history: [],
    });
    const instore = gtin("210000000001");
    const store: OfferStore = { ...emptyOfferStore(), offers: { "s::A": row("s::A", `0${GLOBAL_13}`), "s::B": row("s::B", instore) } };
    expect(priceListQuotesFor(store, realQuery, [], { allowReal: true }).map((q) => q.identity.supplierSku)).toEqual(["A"]);
    expect(priceListQuotesFor(store, { ...realQuery, gtin: instore }, [], { allowReal: true })).toEqual([]);

    const [quote] = priceListQuotesFor(store, realQuery, [], { allowReal: true });
    const entry: EvidenceEntry = { offerKey: "s::A", productGtin: `0${GLOBAL_13}`, field: "safety.ceMarking", value: true, document: "Test", checkedBy: "Test", checkedAt: "2026-10-01" };
    expect(applyEvidence(quote, "s::A", GLOBAL_13, [entry]).safety.ceMarking.status).toBe("confirmed");
    expect(applyEvidence(quote, "s::A", instore, [{ ...entry, productGtin: instore }]).safety.ceMarking.status).toBe("missing");
  });
});
