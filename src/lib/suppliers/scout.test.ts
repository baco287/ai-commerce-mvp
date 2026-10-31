import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adapterBlockReason, DEFAULT_ADAPTER_POLICY, type SupplierAdapter } from "./adapter";
import { createDemoAdapter, DEMO_ADAPTERS, DEMO_QUERIES } from "./demo/demo-suppliers";
import { buildQuote } from "./quote-builder";
import { scoutSuppliers } from "./scout";

const ids = (r: { eligible: { quote: { id: string } }[] }) => r.eligible.map((e) => e.quote.id);

describe("Supplier Scout mit Demo-Lieferanten", () => {
  // Demo-Daten vereinheitlicht (31.10.2026): Werte wie in den bisherigen Demo-Angeboten, auf denen die
  // Shopify-Kosten beruhen. Brightline liefert dort in 9–16 Tagen und ist damit zu langsam.
  it("findet für die LED-Leiste günstigsten, schnellsten und besten Lieferanten", async () => {
    const r = await scoutSuppliers(DEMO_QUERIES["p-led"], DEMO_ADAPTERS);
    expect(r.recommendations.cheapest?.supplierName).toBe("EuroLight Fulfillment (Demo)");
    expect(r.recommendations.fastest?.supplierName).toBe("Lumio Großhandel (Demo)");
    expect(r.recommendations.best?.supplierName).toBe("Lumio Großhandel (Demo)");
    expect(ids(r)).toEqual(["demo-eu:lumio:p-led", "demo-eu:eurolight:p-led"]);
  });

  it("schließt ungeeignete Demo-Angebote mit Begründung aus", async () => {
    const r = await scoutSuppliers(DEMO_QUERIES["p-led"], DEMO_ADAPTERS);
    expect(Object.fromEntries(r.excluded.map((e) => [e.quote.supplierName, e.eligibility.exclusions.map((x) => x.code)]))).toEqual({
      "Brightline Demo Co.": ["delivery_too_slow"],
      "Bulkware Demo Trading": ["stock_purchase_required"],
      "Shinelight Wholesale (Demo)": ["identity_unconfirmed"],
      "Stripe & Co. Lager (Demo)": ["not_deliverable"],
      "Voltmarkt Restposten (Demo)": ["safety_unclear", "safety_unclear"],
    });
  });

  it("deckt alle fünf Demo-Produkte mit mindestens einem geeigneten Angebot ab", async () => {
    for (const query of Object.values(DEMO_QUERIES)) {
      const r = await scoutSuppliers(query, DEMO_ADAPTERS);
      expect(r.eligible.length, query.productId).toBeGreaterThanOrEqual(1);
      expect(r.excluded.length, query.productId).toBeGreaterThanOrEqual(1);
    }
  });

  it("kennzeichnet Vorfinanzierung und unbestätigte Zahlungsziele", async () => {
    const led = await scoutSuppliers(DEMO_QUERIES["p-led"], DEMO_ADAPTERS);
    const fin = Object.fromEntries(led.eligible.map((e) => [e.quote.supplierId, e.financing.requiresPrefinancing]));
    expect(fin).toEqual({ eurolight: false, lumio: false });
    const bottle = await scoutSuppliers(DEMO_QUERIES["p-bottle"], DEMO_ADAPTERS);
    const trinkgut = bottle.eligible.find((e) => e.quote.supplierId === "trinkgut");
    expect(trinkgut?.financing).toMatchObject({ status: "payment_terms_pending_verification", requiresPrefinancing: true });

    const stand = await scoutSuppliers(DEMO_QUERIES["p-stand"], DEMO_ADAPTERS);
    const deskpro = stand.eligible.find((e) => e.quote.supplierId === "deskpro");
    expect(deskpro?.financing).toMatchObject({ status: "payment_terms_unconfirmed", requiresPrefinancing: true });
    expect(stand.recommendations.cheapest?.supplierName).toBe("DeskPro Supply (Demo)");
    expect(stand.recommendations.best?.supplierName).toBe("ErgoHandel (Demo)");
  });

  it("kennzeichnet Demo-Daten im Bericht und in jedem Angebot", async () => {
    const r = await scoutSuppliers(DEMO_QUERIES["p-led"], DEMO_ADAPTERS);
    expect(r.containsDemoData).toBe(true);
    expect([...r.eligible, ...r.excluded].every((e) => e.quote.demo)).toBe(true);
    expect(r.notes).toContain("Enthält Demo-Daten fiktiver Lieferanten.");
    expect(r.adapters).toEqual([
      { adapterId: "demo-asia-marketplace", adapterName: "Fernost-Marktplatz (Demo)", status: "ok", quoteCount: 3 },
      { adapterId: "demo-eu-wholesale", adapterName: "EU-Großhandel (Demo)", status: "ok", quoteCount: 4 },
    ]);
  });

  it("liefert unabhängig von der Adapter-Reihenfolge dasselbe Ergebnis", async () => {
    const a = await scoutSuppliers(DEMO_QUERIES["p-led"], DEMO_ADAPTERS);
    const b = await scoutSuppliers(DEMO_QUERIES["p-led"], [...DEMO_ADAPTERS].reverse());
    expect(b).toEqual(a);
  });
});

