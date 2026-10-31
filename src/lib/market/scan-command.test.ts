// Befehl market:scan (Paket H): Argumente, Exit-Code 2 und Konsolenausgabe ohne Beträge echter Kandidaten.
// Alle Daten synthetisch (nur Test), kein Netzwerk.

import { afterEach, describe, expect, it } from "vitest";
import { marketEvaluationDeps } from "@/lib/data";
import { catalogCandidate, catalogProduct, realOffer, realSignal, resetSupplierData, withFullRealOffer } from "@/test/market-fixtures";
import { testSupplierData } from "@/test/setup";
import { evaluateCandidate, runMarketScan } from "./pipeline";
import { defaultRunId, EXIT_CODES, formatCandidateLine, parseScanArgs } from "./scan-command";
import { createDemoMarketSource } from "./sources";

const SYSTEM_NOW = new Date("2026-10-31T12:00:00Z");
afterEach(resetSupplierData);

describe("parseScanArgs", () => {
  it("liest Schalter und Optionen", () => {
    const r = parseScanArgs(["--save", "--strict", "--now", "2026-10-19T12:00:00Z", "--run-id", "abnahme", "--limit", "3"], SYSTEM_NOW);
    expect(r).toEqual({
      ok: true,
      args: { live: false, save: true, status: false, strict: true, now: new Date("2026-10-19T12:00:00Z"), runId: "abnahme", limit: 3, requests: null },
    });
  });

  it("lehnt --now in der Zukunft, --now mit --live und ungültige Werte ab (Exit 2)", () => {
    const errors = (args: string[]) => {
      const r = parseScanArgs(args, SYSTEM_NOW);
      return r.ok ? [] : r.errors;
    };
    expect(errors(["--now", "2026-11-01T00:00:00Z"]).join(" ")).toMatch(/nach der Systemzeit/);
    expect(errors(["--now", "2026-10-19T12:00:00Z", "--live"]).join(" ")).toMatch(/schließen sich aus/);
    expect(errors(["--now", "19.10.2026"]).join(" ")).toMatch(/UTC/);
    expect(errors(["--now"]).length).toBe(1);
    expect(errors(["--run-id", "../x"]).join(" ")).toMatch(/--run-id/);
    expect(errors(["--run-id", "Gross"]).join(" ")).toMatch(/--run-id/);
    expect(errors(["--limit", "0"]).join(" ")).toMatch(/--limit/);
    expect(errors(["--irgendwas"]).join(" ")).toMatch(/Unbekannte Option/);
    expect(EXIT_CODES.usage).toBe(2);
  });

  it("bildet Lauf-IDs aus der Uhrzeit (Simulation mit eigenem Präfix)", () => {
    expect(defaultRunId(new Date("2026-10-19T12:00:00Z"), true)).toBe("sim-2026-10-19t12-00-00-000z");
    expect(defaultRunId(SYSTEM_NOW, false)).toMatch(/^run-[a-z0-9-]+$/);
  });
});

describe("formatCandidateLine", () => {
  it("zeigt für echte Kandidaten keinen €-Betrag zu Einkauf, Versand, Vorfinanzierung oder Marge", () => {
    withFullRealOffer();
    const r = evaluateCandidate(catalogCandidate([realSignal()]), marketEvaluationDeps(new Date("2026-10-31T08:00:00Z"), { catalog: [catalogProduct()] }));
    const text = formatCandidateLine(r);
    expect(text).not.toMatch(/€/);
    expect(text).not.toMatch(/4,37|4\.37|3,19|3\.19|777|lieferant-a::/);
    expect(text).toMatch(/siehe Journal/);
    expect(text).toMatch(/\[.*COMPLIANCE_HUMAN_REVIEW.*\]/);
    expect(text).toMatch(/Liquidität: .* · Kapazität: 0 offene Bestellungen finanzierbar/);
    expect(text).toMatch(/Artefakt drafts\/catalog_kabelkanal\.[0-9a-f]{12}\.json/);
  });

  it("meldet Vorkasse ohne Mittelnachweis als „0 offene vorfinanzierte Bestellungen – Mittel unbelegt“", () => {
    const o = realOffer({ paymentTerms: { kind: "prepayment" } });
    withFullRealOffer();
    testSupplierData.store = { ...testSupplierData.store, offers: { [o.key]: o } };
    testSupplierData.evidence = testSupplierData.evidence.map((e) => (e.field === "payment.terms" ? { ...e, value: { kind: "prepayment" } } : e));
    const r = evaluateCandidate(catalogCandidate([realSignal()]), marketEvaluationDeps(new Date("2026-10-31T08:00:00Z"), { catalog: [catalogProduct()] }));
    const text = formatCandidateLine(r);
    expect(text).toMatch(/0 offene vorfinanzierte Bestellungen – Mittel unbelegt/);
    expect(text).not.toMatch(/€/);
  });

  it("zeigt für Demo-Kandidaten die (fiktiven) Preise", async () => {
    const now = new Date("2026-10-19T12:00:00Z");
    const run = await runMarketScan({ ...marketEvaluationDeps(now), runId: "r", sources: [createDemoMarketSource(now)], allowNetwork: false, shouldStop: () => false });
    const withSupplier = run.results.filter((r) => r.supplier);
    expect(withSupplier.length).toBeGreaterThan(0);
    for (const r of withSupplier) expect(formatCandidateLine(r)).toMatch(/\[DEMO\][\s\S]*Kalkulationsbasis: .*\d+,\d{2} € je Stück/);
  });
});
