import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_QUERIES } from "../demo/demo-suppliers";
import { applyImportPlan, confirmationCodeFor, planImport } from "./plan";
import { supplierIdOf } from "./records";
import { emptyOfferStore, type OfferStore } from "./types";

const FIXTURES = join(__dirname, "fixtures");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const KNOWN = new Map(Object.values(DEMO_QUERIES).map((q) => [q.gtin, q.productId] as const));
const SUPPLIER = "musterhandel-test-gmbh-synthetisch";

function plan(file: string, store: OfferStore = emptyOfferStore(), extra: { mapping?: object; at?: string } = {}) {
  return planImport({
    text: read(file),
    file,
    mapping: extra.mapping,
    synthetic: true,
    importId: `imp-${extra.at ?? "1"}`,
    importedAt: extra.at ?? "2026-10-31T10:00:00.000Z",
    knownGtins: KNOWN,
    store,
  });
}

describe("Preislisten-Import: Prüfung im Testlauf", () => {
  it("ordnet deutsche Spalten zu und lehnt fehlerhafte Zeilen mit Gründen ab", () => {
    const p = plan("preisliste-de.synthetisch.csv");
    expect(p.structureErrors).toEqual([]);
    expect(p.counts).toMatchObject({ rows: 11, valid: 4, rejected: 6, duplicates: 1, new: 4 });
    const reasons = Object.fromEntries(p.rows.filter((r) => r.status === "rejected").map((r) => [r.line, r.errors.join(" ")]));
    expect(reasons[5]).toMatch(/Einkaufspreis netto: „abc“ ist kein Betrag/);
    expect(reasons[6]).toMatch(/Währung „USD“ nicht unterstützt/);
    expect(reasons[8]).toMatch(/ungültige Prüfziffer/);
    expect(reasons[10]).toMatch(/Widersprüchliche Dublette/);
    expect(reasons[11]).toMatch(/Widersprüchliche Dublette/);
    expect(reasons[12]).toMatch(/mehrdeutig/);
  });

  it("erkennt identische Dubletten und übernimmt sie nur einmal", () => {
    const p = plan("preisliste-de.synthetisch.csv");
    expect(p.duplicates).toEqual(
      expect.arrayContaining([
        { key: `${SUPPLIER}::MT-LED-01`, lines: [2, 9], identical: true },
        { key: `${SUPPLIER}::MT-BAND-01`, lines: [10, 11], identical: false },
      ]),
    );
    expect(p.newOffers.filter((k) => k.endsWith("MT-LED-01"))).toHaveLength(1);
  });

  it("speichert unbekannte GTINs, ordnet sie aber keinem Produkt zu", () => {
    const p = plan("preisliste-de.synthetisch.csv");
    expect(p.unknownGtin).toEqual([`${SUPPLIER}::MT-UNKNOWN-01`]);
    expect(p.productByKey[`${SUPPLIER}::MT-UNKNOWN-01`]).toBeNull();
    expect(p.productByKey[`${SUPPLIER}::MT-LED-01`]).toBe("p-led");
  });

  it("übernimmt fehlende Angaben als fehlend – nichts wird erfunden", () => {
    const bottle = plan("preisliste-de.synthetisch.csv").rows.find((r) => r.key?.endsWith("MT-BOTTLE-01"))!;
    expect(bottle.data).not.toHaveProperty("shippingCostDe");
    expect(bottle.data).not.toHaveProperty("dropshipping");
    expect(bottle.data).not.toHaveProperty("paymentTerms");
    expect(bottle.warnings.join(" ")).toMatch(/Keine Angabe .*Versandkosten nach Deutschland.*Dropshipping.*Zahlungsbedingungen/);
  });

  it("liest englische Listen mit Komma, Anführungszeichen und Min/Max-Lieferzeit", () => {
    const p = plan("preisliste-en.synthetisch.csv");
    expect(p.counts).toMatchObject({ valid: 2, rejected: 0 });
    const led = p.rows[0].data!;
    expect(led).toMatchObject({ title: "LED strip 5 m, app controlled", unitPrice: 8.75, deliveryDays: { min: 4, max: 6 }, paymentTerms: { kind: "net_terms", days: 30 } });
  });

  it("nutzt eine Zuordnungsdatei für abweichende Spalten und feste Angaben", () => {
    const mapping = JSON.parse(read("zuordnung-abweichend.json"));
    const p = plan("preisliste-abweichend.synthetisch.csv", emptyOfferStore(), { mapping });
    expect(p.structureErrors).toEqual([]);
    expect(p.rows[0].data).toMatchObject({ supplierName: "Alpenhandel Test (synthetisch)", supplierSku: "AB-100", unitPrice: 5.6, currency: "EUR", shipsFrom: "AT", stock: 150 });
    // ohne Zuordnung fehlen Pflichtspalten
    expect(plan("preisliste-abweichend.synthetisch.csv").structureErrors.join(" ")).toMatch(/Pflichtspalte fehlt/);
  });

  it("verweigert Dateien mit fehlenden Pflichtspalten", () => {
    const p = plan("kaputt.synthetisch.csv");
    expect(p.canApply).toBe(false);
    expect(p.structureErrors).toEqual(expect.arrayContaining(["Pflichtspalte fehlt: Einkaufspreis netto.", "Pflichtspalte fehlt: Währung."]));
    expect(() => applyImportPlan(p, emptyOfferStore())).toThrow(/nicht übernommen/);
  });
});