describe("Adapter-Sicherheit", () => {
  const fake = (info: Partial<SupplierAdapter["info"]>, findQuotes: SupplierAdapter["findQuotes"] = async () => []): SupplierAdapter => ({
    info: { id: "x", name: "Testquelle", kind: "api", paid: false, network: false, ...info },
    findQuotes,
  });

  it("fragt kostenpflichtige und Netzwerk-Adapter standardmäßig nicht ab", async () => {
    let called = 0;
    const count = async () => {
      called++;
      return [];
    };
    const r = await scoutSuppliers(DEMO_QUERIES["p-led"], [
      fake({ id: "paid", name: "Bezahl-API", paid: true }, count),
      fake({ id: "net", name: "Online-Feed", network: true }, count),
    ]);
    expect(called).toBe(0);
    expect(r.adapters.map((a) => [a.adapterId, a.status])).toEqual([
      ["net", "blocked"],
      ["paid", "blocked"],
    ]);
    expect(r.recommendations.best).toBeNull();
  });

  it("nutzt den globalen Sicherheitsschalter für kostenpflichtige Abrufe", () => {
    expect(DEFAULT_ADAPTER_POLICY).toEqual({ paidApiCallsEnabled: false, networkAllowed: false });
    expect(adapterBlockReason({ id: "p", name: "P", kind: "api", paid: true, network: false })).toMatch(/kostenpflichtig/);
    expect(adapterBlockReason({ id: "d", name: "D", kind: "demo", paid: false, network: false })).toBeNull();
  });

  it("lässt sich über eine übergebene Richtlinie nicht am globalen Schalter vorbei freischalten", async () => {
    expect(Object.isFrozen(DEFAULT_ADAPTER_POLICY)).toBe(true);
    const permissive = { paidApiCallsEnabled: true, networkAllowed: false };
    expect(adapterBlockReason({ id: "p", name: "P", kind: "api", paid: true, network: false }, permissive)).toMatch(/kostenpflichtig/);

    let called = 0;
    const paid = fake({ id: "paid", name: "Bezahl-API", paid: true }, async () => {
      called++;
      return [];
    });
    const r = await scoutSuppliers(DEMO_QUERIES["p-led"], [paid], { policy: { paidApiCallsEnabled: true, networkAllowed: true } });
    expect(called).toBe(0);
    expect(r.adapters).toMatchObject([{ adapterId: "paid", status: "blocked" }]);
  });

  it("fängt Adapterfehler ab und wertet die übrigen Quellen aus", async () => {
    const broken = fake({ id: "broken", name: "Defekt" }, async () => {
      throw new Error("Zeitüberschreitung");
    });
    const r = await scoutSuppliers(DEMO_QUERIES["p-led"], [broken, ...DEMO_ADAPTERS]);
    expect(r.adapters.find((a) => a.adapterId === "broken")).toMatchObject({ status: "error", message: "Zeitüberschreitung" });
    expect(r.recommendations.best?.supplierName).toBe("Lumio Großhandel (Demo)");
  });

  it("erzwingt die Demo-Kennzeichnung und ignoriert Angebote für andere Produkte", async () => {
    const sneaky = createDemoAdapter("demo-x", "Demo X", [
      buildQuote({ id: "x1", supplierName: "X", productId: "p-led", demo: false }),
      buildQuote({ id: "x2", supplierName: "Y", productId: "p-other" }),
    ]);
    const r = await scoutSuppliers(DEMO_QUERIES["p-led"], [sneaky]);
    expect([...r.eligible, ...r.excluded].map((e) => [e.quote.id, e.quote.demo])).toEqual([["x1", true]]);
  });

  it("Demo-Adapter sind kostenlos, offline und haben keine Bestell- oder Zahlungsfunktion", () => {
    for (const a of DEMO_ADAPTERS) {
      expect(a.info).toMatchObject({ kind: "demo", paid: false, network: false });
      expect(Object.keys(a).sort()).toEqual(["findQuotes", "info"]);
    }
  });

  it("enthält im Lieferantenmodul keine Netzwerkaufrufe, Zugangsdaten oder Bestellfunktionen", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
      );
    for (const f of files(__dirname)) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\bfetch\b|XMLHttpRequest|process\.env|\b(placeOrder|createOrder|submitOrder|purchase|pay)\s*\(/);
      // Der Scout empfiehlt nur. Die Einkaufssperre ruft er nie selbst auf, und Schalter verändert er nicht.
      expect(src, f).not.toMatch(/\bevaluateAutoPurchase\b|SAFETY_SWITCHES\s*\.\s*\w+\s*=[^=]|\bdefineProperty\b/);
    }
  });
});
