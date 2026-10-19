import { describe, expect, it } from "vitest";
import { evaluateAutoPurchase, type PurchaseContext } from "./purchase";

const ctx = (c: Partial<PurchaseContext> = {}): PurchaseContext => ({
  paymentStatus: "captured",
  supplierCost: 7.1,
  supplierPaymentTerms: "netto14",
  creditLineAvailable: 0,
  expectedContribution: 6,
  ...c,
});
const enabled = { autoPurchaseEnabled: true, maxAutoPurchasePerOrder: 40, payoutDelayDays: 7 };

describe("evaluateAutoPurchase", () => {
  it("blockiert im MVP immer, weil der Sicherheitsschalter aus ist", () => {
    const d = evaluateAutoPurchase(ctx());
    expect(d.allowed).toBe(false);
    expect(d.reasons[0]).toMatch(/global deaktiviert/);
  });

  it("erlaubt nur bei erfasster Zahlung und gesicherter Finanzierung", () => {
    expect(evaluateAutoPurchase(ctx(), enabled).allowed).toBe(true);
  });

  it("blockiert bei nicht erfasster Kundenzahlung", () => {
    for (const paymentStatus of ["pending", "authorized"] as const) {
      const d = evaluateAutoPurchase(ctx({ paymentStatus }), enabled);
      expect(d.allowed).toBe(false);
      expect(d.reasons.join(" ")).toMatch(/nicht erfasst/);
    }
  });

  it("blockiert Vorkasse-Lieferanten, solange die Auszahlung aussteht und kein Rahmen da ist", () => {
    const d = evaluateAutoPurchase(ctx({ supplierPaymentTerms: "vorkasse" }), enabled);
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(" ")).toMatch(/Finanzierung nicht gesichert/);
  });

  it("akzeptiert Vorkasse, wenn das Geld ausgezahlt ist oder ein Finanzierungsrahmen reicht", () => {
    expect(evaluateAutoPurchase(ctx({ supplierPaymentTerms: "vorkasse", paymentStatus: "paid_out" }), enabled).allowed).toBe(true);
    expect(evaluateAutoPurchase(ctx({ supplierPaymentTerms: "vorkasse", creditLineAvailable: 50 }), enabled).allowed).toBe(true);
  });

  it("blockiert über dem Einkaufslimit und bei negativem Deckungsbeitrag", () => {
    expect(evaluateAutoPurchase(ctx({ supplierCost: 41 }), enabled).allowed).toBe(false);
    expect(evaluateAutoPurchase(ctx({ expectedContribution: -0.5 }), enabled).allowed).toBe(false);
  });
});
