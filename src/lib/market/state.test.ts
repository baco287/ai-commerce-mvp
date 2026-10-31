// Gespeicherter Stand (Paket G): idempotentes mergeRun und Schwärzung echter Kandidaten für state.json/Oberfläche.
// Alle Daten synthetisch (nur Test), kein Netzwerk.

import { afterEach, describe, expect, it } from "vitest";
import { marketEvaluationDeps } from "@/lib/data";
import { catalogCandidate, catalogProduct, realSignal, resetSupplierData, withFullRealOffer } from "@/test/market-fixtures";
import { evaluateCandidate, runMarketScan, type MarketRun } from "./pipeline";
import { createCatalogMarketSource, createDemoMarketSource } from "./sources";
import { emptyMarketState, isRedactionSafeText, mergeRun, toStoredResult } from "./state";

const NOW = new Date("2026-10-31T08:00:00Z");

afterEach(resetSupplierData);

const realResult = () => {
  withFullRealOffer();
  return evaluateCandidate(catalogCandidate([realSignal()]), { ...marketEvaluationDeps(NOW, { catalog: [catalogProduct()] }), runId: "lauf-1" });
};

const runOf = (runId: string, results: MarketRun["results"]): MarketRun => ({
  runId,
  startedAt: NOW.toISOString(),
  finishedAt: NOW.toISOString(),
  mode: "demo",
  sources: [],
  requests: { used: 0, limit: 0 },
  costEur: 0,
  errors: [],
  results,
});

describe("mergeRun – idempotent", () => {
  it("erhöht bei gleicher Lauf-ID weder runsSeen noch den Verlauf", async () => {
    const run = await runMarketScan({ ...marketEvaluationDeps(NOW), runId: "r1", sources: [createDemoMarketSource(NOW)], allowNetwork: false, shouldStop: () => false });
    const once = mergeRun(emptyMarketState(), run);
    const twice = mergeRun(once, run);
    for (const [key, c] of Object.entries(twice.candidates)) {
      expect(c.runsSeen, key).toBe(once.candidates[key].runsSeen);
      expect(c.history, key).toEqual(once.candidates[key].history);
    }
    expect(twice.runs.map((r) => r.runId)).toEqual(["r1"]);
    // Ein neuer Lauf zählt weiter
    const third = mergeRun(twice, { ...run, runId: "r2" });
    expect(Object.values(third.candidates).every((c) => c.runsSeen === 2 && c.history.length === 2)).toBe(true);
  });

  it("vermerkt den Fingerabdruck des Entwurfs im Verlauf", () => {
    const r = realResult();
    const state = mergeRun(emptyMarketState(), runOf("r1", [r]));
    expect(state.candidates["catalog:kabelkanal"].history[0].draftFingerprint).toBe(r.draft.artifact?.fingerprint);
  });
});

describe("toStoredResult – Schwärzung echter Kandidaten", () => {
  it("enthält weder Einkaufspreis, Versandkosten, Marge, Vorfinanzierung, Kreditrahmen noch Angebots-Schlüssel", () => {
    const r = realResult();
    // Vorbedingung: Das ungeschwärzte Ergebnis enthält die vertraulichen Werte
    expect(r.supplier?.offerKeys).toEqual(["lieferant-a::KK-SKU-1"]);
    expect(r.liquidity).toBeDefined();
    const stored = toStoredResult(r);
    const json = JSON.stringify(stored);
    for (const secret of ["lieferant-a::KK-SKU-1", "4.37", "4,37", "3.19", "3,19", "777", "perUnit", "contribution", "marginPercent", "upfrontPerOrder", "refundExposure", "goodsFunds", "creditCapacity", "quoteIds", "offerKeys", "draftArtifact"]) {
      expect(json, secret).not.toContain(secret);
    }
    expect(json).not.toMatch(/€/);
    expect(stored).toMatchObject({ redacted: true, supplier: null, profit: null, state: r.state, reasonCodes: r.reasonCodes });
    expect(stored).not.toHaveProperty("liquidity");
    expect(stored).not.toHaveProperty("availability");
    // Stufentexte stammen ausschließlich aus den Codes
    for (const s of stored.stages) for (const d of s.details) expect(isRedactionSafeText(d), d).toBe(true);
    expect(stored.stages.map((s) => [s.key, s.status])).toEqual(r.stages.map((s) => [s.key, s.status]));
    // Score bleibt, die Margen-Komponente verliert Wert und Text
    expect(stored.score.score).toBe(r.score.score);
    expect(stored.score.components.find((c) => c.key === "profit")).toMatchObject({ value: null, detail: "Vertraulich – nur im Journal" });
    // Entwurfs-Zusammenfassung und Signale bleiben
    expect(stored.draft.artifact).toEqual(r.draft.artifact);
    expect(stored.candidate.signals).toEqual(r.candidate.signals);
  });

  it("speichert über mergeRun nur die geschwärzte Form", () => {
    const r = realResult();
    const state = mergeRun(emptyMarketState(), runOf("r1", [r]));
    const json = JSON.stringify(state);
    expect(json).not.toContain("lieferant-a::KK-SKU-1");
    expect(json).not.toMatch(/€/);
    expect(state.candidates["catalog:kabelkanal"].latest.redacted).toBe(true);
  });

  it("lässt Demo-Kandidaten unverändert (nur ohne Artefakt)", async () => {
    const run = await runMarketScan({
      ...marketEvaluationDeps(NOW),
      runId: "r1",
      sources: [createDemoMarketSource(NOW), createCatalogMarketSource({ products: [], invalid: [] })],
      allowNetwork: false,
      shouldStop: () => false,
    });
    for (const r of run.results) {
      const stored = toStoredResult(r);
      const { draftArtifact: _artifact, ...rest } = r;
      void _artifact;
      expect(stored).toEqual(rest);
    }
  });
});
