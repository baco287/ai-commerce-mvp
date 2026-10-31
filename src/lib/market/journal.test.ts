// Entscheidungsprotokoll (Paket G): Determinismus, Eingabe-Fingerabdruck, Vorzustand, globale Sperrgründe.
// Alle Daten synthetisch (nur Test), kein Netzwerk.

import { afterEach, describe, expect, it } from "vitest";
import { marketEvaluationDeps } from "@/lib/data";
import { catalogProduct, realSignal, resetSupplierData, withFullRealOffer } from "@/test/market-fixtures";
import { buildJournal, configSha256, inputFingerprint, journalText, runInputs, type JournalCandidate, type RunInputs } from "./journal";
import { runMarketScan } from "./pipeline";
import { createCatalogMarketSource, createDemoMarketSource } from "./sources";
import { emptyMarketState, mergeRun } from "./state";

const NOW = new Date("2026-10-19T12:00:00Z");

afterEach(resetSupplierData);

const parts = (): Omit<RunInputs, "fingerprint"> => ({
  offerStore: { importIds: ["imp-1"], fileSha256: ["a".repeat(64)] },
  evidenceSha256: "e".repeat(64),
  catalogSha256: null,
  cachedSignalsSha256: null,
  configSha256: configSha256(),
  appVersion: "0.1.0",
});

const demoRun = (runId = "lauf-1") =>
  runMarketScan({
    ...marketEvaluationDeps(NOW),
    runId,
    clockOverride: true,
    sources: [createDemoMarketSource(NOW)],
    allowNetwork: false,
    shouldStop: () => false,
    clock: () => NOW,
  });

describe("Journal", () => {
  it("ergibt für gleichen Lauf und gleiche Eingaben byte-gleiche Einträge", async () => {
    const a = journalText(buildJournal(await demoRun(), runInputs(parts()), emptyMarketState(), { clockOverride: true }));
    const b = journalText(buildJournal(await demoRun(), runInputs(parts()), emptyMarketState(), { clockOverride: true }));
    expect(a).toBe(b);
    const lines = a.trim().split("\n").map((l) => JSON.parse(l) as { type: string });
    expect(lines[0].type).toBe("run_start");
    expect(lines.at(-1)?.type).toBe("run_end");
    expect(lines.filter((l) => l.type === "candidate")).toHaveLength(5);
  });

  it("ändert den Eingabe-Fingerabdruck bei geänderten Nachweisen oder zwischengespeicherten Signalen", () => {
    const base = inputFingerprint(parts());
    expect(inputFingerprint({ ...parts(), evidenceSha256: "f".repeat(64) })).not.toBe(base);
    expect(inputFingerprint({ ...parts(), cachedSignalsSha256: "c".repeat(64) })).not.toBe(base);
    expect(inputFingerprint({ ...parts(), catalogSha256: "k".repeat(64) })).not.toBe(base);
    expect(inputFingerprint(parts())).toBe(base);
    expect(runInputs(parts()).fingerprint).toBe(base);
  });

  it("nimmt den Vorzustand aus dem gespeicherten Stand und nennt die globalen Sperrgründe", async () => {
    const first = await demoRun("lauf-1");
    const previous = mergeRun(emptyMarketState(), first);
    const entries = buildJournal(await demoRun("lauf-2"), runInputs(parts()), previous);
    const start = entries[0];
    expect(start.type === "run_start" && start.globalBlockers).toEqual(["TAX_UNCONFIRMED", "FUNDS_UNVERIFIED"]);
    expect(start.type === "run_start" && start.mode).toBe("offline");
    const candidates = entries.filter((e): e is JournalCandidate => e.type === "candidate");
    for (const c of candidates) expect(c.previousState, c.key).toBe(previous.candidates[c.key].latest.state);
    const fresh = buildJournal(first, runInputs(parts()), emptyMarketState()).filter((e): e is JournalCandidate => e.type === "candidate");
    expect(fresh.every((c) => c.previousState === null)).toBe(true);
  });

  it("protokolliert vertrauliche Werte echter Kandidaten – nur hier – samt Was-wäre-wenn-Umlaufkapital", async () => {
    withFullRealOffer();
    const run = await runMarketScan({
      ...marketEvaluationDeps(new Date("2026-10-31T08:00:00Z"), { catalog: [catalogProduct()] }),
      runId: "lauf-echt",
      sources: [createCatalogMarketSource({ products: [catalogProduct()], invalid: [] })],
      allowNetwork: false,
      shouldStop: () => false,
      cachedSignal: () => [realSignal()],
    });
    const [c] = buildJournal(run, runInputs(parts()), emptyMarketState()).filter((e): e is JournalCandidate => e.type === "candidate");
    expect(c).toMatchObject({ key: "catalog:kabelkanal", identityKey: "real|c:kabelkanal", demo: false, clockOverride: false });
    expect(c.supplier?.offerKeys).toEqual(["lieferant-a::KK-SKU-1"]);
    expect(c.supplier?.supplierId).toBe("lieferant-a");
    expect(c.economics?.perUnitWorstCase).toBeGreaterThan(0);
    expect(c.liquidity?.securedWithoutPrefinancing).toBe(false);
    expect(c.liquidity?.workingCapitalWhatIf).toBe(0); // Zahlungsziel: nichts vorzustrecken
    expect(c.draft.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("schreibt beim Abbruch durch STOP immer ein run_end mit Grund", async () => {
    let calls = 0;
    const run = await runMarketScan({
      ...marketEvaluationDeps(NOW),
      runId: "lauf-stop",
      sources: [createDemoMarketSource(NOW)],
      allowNetwork: false,
      shouldStop: () => calls++ > 1,
      clock: () => NOW,
    });
    const end = buildJournal(run, runInputs(parts()), emptyMarketState()).at(-1)!;
    expect(end).toMatchObject({ type: "run_end", aborted: expect.stringMatching(/Abbruchschalter/) });
  });
});
