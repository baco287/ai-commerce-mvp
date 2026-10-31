// Compliance-Stufe mit festen Dokumenttypen (Paket D). Nur synthetische Testdaten.

import { describe, expect, it } from "vitest";
import { createDemoMarketSource, RequestBudget } from "./sources";
import { buildQuote, ok } from "@/lib/suppliers/quote-builder";
import { DEMO_QUERIES, demoQuotesFor, missing, type ProductQuery } from "@/lib/suppliers";
import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { checkCompliance, requiredDocTypesFor } from "./compliance";
import type { MarketCandidate } from "./model";
import { evaluateCandidate, type EvaluationDeps } from "./pipeline";
import { assessRisk } from "./risk";

const NOW = new Date("2026-10-31T08:00:00Z");

describe("Pflicht-Dokumenttypen aus den Risikoregeln (vorläufig)", () => {
  it("verlangt für elektrische Produkte mit Akku und Funk CE, WEEE, BattG, RED – und immer GPSR", () => {
    expect(requiredDocTypesFor(assessRisk("Akku-Leuchte mit Bluetooth"))).toEqual(["eu_doc", "red_doc", "weee", "battg", "gpsr"]);
    expect(requiredDocTypesFor(assessRisk("Batterie-Lichterkette"))).toEqual(["eu_doc", "weee", "battg", "gpsr"]);
  });

  it("ordnet Lebensmittelkontakt, Kosmetik und Magnete zu und ergänzt Typen aus dem Katalog", () => {
    expect(requiredDocTypesFor(assessRisk("Trinkflasche"))).toEqual(["gpsr", "food_contact"]);
    expect(requiredDocTypesFor(assessRisk("Gesichtscreme"))).toEqual(["gpsr", "cpnp", "safety_assessment"]);
    expect(requiredDocTypesFor(assessRisk("Magnetleiste"), ["trademark_license", "gpsr"])).toEqual(["gpsr", "magnet_warning", "trademark_license"]);
    // Funk-Zusatz nur bei elektrischen Produkten
    expect(requiredDocTypesFor(assessRisk("Kabelhalter für App-Nutzer"))).toEqual(["gpsr"]);
  });
});

describe("checkCompliance", () => {
  const risk = assessRisk("Akku-Leuchte");
  const required = requiredDocTypesFor(risk);
  const full = buildQuote({ id: "full", supplierName: "Voll", demo: false, safety: { documents: ["Unterlagen"], documentTypes: ["eu_doc", "weee", "battg", "gpsr"] } });

  it("gibt bei vollständigen Unterlagen nichts frei – Prüfung durch Menschen", () => {
    const c = checkCompliance({ risk, required, quotes: [full], demo: false });
    expect(c).toMatchObject({ status: "human_review", missingDocTypes: [], missingSafetyFacts: [], codes: ["COMPLIANCE_HUMAN_REVIEW"] });
  });

  it("stellt bei fehlendem Dokumenttyp zurück – geprüft über ALLE Basisangebote", () => {
    const partial = buildQuote({ id: "teil", supplierName: "Teil", demo: false, safety: { documents: [], documentTypes: ["eu_doc", "weee", "gpsr"] } });
    const c = checkCompliance({ risk, required, quotes: [full, partial], demo: false });
    expect(c).toMatchObject({ status: "deferred", missingDocTypes: ["battg"], codes: ["COMPLIANCE_DOCS_MISSING"] });
    expect(c.details.join(" ")).toMatch(/Fehlende Unterlagen: Batterie-Registrierung \(BattG\)/);
  });

  it("stellt bei unbestätigter verantwortlicher Person oder fehlenden deutschen Sicherheitshinweisen zurück", () => {
    const noGpsrFacts = buildQuote({ ...full, id: "x", supplierName: "X", safety: { ...full.safety, euResponsiblePerson: missing(), safetyInformationDe: ok(false) } });
    const c = checkCompliance({ risk, required, quotes: [noGpsrFacts], demo: false });
    expect(c.status).toBe("deferred");
    expect(c.missingSafetyFacts).toHaveLength(2);
  });

  it("stellt bei unbekanntem Risiko zurück", () => {
    const unknown = assessRisk("Aquaskipper");
    const c = checkCompliance({ risk: unknown, required: requiredDocTypesFor(unknown), quotes: [full], demo: false });
    expect(c).toMatchObject({ status: "deferred", codes: ["COMPLIANCE_RISK_UNKNOWN"] });
  });
});

describe("Compliance in der Market-Pipeline", () => {
  const queries = DEMO_QUERIES as Record<string, ProductQuery>;
  const deps: EvaluationDeps = {
    now: NOW,
    supplierInput: (c) => (c.productId && queries[c.productId] ? { query: queries[c.productId], quotes: demoQuotesFor(c.productId) } : null),
    product: (id) => DEMO_PRODUCTS.find((p) => p.id === id),
  };
  const demoCandidate = async (productId: string): Promise<MarketCandidate> => {
    const source = createDemoMarketSource(NOW);
    const topic = (await source.discover(new RequestBudget(0))).find((t) => t.productId === productId)!;
    return { ...topic, signals: [(await source.measure(topic, new RequestBudget(0)))!] };
  };

  it("überspringt den Entwurf, wenn eine Pflichtunterlage der Kalkulationsbasis fehlt", async () => {
    // Trinkflasche: Mit Vorkasse stellt schon der Profit Controller zurück (Mittel unbelegt, Paket C). Für diesen Test
    // haben beide geeigneten Demo-Lieferanten ein bestätigtes 30-Tage-Ziel → gleicher Liquiditätsrang, günstigster wird
    // Basis; ihm fehlt der Lebensmittelkontakt-Nachweis.
    const net30: EvaluationDeps = {
      ...deps,
      supplierInput: (c) => ({
        query: queries[c.productId!],
        quotes: demoQuotesFor(c.productId!).map((q) => ({
          ...q,
          payment: { ...q.payment, terms: ok({ kind: "net_terms" as const, days: 30 }), requiresBusinessVerification: ok(false) },
        })),
      }),
    };
    const r = evaluateCandidate(await demoCandidate("p-bottle"), net30);
    expect(r.stages.find((s) => s.key === "profit")).toMatchObject({ status: "blocked" });
    expect(r.stages.find((s) => s.key === "compliance")).toMatchObject({ status: "deferred", codes: ["COMPLIANCE_DOCS_MISSING"] });
    expect(r.stages.find((s) => s.key === "draft")?.status).toBe("skipped");
    expect(r.compliance).toMatchObject({ missingDocTypes: ["food_contact"], status: "offen" });
    expect(r.state).toBe("deferred");
  });

  it("lässt vollständige Unterlagen nur bis zur Prüfung durch Menschen", async () => {
    const r = evaluateCandidate(await demoCandidate("p-led"), deps);
    expect(r.supplier?.supplierName).toMatch(/Lumio/);
    expect(r.stages.find((s) => s.key === "compliance")).toMatchObject({ status: "blocked", codes: ["COMPLIANCE_HUMAN_REVIEW"] });
    expect(r.compliance?.requiredDocTypes).toEqual(["eu_doc", "red_doc", "weee", "gpsr"]);
    expect(r.reasonCodes).toContain("COMPLIANCE_HUMAN_REVIEW");
    expect(["approved", "draft_created"]).not.toContain(r.state);
  });
});
