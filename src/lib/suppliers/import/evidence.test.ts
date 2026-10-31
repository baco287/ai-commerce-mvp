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
