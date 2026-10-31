// Katalogkandidaten in der Market-Pipeline: Nachfrage offline (zwischengespeicherte Signale) und Dubletten-Vermeidung.
// Alle Daten sind synthetisch (nur Test); kein Netzwerk – Wikimedia wird durch eine Attrappe ersetzt.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildQuote, ok } from "@/lib/suppliers/quote-builder";
import type { ProductQuery } from "@/lib/suppliers";
import type { CatalogProduct } from "./catalog";
import { MARKET_SCAN } from "./config";
import { identityKey, type MarketCandidate, type MarketSignal } from "./model";
import { evaluateCandidate, resolveHandleConflicts, resolveOfferConflicts, runMarketScan, type CandidateResult, type EvaluationDeps } from "./pipeline";
import { scoreOpportunity } from "./score";
import { loadCachedSignals } from "./server/market-store";
import { createCatalogMarketSource, createDemoMarketSource, createWikimediaSource, SourceHttpError, type FetchJson } from "./sources";
import { emptyMarketState, mergeRun, selectCachedSignals, type MarketState } from "./state";

const NOW = new Date("2026-10-31T08:00:00Z");

/** NUR TEST: gültige Prüfziffer an eine fiktive Ziffernfolge anhängen. */
function gtin(body: string): string {
  const sum = body
    .split("")
    .map(Number)
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** NUR TEST: synthetisches Katalogprodukt. */
const catalogProduct = (id: string, o: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id,
  title: "Kabelkanal selbstklebend",
  category: "Büromaterial",
  wikiTitle: "Kabelkanal",
  salePrice: { gross: 19.9, basis: "plan", reference: "Planpreis (Test)", checkedAt: "2026-10-30" },
  variants: [{ shopSku: `${id.toUpperCase()}-1`, gtin: gtin("401234500001") }],
  listing: { handle: id, title: "Kabelkanal", descriptionHtml: "<p>Test</p>", productType: "Kabelmanagement", categoryTag: "buero" },
  ...o,
});

/** Synthetisches, frisches Wikimedia-Signal mit deutlichem Interesse. */
const signal = (retrievedAt: string, avg30 = 250): MarketSignal => ({
  sourceId: "wikimedia-pageviews",
  sourceName: "Wikipedia",
  kind: "public_interest",
  demo: false,
  retrievedAt,
  reference: "https://de.wikipedia.org/wiki/Kabelkanal",
  interest: { avg7: avg30, avg30, trend7: 0.2, trend30: 0.3, seasonalIndex: 1.1, days: 400, lastDate: retrievedAt.slice(0, 10) },
});

const baseDeps = (o: Partial<EvaluationDeps> = {}): EvaluationDeps => ({
  now: NOW,
  supplierInput: () => null,
  product: () => undefined,
  ...o,
});

