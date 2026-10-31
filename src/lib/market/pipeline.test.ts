import { describe, expect, it, vi } from "vitest";
import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { DEMO_LISTINGS } from "@/lib/shopify/listings";
import { DEMO_QUERIES, demoQuotesFor, type ProductQuery, type SupplierQuote } from "@/lib/suppliers";
import { buildQuote, ok } from "@/lib/suppliers/quote-builder";
import type { MarketCandidate } from "./model";
import { evaluateCandidate, runMarketScan, type EvaluationDeps } from "./pipeline";
import { createDemoMarketSource, createWikimediaSource, RequestBudget, SourceHttpError, type FetchJson, type MarketSource } from "./sources";
import { emptyMarketState, mergeRun } from "./state";

const NOW = new Date("2026-10-31T08:00:00Z");

/** Abhängigkeiten wie im Dashboard: Demo-Angebote für Demo-Produkte, sonst nur die übergebenen echten Angebote. */
function deps(realQuotes: SupplierQuote[] = []): EvaluationDeps {
  const queries = DEMO_QUERIES as Record<string, ProductQuery>;
  return {
    now: NOW,
    supplierInput: (c) => (c.productId && queries[c.productId] ? { query: queries[c.productId], quotes: [...demoQuotesFor(c.productId), ...realQuotes] } : null),
    product: (id) => DEMO_PRODUCTS.find((p) => p.id === id),
    draftSource: (c) => {
      const demoListing = c.demo ? DEMO_LISTINGS.find((l) => l.productId === c.productId) : undefined;
      return demoListing ? { demoListing } : null;
    },
  };
}

/** Synthetische Wikimedia-Antworten (keine echten Abrufe): steigendes Interesse für jeden Artikel. */
function fakeWikimedia(options: { missing?: string[]; members?: string[] } = {}): { fetchJson: FetchJson; calls: string[] } {
  const calls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    if (url.includes("list=categorymembers")) {
      return { query: { categorymembers: (options.members ?? ["Aktenordner", "Liste von Küchengeräten", "Leuchter (Heraldik)"]).map((title) => ({ ns: 0, title })) } };
    }
    if (options.missing?.some((m) => url.includes(`/${encodeURIComponent(m)}/`))) throw new SourceHttpError(404, url);
    const items = Array.from({ length: 400 }, (_, i) => {
      const t = Date.parse("2025-09-26T00:00:00Z") + i * 86_400_000;
      const ts = new Date(t).toISOString().slice(0, 10).replaceAll("-", "");
      return { timestamp: `${ts}00`, views: i > 370 ? 120 : 60 };
    });
    return { items };
  };
  return { fetchJson, calls };
}

const wikiSource = (fetchJson: FetchJson, categories = ["Büromaterial"]): MarketSource =>
  createWikimediaSource({ fetchJson, now: NOW, categories, linkedTopics: [{ title: "Trinkflasche", productId: "p-bottle" }], membersPerCategory: 10 });

const realBottle = async (): Promise<MarketCandidate> => {
  const source = wikiSource(fakeWikimedia().fetchJson);
  const signal = await source.measure({ key: "wiki:de.wikipedia:Trinkflasche", title: "Trinkflasche", productId: "p-bottle", discoveredVia: "Test", demo: false }, new RequestBudget(5));
  return { key: "wiki:de.wikipedia:Trinkflasche", title: "Trinkflasche", productId: "p-bottle", discoveredVia: "Test", demo: false, signals: [signal!] };
};

