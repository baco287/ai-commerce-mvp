import { describe, expect, it } from "vitest";
import { calculateMargin } from "@/lib/calc/pricing";
import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { compareQuotes } from "./compare";
import { buildSupplierView, recommendationTitle, type ProductSupplierView } from "./dashboard";
import { DEMO_QUERIES, DEMO_REQUIRED_DOCUMENTS, demoQuotesFor, type DemoProductId } from "./demo/demo-suppliers";

const views = (): ProductSupplierView[] =>
  DEMO_PRODUCTS.map((p) => buildSupplierView(p, compareQuotes(DEMO_QUERIES[p.id as DemoProductId], demoQuotesFor(p.id))));
const viewOf = (id: string) => views().find((v) => v.productId === id)!;
const offerOf = (id: string, supplierId: string) => {
  const v = viewOf(id);
  return [...v.eligible, ...v.excluded].find((o) => o.quoteId.includes(`:${supplierId}:`))!;
};

/** Kosten pro Artikel, die heute in Shopify stehen (CSV-Import) – dürfen sich durch den Scout nicht ändern. */
const SHOPIFY_COSTS: Record<string, number> = { "p-led": 11.6, "p-stand": 15.1, "p-cable": 3.9, "p-bottle": 8.5, "p-band": 4.4 };

describe("Lieferanten-Seite: Auswertung je Produkt", () => {
  it("zeigt für alle fünf Produkte günstigsten, schnellsten und besten geeigneten Lieferanten", () => {
    for (const v of views()) {
      const kinds = v.recommendations.flatMap((r) => r.kinds).sort();
      expect(kinds, v.productId).toEqual(["best", "cheapest", "fastest"]);
      expect(v.noSupplier).toBe(false);
    }
  });

  it("nutzt den günstigsten geeigneten als Kalkulationsbasis – mit den Shopify-Kosten pro Artikel", () => {
    for (const v of views()) {
      const basis = v.recommendations.find((r) => r.kinds.includes("cheapest"))!.offer;
      expect(v.calculationBasisId).toBe(basis.quoteId);
      expect(basis.perUnit, v.productId).toBe(SHOPIFY_COSTS[v.productId]);
    }
  });

  it("berechnet die Marge mit der bestehenden Kalkulationslogik", () => {
    for (const v of views()) {
      for (const o of v.eligible) {
        const m = calculateMargin(v.priceGross, o.perUnit!);
        expect(o.margin).toEqual({ contribution: m.contribution, marginPercent: m.marginPercent });
      }
    }
  });

  it("fasst Empfehlungen für dasselbe Angebot zu einer Karte zusammen", () => {
    const led = viewOf("p-led");
    expect(led.recommendations.map((r) => [r.offer.supplierName, r.kinds])).toEqual([
      ["EuroLight Fulfillment (Demo)", ["cheapest"]],
      ["Lumio Großhandel (Demo)", ["fastest", "best"]],
    ]);
    expect(led.recommendations[1].title).toBe("Schnellster & insgesamt bester geeigneter");
    expect(recommendationTitle(["cheapest", "fastest", "best"])).toBe("Günstigster, schnellster & insgesamt bester geeigneter");
  });
});

