import { describe, expect, it } from "vitest";
import { evaluateAutoPurchase, type PurchaseGuardConfig } from "@/lib/guards/purchase";
import type { PaymentTerms } from "@/lib/types";
import { evaluateQuote } from "./compare";
import { missing, unconfirmed, type PaymentConditions, type ProductQuery } from "./model";
import { toPurchaseGuardTerms } from "./purchase-bridge";
import { buildQuote, ok, type QuoteOverrides } from "./quote-builder";

const query: ProductQuery = {
  productId: "p-test",
  title: "Testprodukt",
  gtin: "2000000000015",
  quantity: 1,
  destinationCountry: "DE",
  safety: { ceRequired: true },
};

const said = <T>(v: T) => unconfirmed(v, "Selbstauskunft");
/** Echtes (nicht Demo-)Angebot, sonst in allen Punkten bestätigt und geeignet. */
const real = (o: Partial<QuoteOverrides> = {}) => buildQuote({ id: "q", supplierName: "Test", demo: false, ...o });
const terms = (o: Partial<QuoteOverrides>) => toPurchaseGuardTerms(evaluateQuote(real(o), query));
const pay = (payment: Partial<PaymentConditions>) => terms({ payment });

// Sicherheitsschalter hier nur im Test simuliert, um die Finanzierungsregel der Einkaufssperre isoliert zu prüfen.
// Der globale Schalter SAFETY_SWITCHES.autoPurchaseEnabled bleibt unverändert aus (siehe guards/safety.test.ts).
const SWITCH_ON_FOR_TEST: PurchaseGuardConfig = { autoPurchaseEnabled: true, maxAutoPurchasePerOrder: 40, payoutDelayDays: 7 };
const guard = (supplierPaymentTerms: PaymentTerms, config?: PurchaseGuardConfig) =>
  evaluateAutoPurchase({ paymentStatus: "captured", supplierCost: 15, supplierPaymentTerms, creditLineAvailable: 0, expectedContribution: 5 }, config);

describe("Übergabe an die Einkaufssperre", () => {
  it("rundet bestätigte Zahlungsziele auf die nächstkleinere Stufe ab", () => {
    expect(pay({ terms: ok({ kind: "net_terms", days: 45 }) })).toBe("netto30");
    expect(pay({ terms: ok({ kind: "net_terms", days: 30 }) })).toBe("netto30");
    expect(pay({ terms: ok({ kind: "net_terms", days: 21 }) })).toBe("netto14");
    expect(pay({ terms: ok({ kind: "net_terms", days: 10 }) })).toBe("vorkasse");
    expect(pay({ terms: ok({ kind: "net_terms", days: 5 }) })).toBe("vorkasse");
    expect(pay({ terms: ok({ kind: "net_terms", days: 0 }) })).toBe("vorkasse");
  });

  it("gibt bei Vorkasse oder unsicherem Zahlungsziel immer Vorkasse weiter", () => {
    expect(pay({ terms: ok({ kind: "prepayment" }) })).toBe("vorkasse");
    expect(pay({ terms: said({ kind: "net_terms", days: 30 }) })).toBe("vorkasse");
    expect(pay({ terms: missing() })).toBe("vorkasse");
  });

  it("verlangt eine bestätigte Aussage, dass keine Gewerbe-/USt-Prüfung nötig ist", () => {
    const net30 = ok({ kind: "net_terms" as const, days: 30 });
    expect(pay({ terms: net30, requiresBusinessVerification: ok(true) })).toBe("vorkasse");
    expect(pay({ terms: net30, requiresBusinessVerification: said(true) })).toBe("vorkasse");
    expect(pay({ terms: net30, requiresBusinessVerification: missing() })).toBe("vorkasse");
    expect(pay({ terms: net30, requiresBusinessVerification: said(false) })).toBe("vorkasse");
    expect(pay({ terms: net30, requiresBusinessVerification: ok(false) })).toBe("netto30");
  });

  it("weist ungültige Zahlungsziel-Tage ab", () => {
    for (const days of [NaN, Infinity, -Infinity, -5, 10.5, 30.5, "30" as unknown as number, null as unknown as number]) {
      expect(pay({ terms: ok({ kind: "net_terms", days }) }), String(days)).toBe("vorkasse");
    }
  });

  it("gibt für Demo-Angebote nie ein Zahlungsziel weiter", () => {
    const demo = buildQuote({ id: "demo", supplierName: "Demo", demo: true, payment: { terms: ok({ kind: "net_terms", days: 60 }) } });
    expect(toPurchaseGuardTerms(evaluateQuote(demo, query))).toBe("vorkasse");
  });

  it("gibt für ausgeschlossene Angebote nie ein Zahlungsziel weiter – auch bei bestätigtem Zahlungsziel", () => {
    expect(terms({ safety: { ceMarking: missing() } })).toBe("vorkasse");
    expect(terms({ safety: { euResponsiblePerson: said("Firma X") } })).toBe("vorkasse");
    expect(terms({ identity: { gtin: missing(), match: said("exact") } })).toBe("vorkasse");
    expect(terms({ dropshipping: { supported: missing() } })).toBe("vorkasse");
    expect(terms({ pricing: { minOrderQuantity: ok(50) } })).toBe("vorkasse");
  });

  describe("Zusammenspiel mit evaluateAutoPurchase", () => {
    it("blockiert mit dem echten Sicherheitsschalter auch das bestmögliche Angebot", () => {
      expect(guard(pay({ terms: ok({ kind: "net_terms", days: 30 }) })).allowed).toBe(false);
    });

    it("meldet „Finanzierung nicht gesichert“ für unbestätigte, unklare, ausgeschlossene und Demo-Angebote", () => {
      const net30 = ok({ kind: "net_terms" as const, days: 30 });
      const cases: [string, PaymentTerms][] = [
        ["unbestätigt", pay({ terms: said({ kind: "net_terms", days: 30 }) })],
        ["Gewerbeprüfung unklar", pay({ terms: net30, requiresBusinessVerification: missing() })],
        ["CE fehlt", terms({ safety: { ceMarking: missing() } })],
        ["Demo", toPurchaseGuardTerms(evaluateQuote(buildQuote({ id: "d", supplierName: "D", payment: { terms: net30 } }), query))],
      ];
      for (const [label, t] of cases) {
        const d = guard(t, SWITCH_ON_FOR_TEST);
        expect(d.allowed, label).toBe(false);
        expect(d.reasons.join(" "), label).toMatch(/Finanzierung nicht gesichert/);
      }
    });

    it("lässt die Finanzierungsprüfung nur bei einem geeigneten, echten, bestätigten Zahlungsziel passieren", () => {
      const t = pay({ terms: ok({ kind: "net_terms", days: 30 }), requiresBusinessVerification: ok(false) });
      expect(guard(t, SWITCH_ON_FOR_TEST)).toEqual({ allowed: true, reasons: [] });
    });
  });
});
