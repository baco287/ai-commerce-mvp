import { describe, expect, it } from "vitest";
import { resolveColumns } from "./columns";
import { parseCsv } from "./csv";
import { readRows } from "./records";
import { parseBool, parseCount, parseCountry, parseDate, parseDeliveryDays, parseGtin, parseMoney, parsePaymentTerms } from "./values";

const ok = <T>(r: { value: T } | { error: string }) => ("value" in r ? r.value : `FEHLER: ${r.error}`);
const isError = (r: object) => "error" in r;

describe("Werteprüfung für Preislisten", () => {
  it("liest Beträge in deutschem und englischem Format und lehnt Mehrdeutiges ab", () => {
    expect(ok(parseMoney("12,50"))).toBe(12.5);
    expect(ok(parseMoney("12.50"))).toBe(12.5);
    expect(ok(parseMoney("1.234,50 €"))).toBe(1234.5);
    expect(ok(parseMoney("1,234.50"))).toBe(1234.5);
    expect(ok(parseMoney("EUR 3"))).toBe(3);
    for (const bad of ["abc", "12,500", "1.234", "12,3,4", "1.2.3,4", "12,12345", "", "12€50", "12 EUR 50", "1234.567.890", ".123.456", "1.23.456"]) expect(isError(parseMoney(bad)), bad).toBe(true);
    expect(ok(parseMoney("12,50EUR"))).toBe(12.5);
  });

  it("akzeptiert jeden Cent-Betrag von 0,01 bis 999,99 exakt (keine Gleitkomma-Fehler)", () => {
    for (let cents = 1; cents < 100000; cents++) {
      const text = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
      const r = parseMoney(text);
      if (!("value" in r) || Math.round(r.value * 100) !== cents) throw new Error(`${text} → ${JSON.stringify(r)}`);
    }
    expect(ok(parseMoney("19,99"))).toBe(19.99);
    expect(ok(parseMoney("0,0725"))).toBe(0.0725);
  });

  it("liest Mengen, Ja/Nein und Lieferzeiten streng", () => {
    expect(ok(parseCount("1.200"))).toBe(1200);
    expect(ok(parseCount("50 Stk."))).toBe(50);
    expect(isError(parseCount("-3"))).toBe(true);
    expect(isError(parseCount("viele"))).toBe(true);
    expect(ok(parseBool("Ja"))).toBe(true);
    expect(ok(parseBool("no"))).toBe(false);
    expect(isError(parseBool("vielleicht"))).toBe(true);
    expect(ok(parseDeliveryDays("3-5"))).toEqual({ min: 3, max: 5 });
    expect(ok(parseDeliveryDays("3 bis 5 Werktage"))).toEqual({ min: 3, max: 5 });
    expect(ok(parseDeliveryDays("4 Tage"))).toEqual({ min: 4, max: 4 });
    expect(isError(parseDeliveryDays("5-3"))).toBe(true);
    expect(isError(parseDeliveryDays("bald"))).toBe(true);
  });

  it("erkennt Zahlungsbedingungen – Rechnung ohne Tage bleibt unvollständig", () => {
    expect(ok(parsePaymentTerms("Vorkasse"))).toEqual({ kind: "prepayment" });
    expect(ok(parsePaymentTerms("prepayment"))).toEqual({ kind: "prepayment" });
    expect(ok(parsePaymentTerms("Rechnung 30 Tage"))).toEqual({ kind: "net_terms", days: 30 });
    expect(ok(parsePaymentTerms("netto 14"))).toEqual({ kind: "net_terms", days: 14 });
    expect(ok(parsePaymentTerms("net 30"))).toEqual({ kind: "net_terms", days: 30 });
    expect(ok(parsePaymentTerms("30 Tage netto"))).toEqual({ kind: "net_terms", days: 30 });
    expect(ok(parsePaymentTerms("Zahlungsziel 30 Tage"))).toEqual({ kind: "net_terms", days: 30 });
    expect(ok(parsePaymentTerms("Kauf auf Rechnung, 14 Tage"))).toEqual({ kind: "net_terms", days: 14 });
    expect(isError(parsePaymentTerms("Rechnung"))).toBe(true);
    expect(isError(parsePaymentTerms("nach Absprache"))).toBe(true);
    // Zusätze und Bedingungen werden nicht geraten
    for (const bad of [
      "Vorkasse 14 Tage",
      "Vorkasse, Versand 3 Tage nach Zahlungseingang",
      "Vorkasse, ab 2. Bestellung 30 Tage netto",
      "PayPal, Lieferung 2 Tage",
      "Rechnung nach Bonitätsprüfung 30 Tage",
      "Vorkasse oder Rechnung (net 30 nach Freigabe)",
      "2% Skonto 10 Tage, 30 Tage netto",
      "30 Tage",
    ]) {
      expect(isError(parsePaymentTerms(bad)), bad).toBe(true);
    }
  });

  it("prüft Datum, Land und GTIN-Prüfziffer", () => {
    expect(ok(parseDate("31.10.2026"))).toBe("2026-10-31");
    expect(ok(parseDate("2026-10-31"))).toBe("2026-10-31");
    expect(isError(parseDate("31.02.2026"))).toBe(true);
    expect(isError(parseDate("2026-10-31xyz"))).toBe(true);
    expect(isError(parseDate("2026-10-31 bis 2026-12-31"))).toBe(true);
    expect(ok(parseCountry("Deutschland"))).toBe("DE");
    expect(ok(parseCountry("pl"))).toBe("PL");
    expect(ok(parseCountry("CN"))).toBe("CN");
    expect(isError(parseCountry("Atlantis"))).toBe(true);
    expect(ok(parseGtin("2000000000015"))).toBe("2000000000015");
    expect(isError(parseGtin("2000000000016"))).toBe(true);
    expect(isError(parseGtin("12345"))).toBe(true);
  });
});