describe("Market-Scout-Pipeline: Kandidat bewerten", () => {
  it("führt ein Demo-Produkt bis zum Dry-Run-Entwurf – und sperrt es trotzdem (Marge nicht verlässlich, Compliance offen)", async () => {
    const [topic] = await createDemoMarketSource(NOW).discover(new RequestBudget(0));
    const candidate: MarketCandidate = { ...topic, signals: [(await createDemoMarketSource(NOW).measure(topic, new RequestBudget(0)))!] };
    const r = evaluateCandidate(candidate, deps());
    expect(r.stages.map((s) => [s.key, s.status])).toEqual([
      ["market", "ok"],
      ["supplier", "ok"],
      ["profit", "blocked"],
      ["compliance", "blocked"],
      ["draft", "ok"],
    ]);
    expect(r.state).toBe("blocked");
    expect(r.draft).toMatchObject({ status: "dry_run_prepared", wouldCreate: false });
    expect(r.draft.title).toMatch(/^\[DEMO\]/);
    expect(r.profit?.reliable).toBe(false);
    expect(r.compliance?.status).toBe("offen");
  });

  it("Profit Controller: Demo mit belegtem 30-Tage-Ziel nur gesperrt, Demo mit Vorkasse zurückgestellt (Mittel unbelegt)", async () => {
    const source = createDemoMarketSource(NOW);
    const topics = await source.discover(new RequestBudget(0));
    const results = await Promise.all(topics.map(async (t) => evaluateCandidate({ ...t, signals: [(await source.measure(t, new RequestBudget(0)))!] }, deps())));
    const byId = new Map(results.map((r) => [r.candidate.productId, r]));

    const led = byId.get("p-led")!;
    expect(led.stages.find((s) => s.key === "profit")).toMatchObject({ status: "blocked" });
    expect(led.reasonCodes).toEqual(expect.arrayContaining(["LIQ_TERM_UNSECURED", "DEMO_DATA", "MARGIN_UNRELIABLE"]));
    expect(led.stages.find((s) => s.key === "draft")?.status).toBe("ok");
    expect(led.state).toBe("blocked");

    const bottle = byId.get("p-bottle")!;
    expect(bottle.state).toBe("deferred");
    expect(bottle.reasonCodes).toEqual(expect.arrayContaining(["LIQ_PREFINANCING_UNFUNDED", "LIQ_CAPACITY_ZERO"]));
    expect(bottle.stages.find((s) => s.key === "draft")?.status).toBe("skipped");

    // Ohne Kontonachweis nirgends „vorfinanzierungsfrei gesichert“, keine Kapazität, keine geplante Menge, kein NaN
    for (const r of results.filter((x) => x.liquidity)) {
      expect(r.liquidity!.securedWithoutPrefinancing).toBe(false);
      expect(r.liquidity!.maxOpenOrders).toBe(0);
      expect(r.availability?.every((a) => a.plannedAvailable === 0)).toBe(true);
      expect(JSON.stringify(r.profit)).not.toMatch(/NaN|Infinity/);
    }
  });

  it("verwendet für echte Kandidaten nie Demo-Lieferanten", async () => {
    const r = evaluateCandidate(await realBottle(), deps());
    expect(r.state).toBe("deferred");
    expect(r.supplier).toBeNull();
    expect(r.stateReasons.join(" ")).toMatch(/Demo-Angebote nicht berücksichtigt/);
  });

  it("stellt Kandidaten ohne belastbare Produktidentität zurück", () => {
    const candidate: MarketCandidate = {
      key: "wiki:de.wikipedia:Aktenordner",
      title: "Aktenordner",
      discoveredVia: "Test",
      demo: false,
      signals: [{ sourceId: "wikimedia-pageviews", sourceName: "W", kind: "public_interest", demo: false, retrievedAt: NOW.toISOString(), reference: "x", interest: { avg7: 300, avg30: 250, trend7: 0.2, trend30: 0.3, seasonalIndex: 1.1, days: 400, lastDate: "2026-10-30" } }],
    };
    const r = evaluateCandidate(candidate, deps());
    expect(r.state).toBe("deferred");
    expect(r.stages.find((s) => s.key === "supplier")?.status).toBe("deferred");
    expect(r.stateReasons[0]).toMatch(/GTIN/);
  });

  it("sperrt gefährliche Warengruppen, bevor irgendetwas anderes geprüft wird", () => {
    const r = evaluateCandidate({ key: "x", title: "Taschenmesser", discoveredVia: "Test", demo: false, signals: [] }, deps());
    expect(r.state).toBe("blocked");
    expect(r.stages.filter((s) => s.status !== "skipped").map((s) => s.key)).toEqual(["market"]);
  });

  it("setzt nie „freigegeben“ oder „Entwurf erstellt“ – auch nicht mit einem vollständig nachgewiesenen echten Angebot", async () => {
    const realQuote = buildQuote({ id: "real-1", supplierName: "Echt GmbH", productId: "p-bottle", demo: false, pricing: { unitPrice: ok(5), shippingCost: ok(2), importCost: ok(0) } });
    const r = evaluateCandidate(await realBottle(), deps([{ ...realQuote, identity: { ...realQuote.identity, gtin: ok(DEMO_QUERIES["p-bottle"].gtin) } }]));
    expect(["blocked", "deferred"]).toContain(r.state);
    expect(r.state).not.toBe("approved");
    expect(r.state).not.toBe("draft_created");
    // Ohne belegten Marktpreis keine Marge → zurückgestellt
    expect(r.profit?.priceGross).toBeNull();
  });
});

