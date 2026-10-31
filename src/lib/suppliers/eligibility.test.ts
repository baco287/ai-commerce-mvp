import { describe, expect, it } from "vitest";
import { checkEligibility, costBreakdown } from "./eligibility";
import { assessFinancing } from "./financing";
import { missing, unconfirmed, type ProductQuery } from "./model";
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
const quote = (o: Partial<QuoteOverrides> = {}) => buildQuote({ id: "q", supplierName: "Test", ...o });
const codes = (o: Partial<QuoteOverrides>, q: ProductQuery = query) => checkEligibility(quote(o), q).exclusions.map((e) => e.code);
const warnings = (o: Partial<QuoteOverrides>) => checkEligibility(quote(o), query).warnings.map((w) => w.code);

describe("Eignungsprüfung", () => {
  it("lässt ein vollständig bestätigtes Angebot ohne Hinweise zu", () => {
    expect(checkEligibility(quote(), query)).toEqual({ eligible: true, exclusions: [], warnings: [] });
  });

  describe("Produktidentität", () => {
    it("schließt abweichende GTIN aus – auch wenn sie nur unbestätigt ist", () => {
      expect(codes({ identity: { gtin: said("2000000000099") } })).toEqual(["identity_mismatch"]);
    });

    it("schließt ein bestätigt anderes Produkt aus", () => {
      expect(codes({ identity: { gtin: missing(), match: ok("different") } })).toEqual(["identity_mismatch"]);
    });

    it("schließt nur ähnliche Varianten und unbestätigte Zuordnungen aus", () => {
      expect(codes({ identity: { gtin: missing(), match: ok("variant") } })).toEqual(["identity_unconfirmed"]);
      expect(codes({ identity: { gtin: missing(), match: said("exact") } })).toEqual(["identity_unconfirmed"]);
      expect(codes({ identity: { gtin: said("2000000000015"), match: missing() } })).toEqual(["identity_unconfirmed"]);
    });

    it("akzeptiert eine bestätigte GTIN oder einen bestätigten exakten Abgleich", () => {
      expect(codes({ identity: { gtin: ok("2000000000015"), match: missing() } })).toEqual([]);
      expect(codes({ identity: { gtin: missing(), match: ok("exact") } })).toEqual([]);
    });
  });

  describe("Produktsicherheit", () => {
    it("verlangt bestätigte CE-Kennzeichnung, wenn das Produkt sie braucht", () => {
      expect(codes({ safety: { ceMarking: missing() } })).toEqual(["safety_unclear"]);
      expect(codes({ safety: { ceMarking: said(true) } })).toEqual(["safety_unclear"]);
      expect(codes({ safety: { ceMarking: ok(false) } })).toEqual(["safety_unclear"]);
      expect(codes({ safety: { ceMarking: missing() } }, { ...query, safety: { ceRequired: false } })).toEqual([]);
    });

    it("verlangt verantwortliche Person in der EU und deutsche Sicherheitshinweise", () => {
      expect(codes({ safety: { euResponsiblePerson: said("Firma X") } })).toEqual(["safety_unclear"]);
      expect(codes({ safety: { safetyInformationDe: missing() } })).toEqual(["safety_unclear"]);
    });

    it("schließt bei bekannten Sicherheitsproblemen aus", () => {
      const e = checkEligibility(quote({ safety: { openIssues: ["Rückruf wegen Überhitzung"] } }), query);
      expect(e.exclusions).toEqual([{ code: "safety_issue", message: "Sicherheitsproblem: Rückruf wegen Überhitzung" }]);
    });
  });

  describe("Dropshipping und Lieferfähigkeit", () => {
    it("verlangt bestätigten Direktversand an Kunden", () => {
      expect(codes({ dropshipping: { supported: ok(false) } })).toEqual(["dropshipping_unavailable"]);
      expect(codes({ dropshipping: { supported: said(true) } })).toEqual(["dropshipping_unavailable"]);
      expect(codes({ dropshipping: { supported: missing() } })).toEqual(["dropshipping_unavailable"]);
    });

    it("schließt fehlende Lieferfähigkeit aus", () => {
      expect(codes({ fulfillment: { stock: missing() } })).toEqual(["not_deliverable"]);
      expect(codes({ fulfillment: { stock: ok(0) } })).toEqual(["not_deliverable"]);
      expect(codes({ fulfillment: { deliveryDays: missing() } })).toEqual(["not_deliverable"]);
      expect(codes({ fulfillment: { deliversToDestination: ok(false) } })).toEqual(["not_deliverable"]);
      expect(codes({ fulfillment: { deliversToDestination: missing() } })).toEqual(["not_deliverable"]);
    });

    it("prüft Mindestbestand und maximale Lieferzeit", () => {
      expect(codes({ fulfillment: { stock: ok(49) } })).toEqual(["insufficient_stock"]);
      expect(codes({ fulfillment: { stock: ok(50) } })).toEqual([]);
      expect(codes({ fulfillment: { deliveryDays: ok({ min: 8, max: 13 }) } })).toEqual(["delivery_too_slow"]);
      expect(codes({ fulfillment: { deliveryDays: ok({ min: 8, max: 12 }) } })).toEqual([]);
    });

    it("schließt Vorratskäufe über die Mindestabnahme aus", () => {
      expect(codes({ pricing: { minOrderQuantity: ok(10) } })).toEqual(["stock_purchase_required"]);
      expect(codes({ pricing: { minOrderQuantity: ok(2) } }, { ...query, quantity: 2 })).toEqual([]);
      expect(warnings({ pricing: { minOrderQuantity: missing() } })).toEqual(["moq_missing"]);
    });
  });

  describe("Kosten und Zuverlässigkeit", () => {
    it("schließt unvollständige Kosten aus", () => {
      expect(codes({ pricing: { unitPrice: missing() } })).toEqual(["cost_unknown"]);
      expect(codes({ pricing: { shippingCost: missing() } })).toEqual(["cost_unknown"]);
    });

    it("setzt fehlende Importkosten nur bei Versand aus der EU auf 0", () => {
      const eu = quote({ pricing: { importCost: missing() }, fulfillment: { shipsFrom: ok("PL") } });
      expect(checkEligibility(eu, query).eligible).toBe(true);
      expect(costBreakdown(eu, 1)?.importCost).toBe(0);

      const cn = quote({ pricing: { importCost: missing() }, fulfillment: { shipsFrom: ok("CN") } });
      expect(checkEligibility(cn, query).exclusions.map((e) => e.code)).toEqual(["cost_unknown"]);
      expect(costBreakdown(cn, 1)).toBeNull();
    });

    it("rechnet Gesamtkosten je Stück und je Bestellung", () => {
      const q = quote({ pricing: { unitPrice: ok(6.2), shippingCost: ok(3.9), importCost: said(1.1) } });
      expect(costBreakdown(q, 2)).toEqual({ unitPrice: 6.2, shippingCost: 3.9, importCost: 1.1, perUnit: 11.2, total: 22.4 });
    });

    it("schließt zu schlechte Bewertungen aus, fehlende werden nur vermerkt", () => {
      expect(codes({ reliability: { rating: ok(4.1) } })).toEqual(["rating_too_low"]);
      expect(codes({ reliability: { rating: said(3.5) } })).toEqual(["rating_too_low"]);
      expect(codes({ reliability: { rating: missing() } })).toEqual([]);
      expect(warnings({ reliability: { rating: missing(), onTimeRate: missing(), defectRate: missing() } })).toEqual([
        "rating_missing",
        "on_time_missing",
        "defect_missing",
      ]);
    });
  });

  it("vermerkt fehlende Musterprüfung und unklare Voraussetzungen für das Zahlungsziel", () => {
    expect(warnings({ reliability: { sampleTested: missing() } })).toEqual(["sample_not_tested"]);
    expect(warnings({ reliability: { sampleTested: ok(false) } })).toEqual(["sample_not_tested"]);
    expect(warnings({ payment: { requiresBusinessVerification: missing() } })).toEqual(["payment_terms_conditions_unclear"]);
    expect(warnings({ payment: { requiresBusinessVerification: said(false) } })).toEqual(["payment_terms_conditions_unclear"]);
    expect(warnings({ payment: { terms: ok({ kind: "net_terms", days: NaN }) } })).toEqual(["payment_terms_invalid"]);
    expect(warnings({ payment: { requiresBusinessVerification: ok(true) } })).toEqual(["payment_terms_pending_verification"]);
    // Bei Vorkasse spielt die Gewerbeprüfung keine Rolle
    expect(warnings({ payment: { terms: ok({ kind: "prepayment" }), requiresBusinessVerification: missing() } })).toEqual([]);
  });

  it("vermerkt unbestätigte Angaben ausdrücklich als Hinweis", () => {
    expect(
      warnings({
        pricing: { unitPrice: said(10), shippingCost: said(3), importCost: said(0) },
        fulfillment: { stock: said(500), deliveryDays: said({ min: 2, max: 4 }), deliversToDestination: said(true), tracking: missing() },
        dropshipping: { blindShipping: said(true), orderChannel: missing() },
        payment: { terms: said({ kind: "net_terms", days: 30 }), creditLimit: missing() },
      }),
    ).toEqual([
      "blind_shipping_open",
      "order_channel_open",
      "destination_unconfirmed",
      "stock_unconfirmed",
      "delivery_unconfirmed",
      "tracking_open",
      "price_unconfirmed",
      "shipping_unconfirmed",
      "import_unconfirmed",
      "payment_terms_unconfirmed",
    ]);
  });
});