describe("CSV-Parser", () => {
  it("erkennt Trennzeichen, Anführungszeichen, BOM und CRLF", () => {
    const t = parseCsv('﻿a;b;c\r\n1;"x;y";3\r\n\r\n4;"mit ""Zitat""";6\r\n');
    expect(t.delimiter).toBe(";");
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ["1", "x;y", "3"],
      ["4", 'mit "Zitat"', "6"],
    ]);
    expect(t.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(parseCsv("a,b\n1,2").delimiter).toBe(",");
    expect(parseCsv('a;b\n1;"offen').errors[0]).toMatch(/nicht geschlossen/);
    // Text nach schließendem oder einzelnes Anführungszeichen ist ein Strukturfehler – nie „"1"7“ → 17
    expect(parseCsv('a;b;c\nA;"1"7;"9"50').errors[0]).toMatch(/Zeile 2: Anführungszeichen fehlerhaft/);
    expect(parseCsv('a;b\nx;ab"c').errors[0]).toMatch(/Zeile 2/);
    expect(parseCsv('a;b\n"x" ;"y"').errors).toEqual([]);
  });
});

describe("Spaltenzuordnung", () => {
  it("liest Einheiten in Spaltenköpfen nie still um", async () => {
    const { resolveColumns } = await import("./columns");
    const base = ["Lieferant", "Artikelnummer", "Bezeichnung", "Währung"];
    const ok = resolveColumns([...base, "EK netto (EUR)", "Lieferzeit (Tage)", "Bestand (Stk.)"]);
    expect(ok.errors).toEqual([]);
    expect(Object.keys(ok.index)).toEqual(expect.arrayContaining(["unitPrice", "deliveryDays", "stock"]));

    const units = resolveColumns([...base, "Einkaufspreis (brutto)", "Lieferzeit (Wochen)", "MOQ (Kartons)", "Versandkosten (pro Bestellung)"]);
    expect(units.index).not.toHaveProperty("deliveryDays");
    expect(units.index).not.toHaveProperty("minOrderQuantity");
    expect(units.index).not.toHaveProperty("shippingCostDe");
    expect(units.errors).toContain("Pflichtspalte fehlt: Einkaufspreis netto.");
    expect(units.notices.join(" ")).toMatch(/Lieferzeit \(Wochen\).*ignoriert/);
    expect(units.notices.join(" ")).toMatch(/MOQ \(Kartons\)/);

    const wrongUnit = resolveColumns([...base, "EK netto", "MOQ (EUR)", "Mindestbestellwert (Stk.)", "Bestand (EUR)", "Lieferzeit (EUR)"]);
    expect(Object.keys(wrongUnit.index)).not.toEqual(expect.arrayContaining(["minOrderQuantity"]));
    for (const f of ["minOrderQuantity", "minOrderValue", "stock", "deliveryDays"]) expect(wrongUnit.index).not.toHaveProperty(f);
    expect(wrongUnit.notices).toHaveLength(4);

    // Umlaute in zerlegter Form (NFD, z. B. aus macOS-Exporten)
    expect(resolveColumns(["Lieferant", "Artikelnummer", "Bezeichnung", "EK netto", "Währung"]).errors).toEqual([]);
  });
});

describe("Preislisten: optionale Spalte Variantenkennung (Paket B)", () => {
  it("erkennt „Variante“ als Variantenkennung und übernimmt sie (höchstens 60 Zeichen)", () => {
    const table = parseCsv("Lieferant;Artikelnummer;Bezeichnung;EK netto;Währung;Variante\nBeispiel;A1;Kabelkanal;4,00;EUR;Schwarz / 2 m\nBeispiel;A2;Kabelkanal;4,00;EUR;" + "x".repeat(61));
    const cols = resolveColumns(table.headers);
    expect(cols.errors).toEqual([]);
    expect(cols.index.variantLabel).toBe(5);
    const rows = readRows(table, cols, {}, "2026-10-31T10:00:00.000Z");
    expect(rows[0].data?.variantLabel).toBe("Schwarz / 2 m");
    expect(rows[1].status).toBe("rejected");
  });
});