describe("Lieferanten-Seite: Sicherheitskennzeichnung", () => {
  it("gibt nie einen Einkauf frei und übergibt Demo-Angebote der Einkaufssperre als Vorkasse", () => {
    for (const v of views()) {
      expect(v.purchaseApproved).toBe(false);
      expect(v.autoPurchaseEnabled).toBe(false);
      for (const o of [...v.eligible, ...v.excluded]) {
        expect(o.purchaseGuardTerms).toBe("vorkasse");
        expect(o.flags.map((f) => f.kind)).toContain("demo");
      }
    }
  });

  it("kennzeichnet fehlende Produktnachweise", () => {
    const eurolight = offerOf("p-led", "eurolight");
    expect(eurolight.openDocuments).toEqual([DEMO_REQUIRED_DOCUMENTS.weee]);
    expect(eurolight.flags.find((f) => f.kind === "missing_evidence")?.details).toEqual(
      expect.arrayContaining([`${DEMO_REQUIRED_DOCUMENTS.weee} fehlt`, "Kein geprüftes Muster"]),
    );
    expect(offerOf("p-bottle", "aquatrade").openDocuments).toEqual([DEMO_REQUIRED_DOCUMENTS.foodContact]);
    expect(offerOf("p-led", "lumio").flags.map((f) => f.kind)).not.toContain("missing_evidence");
  });

  it("kennzeichnet unsichere Finanzierung", () => {
    const deskpro = offerOf("p-stand", "deskpro");
    expect(deskpro.financing).toMatchObject({ status: "payment_terms_unconfirmed", requiresPrefinancing: true });
    expect(deskpro.flags.map((f) => f.kind)).toContain("uncertain_financing");
    expect(offerOf("p-led", "lumio").flags.map((f) => f.kind)).not.toContain("uncertain_financing");
  });

  it("kennzeichnet fehlende Lieferfähigkeit und unbestätigten Bestand", () => {
    expect(offerOf("p-band", "armbanddirekt").flags.find((f) => f.kind === "delivery_unconfirmed")?.details).toContain(
      "Lieferantenbestand nicht bestätigt",
    );
    const stripe = offerOf("p-led", "stripeco");
    expect(stripe.eligible).toBe(false);
    expect(stripe.flags.find((f) => f.kind === "delivery_unconfirmed")?.details.join(" ")).toMatch(/Nicht lieferbar|Bestand 0/);
  });

  it("kennzeichnet fehlende Dropshipping-Bestätigung", () => {
    const bandhub = offerOf("p-band", "bandhub");
    expect(bandhub.flags.find((f) => f.kind === "dropshipping_unconfirmed")?.details).toEqual([
      "Neutraler Versand nicht bestätigt",
      "Bestellweg nicht bestätigt",
    ]);
  });

  it("weist geprüfte, vom Lieferanten angegebene, unbestätigte und fehlende Angaben getrennt aus", () => {
    const homegoods = offerOf("p-cable", "homegoods");
    // Demo-Selbstauskünfte sind „vom Lieferanten angegeben“ – nicht geprüft
    expect(homegoods.facts.supplierStated).toEqual(expect.arrayContaining(["Importkosten", "Sendungsverfolgung", "Neutraler Versand"]));
    expect(homegoods.facts.verified).toEqual(expect.arrayContaining(["Einkaufspreis", "Versandkosten"]));
    expect(homegoods.facts.missing).toContain("Geprüftes Muster");
    expect(homegoods.importCost).toEqual({ value: 0.4, status: "unconfirmed", level: "supplier_stated" });
    expect(homegoods.source).toBe("demo");
  });

  it("nennt für jedes ausgeschlossene Angebot mindestens einen Grund", () => {
    for (const v of views()) for (const o of v.excluded) expect(o.exclusions.length, o.supplierName).toBeGreaterThan(0);
  });
});

describe("Lieferanten-Seite: offene Punkte", () => {
  it("zählt beim besten Angebot alle Hinweise ehrlich mit – nicht nur die Warn-Kennzeichen", () => {
    const stand = viewOf("p-stand");
    expect(stand.recommendations.find((r) => r.kinds.includes("best"))?.offer.supplierName).toBe("ErgoHandel (Demo)");
    expect(stand.bestOpenPoints).toEqual(expect.arrayContaining([expect.stringMatching(/Pünktlichkeitsquote fehlt/)]));
    for (const v of views()) expect(v.complianceNotes.length, v.productId).toBeGreaterThan(0);
  });

  it("listet keinen offenen Punkt doppelt", () => {
    for (const v of views()) {
      const keys = v.bestOpenPoints.map((p) => p.replace(/\.$/, "").toLowerCase());
      expect(new Set(keys).size, v.productId).toBe(keys.length);
    }
  });
});
