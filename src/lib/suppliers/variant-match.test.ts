// Variantenzuordnung (Paket B). Alle Angebote sind synthetisch im Speicher erzeugt (nur Test); GTINs sind fiktiv
// mit gültiger Prüfziffer.

import { afterEach, describe, expect, it } from "vitest";
import { testSupplierData } from "@/test/setup";
import { DEMO_QUERIES } from "./demo/demo-suppliers";
import { priceListQuotesFor, priceListVariantQuotes } from "./import/adapter";
import { emptyOfferStore, type ImportedOfferData, type OfferStore, type StoredOffer } from "./import/types";
import type { ProductQuery } from "./model";
import { matchVariant, type VariantTarget } from "./variant-match";

/** NUR TEST: gültige GS1-Prüfziffer an eine fiktive Ziffernfolge anhängen. */
function gtin(body: string): string {
  const sum = body
    .split("")
    .map(Number)
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}
const G1 = gtin("401234500001"); // NUR TEST
const G2 = gtin("401234500002"); // NUR TEST
const INSTORE = gtin("200000009999"); // NUR TEST: eingeschränkter Nummernkreis

/** NUR TEST: gespeichertes Preislisten-Angebot, standardmäßig ECHT (synthetic: false). */
function offer(supplierId: string, sku: string, data: Partial<ImportedOfferData> = {}, synthetic = false): StoredOffer {
  return {
    key: `${supplierId}::${sku}`,
    data: { supplierId, supplierName: `Lieferant ${supplierId}`, supplierSku: sku, title: "Kabelkanal", unitPrice: 4, currency: "EUR", ...data },
    provenance: { importId: "imp-1", importedAt: "2026-10-30T10:00:00.000Z", file: "liste.csv", fileSha256: "a".repeat(64), row: 2, synthetic },
    firstImportedAt: "2026-10-30T10:00:00.000Z",
    lastSeenImportId: "imp-1",
    history: [],
  };
}
const none = new Set<string>();

describe("Variantenzuordnung über die GTIN", () => {
  it("ordnet alle Angebote mit derselben globalen GTIN zu – auch in anderer Schreibweise", () => {
    const m = matchVariant({ shopSku: "KK-1", gtin: G1 }, [offer("a", "1", { gtin: `0${G1}` }), offer("b", "2", { gtin: G1 }), offer("c", "3", { gtin: G2 })], none);
    expect(m).toMatchObject({ status: "matched", basis: "gtin", offerKeys: ["a::1", "b::2"] });
  });

  it("lässt einen Lieferanten mit zwei Artikelnummern für dieselbe GTIN aus – ein anderer bleibt", () => {
    const offers = [offer("a", "1", { gtin: G1 }), offer("a", "2", { gtin: G1 }), offer("b", "9", { gtin: G1 })];
    const m = matchVariant({ shopSku: "KK-1", gtin: G1 }, offers, none);
    expect(m.status).toBe("matched");
    if (m.status !== "matched") return;
    expect(m.offerKeys).toEqual(["b::9"]);
    expect(m.hints.join(" ")).toMatch(/Lieferant a .*mehrdeutig/);
    const only = matchVariant({ shopSku: "KK-1", gtin: G1 }, offers.slice(0, 2), none);
    expect(only).toMatchObject({ status: "ambiguous", code: "IDENTITY_AMBIGUOUS" });
  });

  it("meldet einen Widerspruch, wenn ein benanntes Angebot eine andere GTIN trägt", () => {
    const m = matchVariant({ shopSku: "KK-1", gtin: G1, supplierOffers: ["a::1"] }, [offer("a", "1", { gtin: G2 })], none);
    expect(m).toMatchObject({ status: "conflict", code: "IDENTITY_CONFLICT", offerKeys: ["a::1"] });
  });

  it("findet nichts ohne passendes Angebot und nie über eingeschränkte GTINs", () => {
    expect(matchVariant({ shopSku: "KK-1", gtin: G1 }, [offer("a", "1", { gtin: G2 })], none)).toMatchObject({ status: "none", code: "IDENTITY_NO_OFFER" });
    expect(matchVariant({ shopSku: "KK-1", gtin: INSTORE }, [offer("a", "1", { gtin: INSTORE })], none).status).toBe("none");
  });

  it("ignoriert veraltete und synthetische Angebote", () => {
    const offers = [offer("a", "1", { gtin: G1 }), offer("b", "2", { gtin: G1 }, true)];
    expect(matchVariant({ shopSku: "KK-1", gtin: G1 }, offers, new Set(["a::1"]))).toMatchObject({ status: "none", code: "IDENTITY_NO_OFFER" });
  });
});