/** Synthetische Wikimedia-Antworten (keine echten Abrufe). */
function fakeWikimedia(missing: string[] = []): { fetchJson: FetchJson; calls: string[] } {
  const calls: string[] = [];
  const fetchJson: FetchJson = async (url) => {
    calls.push(url);
    if (url.includes("list=categorymembers")) return { query: { categorymembers: [] } };
    if (missing.some((m) => url.includes(`/${encodeURIComponent(m)}/`))) throw new SourceHttpError(404, url);
    const items = Array.from({ length: 400 }, (_, i) => {
      const ts = new Date(Date.parse("2025-09-26T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10).replaceAll("-", "");
      return { timestamp: `${ts}00`, views: 200 };
    });
    return { items };
  };
  return { fetchJson, calls };
}

const run = (o: Partial<Parameters<typeof runMarketScan>[0]> & Pick<Parameters<typeof runMarketScan>[0], "sources">) =>
  runMarketScan({ ...baseDeps(), runId: "test", allowNetwork: false, shouldStop: () => false, clock: () => NOW, ...o });

describe("Katalogkandidaten: Nachfrage offline", () => {
  it("bewertet einen Katalogkandidaten ohne Signal weiter und stellt ihn mit MARKET_NO_DEMAND zurück", async () => {
    const r = await run({ sources: [createCatalogMarketSource({ products: [catalogProduct("kabelkanal")], invalid: [] })] });
    const [result] = r.results;
    expect(result.candidate).toMatchObject({ key: "catalog:kabelkanal", catalogId: "kabelkanal", demo: false });
    expect(result.state).toBe("deferred");
    expect(result.stages.map((s) => [s.key, s.status])).toEqual([
      ["market", "blocked"],
      ["supplier", "deferred"],
      ["profit", "skipped"],
      ["compliance", "skipped"],
      ["draft", "skipped"],
    ]);
    expect(result.reasonCodes).toEqual(["MARKET_NO_DEMAND", "IDENTITY_MISSING"]);
    expect(result.stateReasons[0]).toMatch(/--live/);
  });

  it("läuft ohne Signal durch alle Stufen, stellt aber trotzdem zurück – auch mit geeignetem Angebot", () => {
    const g = gtin("401234500001");
    const query: ProductQuery = { productId: "catalog:kabelkanal", title: "Kabelkanal", gtin: g, quantity: 1, destinationCountry: "DE", safety: { ceRequired: false } };
    const quote = buildQuote({ id: "echt-1", supplierName: "Echt GmbH", productId: query.productId, demo: false, identity: { gtin: ok(g) } });
    const candidate: MarketCandidate = { key: "catalog:kabelkanal", title: "Kabelkanal", catalogId: "kabelkanal", discoveredVia: "Test", demo: false, signals: [] };
    const r = evaluateCandidate(candidate, baseDeps({ supplierInput: () => ({ query, quotes: [quote] }) }));
    expect(r.stages.map((s) => s.key)).toEqual(["market", "supplier", "profit", "compliance", "draft"]);
    expect(r.stages.find((s) => s.key === "supplier")?.status).toBe("ok");
    expect(r.state).toBe("deferred");
    expect(r.reasonCodes).toContain("MARKET_NO_DEMAND");
  });

  it("stellt Katalogkandidaten mit schwachem Signal zurück (MARKET_LOW_DEMAND), die Kette läuft weiter", () => {
    const weak = { ...signal(NOW.toISOString(), 1), interest: { ...signal(NOW.toISOString(), 1).interest!, trend7: -0.5, trend30: -0.5, seasonalIndex: 0.2 } };
    const candidate: MarketCandidate = { key: "catalog:kabelkanal", title: "Kabelkanal", catalogId: "kabelkanal", discoveredVia: "Test", demo: false, signals: [weak] };
    const r = evaluateCandidate(candidate, baseDeps());
    expect(r.stages[0]).toMatchObject({ key: "market", status: "blocked", codes: ["MARKET_LOW_DEMAND"] });
    expect(r.stages[1]).toMatchObject({ key: "supplier", status: "deferred" });
    expect(r.state).toBe("deferred");
  });

  it("sperrt verbotene Warengruppen auch im Katalog sofort", () => {
    const candidate: MarketCandidate = { key: "catalog:messer", title: "Taschenmesser", catalogId: "messer", discoveredVia: "Test", demo: false, signals: [] };
    const r = evaluateCandidate(candidate, baseDeps());
    expect(r.state).toBe("blocked");
    expect(r.reasonCodes).toEqual(["MARKET_PROHIBITED"]);
    expect(r.stages.filter((s) => s.status !== "skipped").map((s) => s.key)).toEqual(["market"]);
  });

  it("nutzt ein zwischengespeichertes Signal, kennzeichnet es und erhöht die Unsicherheit", async () => {
    const cached = signal("2026-10-28T08:00:00Z");
    const r = await run({
      sources: [createCatalogMarketSource({ products: [catalogProduct("kabelkanal")], invalid: [] })],
      cachedSignal: (key) => (key === "catalog:kabelkanal" ? [cached] : []),
    });
    const [result] = r.results;
    expect(result.candidate.signals).toEqual([{ ...cached, cached: true }]);
    expect(result.stages[0]).toMatchObject({ key: "market", status: "ok", codes: ["MARKET_SIGNAL_CACHED"] });
    expect(result.reasonCodes).toContain("MARKET_SIGNAL_CACHED");
    expect(result.score.components.find((c) => c.key === "demand")?.detail).toMatch(/zwischengespeichert vom 2026-10-28/);
    const live = scoreOpportunity({ candidate: { ...result.candidate, signals: [cached] }, risk: result.risk.level, supplier: null, profit: null, now: NOW });
    const withCache = scoreOpportunity({ candidate: result.candidate, risk: result.risk.level, supplier: null, profit: null, now: NOW });
    expect(withCache.uncertainty).toBeCloseTo(Math.min(1, live.uncertainty + MARKET_SCAN.cachedSignalPenalty), 5);
  });

  it("gibt einem Live-Signal im selben Lauf Vorrang und misst über den Wikipedia-Artikel des Katalogprodukts", async () => {
    const fake = fakeWikimedia();
    const wiki = createWikimediaSource({ fetchJson: fake.fetchJson, now: NOW, categories: [], linkedTopics: [{ title: "Kabelkanal", catalogId: "kabelkanal" }], membersPerCategory: 5 });
    const r = await run({
      sources: [createCatalogMarketSource({ products: [catalogProduct("kabelkanal")], invalid: [] }), wiki],
      allowNetwork: true,
      cachedSignal: () => [signal("2026-10-28T08:00:00Z")],
    });
    expect(r.results).toHaveLength(1);
    const [result] = r.results;
    expect(result.candidate.key).toBe("catalog:kabelkanal");
    expect(result.candidate.discoveredVia).toBe("Lokaler Zielproduktkatalog + Wikipedia-Artikel zum Katalogprodukt");
    expect(result.candidate.signals).toHaveLength(1);
    expect(result.candidate.signals[0].cached).toBeUndefined();
    expect(fake.calls.filter((u) => u.includes("/Kabelkanal/"))).toHaveLength(1);
    expect(r.sources.map((s) => s.candidates)).toEqual([1, 1]);
  });

  it("nutzt nie zwischengespeicherte Signale für Demo-Kandidaten", async () => {
    const r = await run({ sources: [createDemoMarketSource(NOW)], cachedSignal: () => [signal("2026-10-30T08:00:00Z")] });
    for (const result of r.results) expect(result.candidate.signals.every((s) => s.demo && !s.cached)).toBe(true);
  });
});

describe("Zwischengespeicherte Signale aus dem gespeicherten Stand", () => {
  const stateWith = (signals: MarketSignal[]): MarketState => {
    const candidate: MarketCandidate = { key: "catalog:kabelkanal", title: "Kabelkanal", catalogId: "kabelkanal", discoveredVia: "Test", demo: false, signals };
    const result = evaluateCandidate(candidate, baseDeps());
    return mergeRun(emptyMarketState(), { runId: "r1", startedAt: NOW.toISOString(), finishedAt: NOW.toISOString(), mode: "live", sources: [], requests: { used: 0, limit: 0 }, costEur: 0, errors: [], results: [result] });
  };

  it("liefert nur echte Signale, die höchstens staleAfterDays alt und nicht aus der Zukunft sind", () => {
    const fresh = signal("2026-10-25T08:00:00Z");
    const stale = signal(new Date(NOW.getTime() - (MARKET_SCAN.staleAfterDays + 1) * 86_400_000).toISOString());
    const future = signal("2026-11-01T08:00:00Z");
    const demo: MarketSignal = { ...fresh, demo: true, kind: "simulated", interest: undefined, simulated: { searchTrend: 1, socialBuzz: 1, competition: 1, seasonality: 1 } };
    expect(selectCachedSignals(stateWith([fresh]), NOW).get("catalog:kabelkanal")).toEqual([{ ...fresh, cached: true }]);
    for (const s of [stale, future, demo]) expect(selectCachedSignals(stateWith([s]), NOW).size, s.retrievedAt).toBe(0);
  });

  it("vermerkt die Codes im Verlauf", () => {
    const state = stateWith([]);
    expect(state.candidates["catalog:kabelkanal"].history[0].codes).toEqual(["MARKET_NO_DEMAND", "IDENTITY_MISSING"]);
  });

  describe("lesender Zugriff auf state.json", () => {
    let dir: string | null = null;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
      dir = null;
    });

    it("bildet einen stabilen Fingerabdruck, der sich mit dem Signal ändert", () => {
      dir = mkdtempSync(join(tmpdir(), "market-"));
      const file = join(dir, "state.json");
      expect(loadCachedSignals(NOW, file)).toEqual({ signals: new Map(), sha256: null });
      writeFileSync(file, JSON.stringify(stateWith([signal("2026-10-25T08:00:00Z")])));
      const a = loadCachedSignals(NOW, file);
      expect(a.signals.size).toBe(1);
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(loadCachedSignals(NOW, file).sha256).toBe(a.sha256);
      writeFileSync(file, JSON.stringify(stateWith([signal("2026-10-26T08:00:00Z")])));
      expect(loadCachedSignals(NOW, file).sha256).not.toBe(a.sha256);
    });
  });
});

