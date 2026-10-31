import { describe, expect, it } from "vitest";
import { validateEvidence } from "./evidence";

const entry = (checkedAt: string) => ({
  offerKey: "lieferant::A1",
  productGtin: "2000000000022",
  field: "safety.ceMarking",
  value: true,
  document: "EU-Konformitätserklärung Nr. 1",
  checkedBy: "Prüfer Test",
  checkedAt,
});

describe("Nachweisdatei", () => {
  const today = new Date("2026-10-31T12:00:00.000Z");

  it("akzeptiert nur echte, nicht in der Zukunft liegende Prüfdaten", () => {
    const { entries, errors } = validateEvidence({ entries: [entry("2026-10-31"), entry("2026-02-31"), entry("2099-12-31"), entry("31.10.2026")] }, today);
    expect(entries.map((e) => e.checkedAt)).toEqual(["2026-10-31"]);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/Nachweis 2: .*checkedAt/);
  });

  it("verwirft unbekannte Felder und unpassende Werte mit Grund", () => {
    const { entries, errors } = validateEvidence(
      { entries: [{ ...entry("2026-10-30"), field: "safety.irgendwas" }, { ...entry("2026-10-30"), field: "fulfillment.shipsFrom", value: "Deutschland" }] },
      today,
    );
    expect(entries).toEqual([]);
    expect(errors.join(" ")).toMatch(/nicht nachweisbar/);
    expect(errors.join(" ")).toMatch(/Wert passt nicht zu fulfillment\.shipsFrom/);
  });
});

describe("Nachweisdatei: Paket B – neue Felder, Varianten-Schlüssel, Dokumenttyp", () => {
  const today = new Date("2026-10-31T12:00:00.000Z");
  const base = { offerKey: "lieferant::A1", document: "Vertrag Nr. 1", checkedBy: "Prüfer Test", checkedAt: "2026-10-30" };

  it("verlangt genau einen Produktbezug: productGtin ODER productKey", () => {
    const { entries, errors } = validateEvidence(
      {
        entries: [
          { ...base, productKey: "cat:kabelkanal:KK-1", field: "identity.match", value: "exact" },
          { ...base, productGtin: "2000000000022", productKey: "cat:x:Y", field: "identity.match", value: "exact" },
          { ...base, field: "identity.match", value: "exact" },
        ],
      },
      today,
    );
    expect(entries).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors.join(" ")).toMatch(/genau eines von productGtin oder productKey/);
  });

  it("prüft die neuen Felder Marke, Mindestbestellmenge, Kreditrahmen und Retourenabwicklung", () => {
    const e = (field: string, value: unknown) => ({ ...base, productGtin: "2000000000022", field, value });
    const { entries, errors } = validateEvidence(
      {
        entries: [
          e("identity.brand", "Kabelwerk"),
          e("pricing.minOrderQuantity", 1),
          e("payment.creditLimit", 250),
          e("dropshipping.returnsHandledBy", "supplier"),
          e("pricing.minOrderQuantity", 1.5),
          e("payment.creditLimit", -1),
          e("dropshipping.returnsHandledBy", "lieferant"),
          e("identity.brand", ""),
        ],
      },
      today,
    );
    expect(entries.map((x) => x.field)).toEqual(["identity.brand", "pricing.minOrderQuantity", "payment.creditLimit", "dropshipping.returnsHandledBy"]);
    expect(errors).toHaveLength(4);
  });

  it("lehnt Unterlagen ohne gültigen Dokumenttyp ab und erlaubt docType nur bei Unterlagen", () => {
    const doc = { ...base, productGtin: "2000000000022", field: "safety.document", value: "Konformitätserklärung Nr. 5" };
    const { entries, errors } = validateEvidence(
      {
        entries: [
          { ...doc, docType: "eu_doc" },
          doc,
          { ...doc, docType: "ce" },
          { ...base, productGtin: "2000000000022", field: "safety.ceMarking", value: true, docType: "eu_doc" },
        ],
      },
      today,
    );
    expect(entries).toHaveLength(1);
    expect(errors.join(" ")).toMatch(/docType fehlt oder unbekannt/);
    expect(errors.join(" ")).toMatch(/docType ist nur bei safety\.document zulässig/);
  });
});