describe("Variantenzuordnung ohne GTIN", () => {
  const target = (o: Partial<VariantTarget>): VariantTarget => ({ shopSku: "KK-S", supplierOffers: ["a::1"], ...o });

  it("ordnet über Artikelnummer + MPN zu (Leer- und Trennzeichen egal)", () => {
    const m = matchVariant(target({ mpn: "KK 100-S" }), [offer("a", "1", { mpn: "kk100s" })], none);
    expect(m).toMatchObject({ status: "matched", basis: "supplier_sku_mpn", offerKeys: ["a::1"] });
  });

  it("ordnet über Artikelnummer + Variantenkennung zu (Groß-/Kleinschreibung egal)", () => {
    const m = matchVariant(target({ label: "Schwarz / 2 m" }), [offer("a", "1", { variantLabel: " schwarz / 2 M " })], none);
    expect(m).toMatchObject({ status: "matched", basis: "supplier_sku_label" });
    expect(matchVariant(target({ label: "Weiß" }), [offer("a", "1", { variantLabel: "Schwarz" })], none)).toMatchObject({ status: "conflict", code: "IDENTITY_CONFLICT" });
  });

  it("findet nichts ohne MPN und Variantenkennung oder wenn ein benanntes Angebot fehlt", () => {
    expect(matchVariant(target({}), [offer("a", "1")], none)).toMatchObject({ status: "none", code: "IDENTITY_NO_OFFER" });
    expect(matchVariant(target({ mpn: "X", supplierOffers: ["a::1", "b::2"] }), [offer("a", "1", { mpn: "X" })], none)).toMatchObject({ status: "none", code: "IDENTITY_NO_OFFER" });
  });

  it("verlangt das Nachtragen der GTIN, wenn der Lieferant eine globale GTIN nennt", () => {
    const m = matchVariant(target({ mpn: "X" }), [offer("a", "1", { mpn: "X", gtin: G1 })], none);
    expect(m).toMatchObject({ status: "conflict", code: "IDENTITY_GTIN_AVAILABLE" });
    // Eine eingeschränkte GTIN zählt wie keine – mit Hinweis
    const restricted = matchVariant(target({ mpn: "X" }), [offer("a", "1", { mpn: "X", gtin: INSTORE })], none);
    expect(restricted.status).toBe("matched");
    if (restricted.status === "matched") expect(restricted.hints.join(" ")).toMatch(/wie ein Angebot ohne GTIN/);
  });

  it("ist mehrdeutig, wenn zwei benannte Artikel desselben Lieferanten passen", () => {
    const m = matchVariant(target({ mpn: "X", supplierOffers: ["a::1", "a::2"] }), [offer("a", "1", { mpn: "X" }), offer("a", "2", { mpn: "X" })], none);
    expect(m).toMatchObject({ status: "ambiguous", code: "IDENTITY_AMBIGUOUS" });
  });

  it("ignoriert veraltete und synthetische Angebote auch hier", () => {
    expect(matchVariant(target({ mpn: "X" }), [offer("a", "1", { mpn: "X" }, true)], none).status).toBe("none");
    expect(matchVariant(target({ mpn: "X" }), [offer("a", "1", { mpn: "X" })], new Set(["a::1"])).status).toBe("none");
  });
});

describe("Preislisten-Adapter: getrennte Wege für Demo und echte Daten", () => {
  const store = (...offers: StoredOffer[]): OfferStore => ({ ...emptyOfferStore(), offers: Object.fromEntries(offers.map((o) => [o.key, o])) });
  const LED = DEMO_QUERIES["p-led"];
  afterEach(() => {
    testSupplierData.store = emptyOfferStore();
    testSupplierData.evidence = [];
  });

  it("liefert auf dem Demo-Weg nur synthetische Angebote zu Demo-Abfragen – nie echte Zeilen mit Demo-GTIN", () => {
    const s = store(offer("echt", "1", { gtin: LED.gtin }), offer("test", "2", { gtin: LED.gtin }, true));
    expect(priceListQuotesFor(s, LED, [], { allowReal: false }).map((q) => q.supplierId)).toEqual(["test"]);
    // Echter Weg: Demo-GTINs ergeben nie einen Treffer, synthetische Angebote nie ein Ergebnis
    expect(priceListQuotesFor(s, LED, [], { allowReal: true })).toEqual([]);
  });

  it("ordnet auf dem echten Weg nur nicht-synthetische Angebote über eine globale GTIN zu", () => {
    const query: ProductQuery = { productId: "catalog:kk", title: "Kabelkanal", gtin: G1, quantity: 1, destinationCountry: "DE", safety: { ceRequired: false } };
    const s = store(offer("echt", "1", { gtin: G1 }), offer("test", "2", { gtin: G1 }, true));
    expect(priceListQuotesFor(s, query, [], { allowReal: true }).map((q) => q.supplierId)).toEqual(["echt"]);
    expect(priceListQuotesFor(s, query, [], { allowReal: false })).toEqual([]);
  });

  it("liefert für eine Katalogvariante ohne GTIN Zuordnung und Angebot – die Identität bleibt „vom Lieferanten angegeben“", () => {
    const query: ProductQuery = { productId: "catalog:kk", productKey: "cat:kk:KK-S", title: "Kabelkanal", quantity: 1, destinationCountry: "DE", safety: { ceRequired: false } };
    const s = store(offer("a", "1", { mpn: "KK-100" }), offer("a", "2", { mpn: "KK-200" }));
    const { match, quotes } = priceListVariantQuotes(s, query, [], { shopSku: "KK-S", supplierOffers: ["a::1"], mpn: "KK100" });
    expect(match).toMatchObject({ status: "matched", basis: "supplier_sku_mpn", offerKeys: ["a::1"] });
    expect(quotes.map((q) => q.identity.supplierSku)).toEqual(["1"]);
    expect(quotes[0].identity.match).toMatchObject({ status: "unconfirmed", value: "exact", origin: "supplier" });
    expect(quotes[0].demo).toBe(false);
  });
});
