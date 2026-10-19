import { describe, expect, it } from "vitest";
import { demandScore } from "./demand";
import { calculateMargin, landedCost } from "./pricing";
import { evaluateOffers } from "./suppliers";
import type { SupplierOffer } from "@/lib/types";

const offer = (o: Partial<SupplierOffer>): SupplierOffer => ({
  id: "x",
  productId: "p",
  supplierName: "Test",
  region: "EU",
  warehouse: "Lager",
  unitPrice: 10,
  shippingCost: 3,
  importCost: 0,
  deliveryDaysMin: 3,
  deliveryDaysMax: 6,
  rating: 4.5,
  stock: 500,
  paymentTerms: "vorkasse",
  ...o,
});

describe("demandScore", () => {
  it("gewichtet Signale und invertiert den Wettbewerb", () => {
    expect(demandScore({ searchTrend: 100, socialBuzz: 100, competition: 0, seasonality: 100 })).toBe(100);
    expect(demandScore({ searchTrend: 0, socialBuzz: 0, competition: 100, seasonality: 0 })).toBe(0);
    expect(demandScore({ searchTrend: 78, socialBuzz: 70, competition: 55, seasonality: 80 })).toBe(68);
  });

  it("begrenzt Werte außerhalb von 0–100", () => {
    expect(demandScore({ searchTrend: 500, socialBuzz: -20, competition: 0, seasonality: 0 })).toBe(60);
  });
});

describe("Preis- und Margenrechnung", () => {
  it("summiert Einkauf, Versand und Importkosten", () => {
    expect(landedCost({ unitPrice: 9.8, shippingCost: 4.9, importCost: 1.2 })).toBe(15.9);
  });

  it("zieht MwSt., Gebühren, Werbung und Retourenreserve ab", () => {
    const m = calculateMargin(24.9, 8.5);
    expect(m.priceNet).toBe(20.92);
    expect(m.vat).toBe(3.98);
    expect(m.paymentFee).toBe(1.02);
    expect(m.returnsReserve).toBe(0.63);
    expect(m.contribution).toBeCloseTo(4.77, 2);
    expect(m.marginPercent).toBeCloseTo(0.228, 3);
  });

  it("kann negative Deckungsbeiträge ausweisen", () => {
    expect(calculateMargin(12.9, 4.4).contribution).toBeLessThan(0);
  });
});

describe("Lieferantenvergleich", () => {
  it("markiert das günstigste GEEIGNETE Angebot, nicht das billigste", () => {
    const result = evaluateOffers([
      offer({ id: "billig-aber-langsam", unitPrice: 2, deliveryDaysMax: 20 }),
      offer({ id: "geeignet-teurer", unitPrice: 9 }),
      offer({ id: "geeignet-guenstig", unitPrice: 8 }),
    ]);
    expect(result[0].offer.id).toBe("billig-aber-langsam");
    expect(result[0].eligible).toBe(false);
    expect(result.find((r) => r.isBest)?.offer.id).toBe("geeignet-guenstig");
    expect(result.filter((r) => r.isBest)).toHaveLength(1);
  });

  it("nennt alle Gründe für fehlende Eignung", () => {
    const [r] = evaluateOffers([offer({ rating: 3.9, stock: 10, deliveryDaysMax: 15 })]);
    expect(r.eligible).toBe(false);
    expect(r.issues).toHaveLength(3);
    expect(r.isBest).toBe(false);
  });
});