describe("Dubletten-Vermeidung im Lauf", () => {
  it("führt Katalogquelle und Wikipedia-Thema mit catalogId zu EINEM Kandidaten catalog:<id> zusammen", async () => {
    const wiki = createWikimediaSource({ fetchJson: fakeWikimedia().fetchJson, now: NOW, categories: [], linkedTopics: [{ title: "Kabelkanal", catalogId: "kabelkanal" }], membersPerCategory: 5 });
    // Reihenfolge der Quellen egal: kanonisch ist immer catalog:<id>
    const r = await run({ sources: [wiki, createCatalogMarketSource({ products: [catalogProduct("kabelkanal")], invalid: [] })], allowNetwork: true });
    expect(r.results.map((x) => x.candidate.key)).toEqual(["catalog:kabelkanal"]);
  });

  it("führt Demo-Produkt und echtes Wikipedia-Thema nie zusammen", async () => {
    const wiki = createWikimediaSource({ fetchJson: fakeWikimedia().fetchJson, now: NOW, categories: [], linkedTopics: [{ title: "Trinkflasche", productId: "p-bottle" }], membersPerCategory: 5 });
    const r = await run({ sources: [createDemoMarketSource(NOW), wiki], allowNetwork: true });
    const keys = r.results.map((x) => x.candidate.key);
    expect(keys).toContain("demo:p-bottle");
    expect(keys).toContain("wiki:de.wikipedia:Trinkflasche");
    expect(identityKey({ key: "demo:p-bottle", demo: true, productId: "p-bottle" })).not.toBe(identityKey({ key: "wiki:x", demo: false, productId: "p-bottle" }));
  });

  it("verlangt bei festen Themen genau eine Verknüpfung; Katalogverknüpfung hat Vorrang", async () => {
    const make = (linkedTopics: { title: string; productId?: string; catalogId?: string }[]) =>
      createWikimediaSource({ fetchJson: fakeWikimedia().fetchJson, now: NOW, categories: [], linkedTopics, membersPerCategory: 5 });
    expect(() => make([{ title: "X" }])).toThrow(/genau eines/);
    expect(() => make([{ title: "X", productId: "p-bottle", catalogId: "x" }])).toThrow(/genau eines/);
    const topics = await make([
      { title: "Trinkflasche", catalogId: "flasche" },
      { title: "Trinkflasche", productId: "p-bottle" },
    ]).discover({ take: () => undefined } as never);
    expect(topics).toEqual([expect.objectContaining({ catalogId: "flasche" })]);
    expect(topics[0].productId).toBeUndefined();
  });

  it("stellt ungültige Katalogeinträge mit Grund zurück, ohne sie zu bewerten", async () => {
    const r = await run({
      sources: [createCatalogMarketSource({ products: [], invalid: [{ id: "kaputt", codes: ["CATALOG_INVALID"], messages: ["salePrice fehlt."] }] })],
    });
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ state: "deferred", reasonCodes: ["CATALOG_INVALID"], stateReasons: ["Katalogeintrag ungültig: salePrice fehlt."] });
    expect(r.results[0].stages[0]).toMatchObject({ key: "market", status: "deferred" });
  });

  it("bewertet Katalogkandidaten vor nicht verknüpften Themen", async () => {
    const wiki = createWikimediaSource({
      fetchJson: async (url) => (url.includes("list=categorymembers") ? { query: { categorymembers: [{ ns: 0, title: "Aktenordner" }] } } : fakeWikimedia().fetchJson(url)),
      now: NOW,
      categories: ["Büromaterial"],
      linkedTopics: [],
      membersPerCategory: 5,
    });
    const r = await run({ sources: [wiki, createCatalogMarketSource({ products: [catalogProduct("kabelkanal")], invalid: [] })], allowNetwork: true, maxCandidates: 1 });
    // Nur das Netz-Thema zählt zum Kandidatenlimit; der Katalogkandidat kommt zuerst und kostet nichts
    expect(r.results.map((x) => [x.candidate.key, x.state])).toEqual([
      ["catalog:kabelkanal", "deferred"],
      ["wiki:de.wikipedia:Aktenordner", "deferred"],
    ]);
  });
});

