import { describe, expect, it } from "vitest";
import { evaluateAutoPurchase, type PurchaseGuardConfig } from "@/lib/guards/purchase";
import { assessFinancing } from "./financing";
import { missing, unconfirmed, type PaymentConditions } from "./model";
import { toPurchaseGuardTerms } from "./purchase-bridge";
import { buildQuote, ok } from "./quote-builder";

const said = <T>(v: T) => unconfirmed(v, "Selbstauskunft");
const terms = (payment: Partial<PaymentConditions>) => toPurchaseGuardTerms(assessFinancing(buildQuote({ id: "q", supplierName: "Test", payment })));

describe("Umrechnung für die Einkaufssperre", () => {
  it("rundet bestätigte Zahlungsziele auf die nächstkleinere Stufe ab", () => {
    expect(terms({ terms: ok({ kind: "net_terms", days: 45 }) })).toBe("netto30");
    expect(terms({ terms: ok({ kind: "net_terms", days: 30 }) })).toBe("netto30");
    expect(terms({ terms: ok({ kind: "net_terms", days: 21 }) })).toBe("netto14");
    expect(terms({ terms: ok({ kind: "net_terms", days: 10 }) })).toBe("vorkasse");
    expect(terms({ terms: ok({ kind: "net_terms", days: 5 }) })).toBe("vorkasse");
  });

  it("gibt bei Vorkasse oder unsicherem Zahlungsziel immer Vorkasse weiter", () => {
    expect(terms({ terms: ok({ kind: "prepayment" }) })).toBe("vorkasse");
    expect(terms({ terms: said({ kind: "net_terms", days: 30 }) })).toBe("vorkasse");
    expect(terms({ terms: missing() })).toBe("vorkasse");
    expect(terms({ terms: ok({ kind: "net_terms", days: 30 }), requiresBusinessVerification: ok(true) })).toBe("vorkasse");
    expect(terms({ terms: ok({ kind: "net_terms", days: 30 }), requiresBusinessVerification: said(true) })).toBe("vorkasse");
  });

  it("führt bei unbestätigtem Zahlungsziel in der Einkaufssperre zu „Finanzierung nicht gesichert“", () => {
    // Sicherheitsschalter hier nur im Test simuliert, um die Finanzierungsregel isoliert zu prüfen.
    const config: PurchaseGuardConfig = { autoPurchaseEnabled: true, maxAutoPurchasePerOrder: 40, payoutDelayDays: 7 };
    const decide = (payment: Partial<PaymentConditions>) =>
      evaluateAutoPurchase(
        { paymentStatus: "captured", supplierCost: 15, supplierPaymentTerms: terms(payment), creditLineAvailable: 0, expectedContribution: 5 },
        config,
      );

    const claimed = decide({ terms: said({ kind: "net_terms", days: 30 }) });
    expect(claimed.allowed).toBe(false);
    expect(claimed.reasons.join(" ")).toMatch(/Finanzierung nicht gesichert/);

    expect(decide({ terms: ok({ kind: "net_terms", days: 30 }) })).toEqual({ allowed: true, reasons: [] });
  });
});