describe("Market-Scout-Lauf", () => {
  const base = { ...deps(), runId: "test", shouldStop: () => false };

  it("entdeckt Themen aus Kategorien, filtert Nicht-Produkte und misst nur echte Kandidaten", async () => {
    const fake = fakeWikimedia();
    const run = await runMarketScan({ ...base, sources: [wikiSource(fake.fetchJson)], allowNetwork: true });
    const titles = run.results.map((r) => r.candidate.title).sort();
    expect(titles).toEqual(["Aktenordner", "Trinkflasche"]); // Liste und Begriffsklärung herausgefiltert
    expect(run.mode).toBe("live");
    expect(run.requests).toEqual({ used: 3, limit: 60 }); // 1 Kategorie + 2 Zeitreihen
    expect(run.costEur).toBe(0);
    const aktenordner = run.results.find((r) => r.candidate.title === "Aktenordner")!;
    expect(aktenordner.candidate.signals[0]).toMatchObject({ kind: "public_interest", demo: false });
    expect(aktenordner.candidate.signals[0].interest?.trend7).toBeGreaterThan(0);
  });

  it("fragt Netzwerk-Quellen ohne ausdrückliche Erlaubnis nicht ab", async () => {
    const fake = fakeWikimedia();
    const run = await runMarketScan({ ...base, sources: [wikiSource(fake.fetchJson)], allowNetwork: false });
    expect(fake.calls).toEqual([]);
    expect(run.sources[0]).toMatchObject({ status: "blocked" });
    expect(run.mode).toBe("demo");
  });

  it("fragt kostenpflichtige Quellen nie ab", async () => {
    const discover = vi.fn(async () => []);
    const paid: MarketSource = { info: { id: "paid", name: "Bezahlquelle", kind: "api", signalKind: "search_interest", paid: true, network: true }, discover, measure: vi.fn() };
    const run = await runMarketScan({ ...base, sources: [paid], allowNetwork: true });
    expect(discover).not.toHaveBeenCalled();
    expect(run.sources[0].message).toMatch(/Kostenpflichtig/);
  });

  it("hält das Abruflimit ein und lässt den Rest sichtbar „ungeprüft“", async () => {
    const fake = fakeWikimedia({ members: ["Aktenordner", "Abroller", "Anspitzer", "Aktenvernichter"] });
    const run = await runMarketScan({ ...base, sources: [wikiSource(fake.fetchJson)], allowNetwork: true, maxRequests: 3 });
    expect(fake.calls).toHaveLength(3);
    expect(run.aborted).toMatch(/Abruflimit/);
    expect(run.results.filter((r) => r.state === "unreviewed").length).toBe(3);
  });

  it("stoppt sofort beim Abbruchschalter", async () => {
    const fake = fakeWikimedia();
    const run = await runMarketScan({ ...base, sources: [wikiSource(fake.fetchJson)], allowNetwork: true, shouldStop: () => true });
    expect(run.aborted).toMatch(/Abbruchschalter/);
    expect(fake.calls).toEqual([]);
  });

  it("macht bei fehlenden Artikeln und Quellenfehlern weiter", async () => {
    const fake = fakeWikimedia({ missing: ["Trinkflasche"] });
    const run = await runMarketScan({ ...base, sources: [wikiSource(fake.fetchJson)], allowNetwork: true });
    const bottle = run.results.find((r) => r.candidate.title === "Trinkflasche")!;
    expect(bottle.candidate.signals).toEqual([]);
    expect(bottle.state).toBe("deferred");

    const broken: MarketSource = { ...wikiSource(fake.fetchJson), discover: async () => Promise.reject(new Error("Zeitüberschreitung")) };
    const run2 = await runMarketScan({ ...base, sources: [broken, createDemoMarketSource(NOW)], allowNetwork: true });
    expect(run2.errors.join(" ")).toMatch(/Zeitüberschreitung/);
    expect(run2.results.filter((r) => r.candidate.demo)).toHaveLength(5);
  });

  it("ist wiederholbar ohne Dubletten und verliert keine frühere Bewertung", async () => {
    const run1 = await runMarketScan({ ...base, runId: "r1", sources: [wikiSource(fakeWikimedia().fetchJson)], allowNetwork: true });
    const run2 = await runMarketScan({ ...base, runId: "r2", sources: [wikiSource(fakeWikimedia().fetchJson)], allowNetwork: true });
    let state = mergeRun(mergeRun(emptyMarketState(), run1), run2);
    expect(Object.keys(state.candidates).sort()).toEqual(["wiki:de.wikipedia:Aktenordner", "wiki:de.wikipedia:Trinkflasche"]);
    expect(state.candidates["wiki:de.wikipedia:Aktenordner"].runsSeen).toBe(2);
    expect(state.runs.map((r) => r.runId)).toEqual(["r1", "r2"]);

    // Ein späterer „ungeprüfter“ Eintrag überschreibt die Bewertung nicht
    const run3 = await runMarketScan({ ...base, runId: "r3", sources: [wikiSource(fakeWikimedia().fetchJson)], allowNetwork: true, maxRequests: 1 });
    state = mergeRun(state, run3);
    expect(state.candidates["wiki:de.wikipedia:Aktenordner"].latest.state).not.toBe("unreviewed");
    expect(state.candidates["wiki:de.wikipedia:Aktenordner"].runsSeen).toBe(2);
  });
});