describe("Finanzierung", () => {
  const fin = (terms: QuoteOverrides["payment"]) => assessFinancing(quote({ payment: terms }));

  it("kennzeichnet Vorkasse als Vorfinanzierung", () => {
    expect(fin({ terms: ok({ kind: "prepayment" }) })).toMatchObject({ status: "prepayment_required", termDays: 0, requiresPrefinancing: true });
  });

  it("akzeptiert nur ein bestätigtes Zahlungsziel, das die Auszahlung abdeckt", () => {
    expect(fin({ terms: ok({ kind: "net_terms", days: 7 }) })).toMatchObject({ status: "payment_terms_confirmed", requiresPrefinancing: false });
    expect(fin({ terms: ok({ kind: "net_terms", days: 30 }) })).toMatchObject({ status: "payment_terms_confirmed", requiresPrefinancing: false });
    expect(fin({ terms: ok({ kind: "net_terms", days: 5 }) })).toMatchObject({ status: "payment_terms_too_short", requiresPrefinancing: true });
  });

  it("behandelt unbestätigte oder fehlende Zahlungsziele konservativ", () => {
    expect(fin({ terms: said({ kind: "net_terms", days: 30 }) })).toMatchObject({ status: "payment_terms_unconfirmed", termDays: 30, requiresPrefinancing: true });
    expect(fin({ terms: missing() })).toMatchObject({ status: "unknown", termDays: null, requiresPrefinancing: true });
  });

  it("verlangt Vorfinanzierung, solange eine Gewerbe-/USt-Prüfung aussteht", () => {
    expect(fin({ terms: ok({ kind: "net_terms", days: 30 }), requiresBusinessVerification: ok(true) })).toMatchObject({
      status: "payment_terms_pending_verification",
      termDays: 30,
      requiresPrefinancing: true,
    });
    expect(fin({ terms: ok({ kind: "net_terms", days: 30 }), requiresBusinessVerification: said(true) })).toMatchObject({
      status: "payment_terms_pending_verification",
    });
  });

  it("behandelt eine unbekannte oder nur behauptete Befreiung von der Gewerbeprüfung als Vorfinanzierung", () => {
    for (const rbv of [missing<boolean>(), said(false)]) {
      expect(fin({ terms: ok({ kind: "net_terms", days: 30 }), requiresBusinessVerification: rbv })).toMatchObject({
        status: "payment_terms_conditions_unclear",
        termDays: 30,
        requiresPrefinancing: true,
      });
    }
    expect(fin({ terms: ok({ kind: "net_terms", days: 30 }), requiresBusinessVerification: ok(false) })).toMatchObject({
      status: "payment_terms_confirmed",
      requiresPrefinancing: false,
    });
  });

  it("weist ungültige Zahlungsziel-Tage ab", () => {
    for (const days of [NaN, Infinity, -5, 10.5, "30" as unknown as number]) {
      expect(fin({ terms: ok({ kind: "net_terms", days }) }), String(days)).toEqual({
        status: "unknown",
        termDays: null,
        requiresPrefinancing: true,
        label: "Zahlungsziel ungültig – Vorfinanzierung angenommen",
      });
    }
  });
});
