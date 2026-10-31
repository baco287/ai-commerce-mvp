import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { catalogVariantQueries, hasDemoMarker, validateCatalog, type CatalogProduct } from "./catalog";
import { loadCatalog } from "./server/catalog-store";

const NOW = new Date("2026-10-31T12:00:00Z");

/** NUR TEST: gültige Prüfziffer an eine fiktive Ziffernfolge anhängen. */
function gtin(body: string): string {
  const sum = body
    .split("")
    .map(Number)
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** NUR TEST: synthetisches Katalogprodukt (fiktive Kennungen, keine echten Lieferanten oder Produkte). */
function product(o: Partial<CatalogProduct> & { variants?: CatalogProduct["variants"] } = {}): CatalogProduct {
  return {
    id: "kabelkanal-weiss",
    title: "Kabelkanal selbstklebend",
    category: "Büromaterial",
    wikiTitle: "Kabelkanal",
    salePrice: { gross: 19.9, basis: "plan", reference: "Planpreis (Test)", checkedAt: "2026-10-30" },
    variants: [{ shopSku: "KK-W-01", gtin: gtin("401234500001"), brand: "Testmarke" }],
    listing: {
      handle: "kabelkanal-selbstklebend",
      title: "Kabelkanal selbstklebend",
      descriptionHtml: "<p>Testbeschreibung</p>",
      productType: "Kabelmanagement",
      categoryTag: "buero",
      images: [{ url: "https://bilder.example/kabelkanal.jpg", alt: "Kabelkanal", rightsReference: "Eigene Aufnahme (Test)" }],
    },
    ...o,
  };
}

const messages = (raw: unknown) => validateCatalog(raw, NOW).invalid.flatMap((x) => x.messages).join(" | ");

describe("Zielproduktkatalog: Validierung", () => {
  it("übernimmt ein gültiges Produkt und verwirft unbekannte Felder", () => {
    const r = validateCatalog({ products: [{ ...product(), extra: "x" }] }, NOW);
    expect(r.invalid).toEqual([]);
    expect(r.products).toEqual([product()]);
    expect(validateCatalog([product()], NOW).products).toHaveLength(1);
  });

  it("liefert für fehlende oder leere Daten einen leeren Katalog", () => {
    expect(validateCatalog(undefined, NOW)).toEqual({ products: [], invalid: [] });
    expect(validateCatalog({ products: "x" }, NOW).invalid[0].codes).toEqual(["CATALOG_INVALID"]);
  });

  it("lehnt doppelte id, Handle, shopSku und GTIN ab – alle beteiligten Produkte", () => {
    const a = product();
    const b = product({ id: "kabelkanal-schwarz", listing: { ...product().listing, handle: "anderer-handle" }, variants: [{ shopSku: "KK-S-01", gtin: gtin("401234500002") }] });
    expect(validateCatalog([a, { ...a }], NOW).products).toEqual([]);
    expect(messages([a, { ...b, listing: a.listing }])).toMatch(/handle „kabelkanal-selbstklebend“ doppelt/);
    expect(messages([a, { ...b, variants: [{ shopSku: "kk-w-01", gtin: gtin("401234500002") }] }])).toMatch(/shopSku .* doppelt/);
    // Gleiche GTIN in anderer Schreibweise (14 statt 13 Stellen)
    const r = validateCatalog([a, { ...b, variants: [{ shopSku: "KK-S-01", gtin: `0${a.variants[0].gtin}` }] }], NOW);
    expect(r.products).toEqual([]);
    expect(r.invalid.map((x) => x.id)).toEqual(["kabelkanal-schwarz", "kabelkanal-weiss"]);
    expect(validateCatalog([a, b], NOW).products).toHaveLength(2);
  });

  it("lehnt Demo-Kennzeichen in Kennungen und Texten ab", () => {
    const l = product().listing;
    const cases: unknown[] = [
      product({ listing: { ...l, handle: "demo-kabelkanal" } }),
      product({ listing: { ...l, categoryTag: "ai-commerce-demo" } }),
      product({ listing: { ...l, productType: "Demo Zubehör" } }),
      product({ listing: { ...l, title: "[DEMO] Kabelkanal" } }),
      product({ variants: [{ shopSku: "DEMO-KK-1", gtin: gtin("401234500001") }] }),
      product({ variants: [{ shopSku: "KK-W-01", gtin: gtin("401234500001"), brand: "Demo" }] }),
      product({ id: "p-kabelkanal" }),
    ];
    for (const c of cases) {
      const r = validateCatalog([c], NOW);
      expect(r.products, JSON.stringify(c).slice(0, 80)).toEqual([]);
      expect(r.invalid[0].codes).toContain("CATALOG_INVALID");
    }
    expect(hasDemoMarker("Demontage-Set")).toBe(false);
    expect(hasDemoMarker("demo")).toBe(true);
  });

  it("lehnt eingeschränkte, Umverpackungs- und ungültige GTINs mit eigener Meldung ab", () => {
    const restricted = validateCatalog([product({ variants: [{ shopSku: "KK-1", gtin: gtin("200000000001") }] })], NOW).invalid[0];
    expect(restricted.codes).toEqual(["CATALOG_INVALID", "IDENTITY_RESTRICTED_GTIN"]);
    expect(restricted.messages.join(" ")).toMatch(/eingeschränkter Nummernkreis/);
    const carton = validateCatalog([product({ variants: [{ shopSku: "KK-1", gtin: gtin("1401234500001") }] })], NOW).invalid[0];
    expect(carton.codes).toEqual(["CATALOG_INVALID", "IDENTITY_TRADE_UNIT_GTIN"]);
    expect(carton.messages.join(" ")).toMatch(/Umverpackung/);
    expect(messages([product({ variants: [{ shopSku: "KK-1", gtin: "4012345000010" }] })])).toMatch(/keine gültige GTIN/);
  });

  it("verlangt ohne GTIN Angebots-Schlüssel und MPN oder Kennung", () => {
    expect(messages([product({ variants: [{ shopSku: "KK-1" }] })])).toMatch(/ohne GTIN/);
    expect(messages([product({ variants: [{ shopSku: "KK-1", supplierOffers: ["lieferant::A-1"] }] })])).toMatch(/ohne GTIN/);
    expect(messages([product({ variants: [{ shopSku: "KK-1", mpn: "X-1" }] })])).toMatch(/ohne GTIN/);
    expect(messages([product({ variants: [{ shopSku: "KK-1", supplierOffers: ["ohne-trenner"], mpn: "X-1" }] })])).toMatch(/supplierOffers/);
    expect(validateCatalog([product({ variants: [{ shopSku: "KK-1", supplierOffers: ["lieferant::A-1"], mpn: "X-1" }] })], NOW).products).toHaveLength(1);
    expect(validateCatalog([product({ variants: [{ shopSku: "KK-1", supplierOffers: ["lieferant::A-1"], label: "weiß 2 m" }] })], NOW).products).toHaveLength(1);
  });

  it("prüft Verkaufspreis, Prüfdatum (nicht nach now) und Bilder mit Nutzungsrechten", () => {
    const sp = product().salePrice;
    expect(messages([product({ salePrice: { ...sp, gross: 0 } })])).toMatch(/gross/);
    expect(messages([product({ salePrice: { ...sp, gross: Number.NaN } })])).toMatch(/gross/);
    expect(messages([product({ salePrice: { ...sp, checkedAt: "2026-11-01" } })])).toMatch(/Zukunft/);
    expect(messages([product({ salePrice: { ...sp, checkedAt: "2026-02-31" } })])).toMatch(/checkedAt/);
    expect(validateCatalog([product({ salePrice: { ...sp, checkedAt: "2026-10-31T11:00:00Z" } })], NOW).products).toHaveLength(1);
    const l = product().listing;
    expect(messages([product({ listing: { ...l, images: [{ url: "https://bilder.example/a.jpg", alt: "A", rightsReference: "" }] } })])).toMatch(/rightsReference/);
    expect(messages([product({ listing: { ...l, images: [{ url: "http://bilder.example/a.jpg", alt: "A", rightsReference: "Lizenz" }] } })])).toMatch(/https/);
  });

  it("verlangt bei mehreren Varianten Optionsname und eindeutige Optionswerte", () => {
    const variants = [
      { shopSku: "KK-W", gtin: gtin("401234500001"), optionValue: "Weiß" },
      { shopSku: "KK-S", gtin: gtin("401234500002"), optionValue: "Schwarz" },
    ];
    expect(messages([product({ variants })])).toMatch(/listing\.option/);
    expect(messages([product({ variants: variants.map((v) => ({ ...v, optionValue: "Weiß" })), listing: { ...product().listing, option: "Farbe" } })])).toMatch(/doppelt/);
    expect(validateCatalog([product({ variants, listing: { ...product().listing, option: "Farbe" } })], NOW).products).toHaveLength(1);
  });
});

describe("Zielproduktkatalog: Abfragen je Variante", () => {
  it("erzeugt je Variante eine Kundenbestellungs-Abfrage mit Schlüssel und Dokumenttypen", () => {
    const p = product({
      requiredDocTypes: ["gpsr"],
      listing: { ...product().listing, option: "Farbe" },
      variants: [
        { shopSku: "KK-W", gtin: gtin("401234500001"), optionValue: "Weiß" },
        { shopSku: "KK-S", supplierOffers: ["lieferant::KK-S"], label: "schwarz", optionValue: "Schwarz" },
      ],
    });
    const queries = catalogVariantQueries(p);
    expect(queries.map((q) => q.query)).toEqual([
      expect.objectContaining({ productId: "catalog:kabelkanal-weiss", productKey: "cat:kabelkanal-weiss:KK-W", gtin: gtin("401234500001"), quantity: 1, destinationCountry: "DE", requiredDocTypes: ["gpsr"] }),
      expect.objectContaining({ productKey: "cat:kabelkanal-weiss:KK-S", variantLabel: "schwarz", title: "Kabelkanal selbstklebend – Schwarz" }),
    ]);
    expect(queries[1].query.gtin).toBeUndefined();
  });
});

describe("Zielproduktkatalog: lesender Speicher", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("liefert ohne Datei einen leeren Katalog ohne Fehler, sonst Prüfergebnis und Prüfsumme", () => {
    dir = mkdtempSync(join(tmpdir(), "katalog-"));
    const file = join(dir, "products.json");
    expect(loadCatalog(NOW, file)).toEqual({ products: [], invalid: [], sha256: null });
    writeFileSync(file, JSON.stringify({ products: [product()] }));
    const loaded = loadCatalog(NOW, file);
    expect(loaded.products).toHaveLength(1);
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(file, "{ kaputt");
    expect(loadCatalog(NOW, file)).toMatchObject({ products: [], error: expect.stringMatching(/JSON/) });
  });
});