describe("Nachlauf: Angebots- und Handle-Konflikte", () => {
  const result = (key: string, o: Partial<CandidateResult> = {}, demo = false): CandidateResult => {
    const candidate: MarketCandidate = { key, title: "Kabelkanal", catalogId: key.replace("catalog:", ""), discoveredVia: "Test", demo, signals: [signal(NOW.toISOString())] };
    return { ...evaluateCandidate(candidate, baseDeps()), state: "blocked", ...o };
  };
  const supplier = (offerKeys: string[]): CandidateResult["supplier"] => ({
    quoteId: "q",
    supplierName: "Echt GmbH",
    demo: false,
    perUnit: 5,
    deliveryDays: { min: 1, max: 2 },
    financingStatus: "payment_terms_confirmed",
    requiresPrefinancing: false,
    eligible: 1,
    realEligible: 1,
    openPoints: [],
    offerKeys,
  });

  it("stellt alle echten Kandidaten zurück, die dasselbe Angebot als Basis beanspruchen", () => {
    const out = resolveOfferConflicts([
      result("catalog:a", { supplier: supplier(["s::A"]) }),
      result("catalog:b", { supplier: supplier(["s::A"]) }),
      result("catalog:c", { supplier: supplier(["s::C"]) }),
      result("demo:p-x", { supplier: supplier(["s::A"]) }, true),
    ]);
    expect(out.map((r) => [r.candidate.key, r.state])).toEqual([
      ["catalog:a", "deferred"],
      ["catalog:b", "deferred"],
      ["catalog:c", "blocked"],
      ["demo:p-x", "blocked"],
    ]);
    expect(out[0].reasonCodes).toContain("OFFER_DUPLICATE_ASSIGNMENT");
    expect(out[0].stateReasons.at(-1)).toMatch(/mehreren Kandidaten/);
  });

  it("stuft nur herab: zurückgestellte bleiben zurückgestellt, ungeprüfte unverändert", () => {
    const deferred = result("catalog:a", { state: "deferred", supplier: supplier(["s::A"]) });
    const open = result("catalog:b", { state: "unreviewed", supplier: supplier(["s::A"]) });
    const out = resolveOfferConflicts([deferred, open, result("catalog:c", { supplier: supplier(["s::A"]) })]);
    // a (bereits zurückgestellt) und c beanspruchen dasselbe Angebot; der ungeprüfte Kandidat b beansprucht nichts
    expect(out.map((r) => r.state)).toEqual(["deferred", "unreviewed", "deferred"]);
    expect(out[0].reasonCodes).toContain("OFFER_DUPLICATE_ASSIGNMENT");
    expect(out[1]).toBe(open);
    // Ohne zweiten Anspruch bleibt alles unverändert
    expect(resolveOfferConflicts([open, result("catalog:c", { supplier: supplier(["s::A"]) })])[1].state).toBe("blocked");
  });

  it("stellt echte Kandidaten mit gleichem Entwurfs-Handle zurück", () => {
    const draft = (handle: string): CandidateResult["draft"] => ({ status: "dry_run_prepared", handle, title: "Kabelkanal", violations: [], wouldCreate: false, note: "Test" });
    const out = resolveHandleConflicts([result("catalog:a", { draft: draft("kabelkanal") }), result("catalog:b", { draft: draft("kabelkanal") }), result("catalog:c", { draft: draft("anderes") })]);
    expect(out.map((r) => r.state)).toEqual(["deferred", "deferred", "blocked"]);
    expect(out[0].reasonCodes).toContain("DRAFT_DUPLICATE_HANDLE");
  });
});