describe("Preislisten-Import: Übernahme ohne Datenverlust", () => {
  const first = () => applyImportPlan(plan("preisliste-de.synthetisch.csv"), emptyOfferStore());

  it("speichert die Herkunft jedes Angebots", () => {
    const led = first().offers[`${SUPPLIER}::MT-LED-01`];
    expect(led.provenance).toMatchObject({ file: "preisliste-de.synthetisch.csv", row: 2, importId: "imp-1", synthetic: true });
    expect(led.provenance.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(led.data).toMatchObject({ dataSource: "Händlerportal (synthetisch)", supplierUpdatedAt: "2026-10-28" });
  });

  it("erkennt beim Folgeimport Änderungen, behält alte Fassungen und löscht nichts", () => {
    const store = first();
    const p = plan("preisliste-update.synthetisch.csv", store, { at: "2026-11-01T10:00:00.000Z" });
    expect(p.changed.map((c) => [c.key, c.changes.map((x) => x.field)])).toEqual([
      [`${SUPPLIER}::MT-LED-01`, ["stock", "supplierUpdatedAt", "unitPrice"]],
    ]);
    expect(p.unchanged).toEqual([`${SUPPLIER}::MT-STAND-01`]);
    expect(p.notInFile.sort()).toEqual([`${SUPPLIER}::MT-BOTTLE-01`, `${SUPPLIER}::MT-UNKNOWN-01`]);

    const next = applyImportPlan(p, store);
    expect(Object.keys(next.offers).sort()).toEqual(Object.keys(store.offers).sort());
    const led = next.offers[`${SUPPLIER}::MT-LED-01`];
    expect(led.data.unitPrice).toBe(8.95);
    expect(led.history).toHaveLength(1);
    expect(led.history[0].data.unitPrice).toBe(9.1);
    expect(next.offers[`${SUPPLIER}::MT-BOTTLE-01`]).toEqual(store.offers[`${SUPPLIER}::MT-BOTTLE-01`]);
    expect(next.imports).toHaveLength(2);
    // alter Speicherstand bleibt unverändert (keine Seiteneffekte)
    expect(store.offers[`${SUPPLIER}::MT-LED-01`].data.unitPrice).toBe(9.1);
  });

  it("legt bei erneutem Import derselben Datei keine Dubletten an", () => {
    const store = first();
    const again = plan("preisliste-de.synthetisch.csv", store, { at: "2026-11-01T10:00:00.000Z" });
    expect(again.counts).toMatchObject({ new: 0, changed: 0, unchanged: 4 });
    expect(Object.keys(applyImportPlan(again, store).offers)).toHaveLength(4);
  });

  it("bindet den Bestätigungscode an Datei, Zuordnung und Speicherstand", () => {
    const p = plan("preisliste-de.synthetisch.csv");
    const base = { fileSha256: p.fileSha256, mapping: {}, synthetic: true, store: emptyOfferStore() };
    expect(confirmationCodeFor(base)).toBe(p.confirmationCode);
    expect(confirmationCodeFor({ ...base, store: first() })).not.toBe(p.confirmationCode);
    expect(confirmationCodeFor({ ...base, mapping: { defaults: { currency: "EUR" } } })).not.toBe(p.confirmationCode);
    expect(confirmationCodeFor({ ...base, synthetic: false })).not.toBe(p.confirmationCode);
    expect(plan("preisliste-update.synthetisch.csv").confirmationCode).not.toBe(p.confirmationCode);
  });
});

describe("Preislisten-Import: Befunde aus dem Review", () => {
  it("meldet eine geänderte Testdaten-Markierung als Änderung und übernimmt sie", () => {
    const store = applyImportPlan(plan("preisliste-de.synthetisch.csv"), emptyOfferStore());
    const asReal = planImport({
      text: read("preisliste-de.synthetisch.csv"),
      file: "preisliste-de.csv",
      synthetic: false,
      importId: "imp-2",
      importedAt: "2026-11-01T10:00:00.000Z",
      knownGtins: KNOWN,
      store,
    });
    expect(asReal.counts).toMatchObject({ changed: 4, unchanged: 0 });
    expect(asReal.changed[0].changes).toEqual([{ field: "synthetic", label: "Testdaten-Markierung", before: true, after: false }]);
    const next = applyImportPlan(asReal, store);
    expect(next.offers[`${SUPPLIER}::MT-LED-01`].provenance).toMatchObject({ synthetic: false, file: "preisliste-de.csv" });
    expect(next.offers[`${SUPPLIER}::MT-LED-01`].history).toHaveLength(1);
  });

  it("verweigert Dateien, die nicht in UTF-8 gespeichert sind", () => {
    const latin1 = Buffer.from("Lieferant;Artikelnummer;Bezeichnung;EK netto;Währung\nM\xfcller GmbH;A1;Flasche;5,00;EUR\n", "latin1").toString("utf8");
    const p = planImport({ text: latin1, file: "x.csv", synthetic: true, importId: "i", importedAt: "2026-10-31T10:00:00.000Z", knownGtins: KNOWN, store: emptyOfferStore() });
    expect(p.canApply).toBe(false);
    expect(p.structureErrors[0]).toMatch(/nicht in UTF-8/);
  });

  it("vergibt verschiedenen Lieferanten nie dieselbe Kennung", () => {
    expect(supplierIdOf("Müller GmbH")).toBe("mueller-gmbh");
    expect(supplierIdOf("Müller GmbH")).toBe("mueller-gmbh");
    expect(supplierIdOf("Łódź Handel")).toBe("lodz-handel");
    expect(supplierIdOf("Musterhandel Test GmbH (synthetisch)")).toBe(SUPPLIER);
    expect(supplierIdOf("A&B Handel")).not.toBe(supplierIdOf("A+B Handel"));
    expect(supplierIdOf("深圳 Electronics Co")).not.toBe(supplierIdOf("广州 Electronics Co"));
    expect(supplierIdOf("深圳 Electronics Co")).toMatch(/^electronics-co-[0-9a-f]{6}$/);
  });
});
