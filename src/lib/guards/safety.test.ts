// Regressionstests für die MVP-Sicherheitsgrenzen. Schlägt einer dieser Tests fehl, wurde eine
// Echtgeld-Sperre gelockert – das muss eine bewusste, reviewte Entscheidung sein.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAFETY_SWITCHES } from "@/lib/config/budget";
import { evaluateAutoPurchase } from "./purchase";

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [p] : [];
  });
}

describe("MVP-Sicherheitsgrenzen", () => {
  it("hat alle Sicherheitsschalter ausgeschaltet", () => {
    expect(SAFETY_SWITCHES).toEqual({
      autoPurchaseEnabled: false,
      realAdsEnabled: false,
      paidApiCallsEnabled: false,
      shopifyWriteEnabled: false,
    });
  });

  it("lässt die Sicherheitsschalter zur Laufzeit nicht verändern", () => {
    expect(Object.isFrozen(SAFETY_SWITCHES)).toBe(true);
    expect(() => {
      (SAFETY_SWITCHES as { autoPurchaseEnabled: boolean }).autoPurchaseEnabled = true;
    }).toThrow();
    expect(SAFETY_SWITCHES.autoPurchaseEnabled).toBe(false);
  });

  it("blockiert mit Standardkonfiguration auch den bestmöglichen Fall", () => {
    const d = evaluateAutoPurchase({
      paymentStatus: "paid_out",
      supplierCost: 1,
      supplierPaymentTerms: "netto30",
      creditLineAvailable: 1000,
      expectedContribution: 100,
    });
    expect(d.allowed).toBe(false);
  });

  it("enthält keine Server-Endpunkte, über die Aktionen ausgelöst werden könnten", () => {
    const files = sourceFiles(SRC);
    const endpoints = files.filter((f) => /[\\/](route|proxy|middleware)\.tsx?$/.test(f));
    const serverActions = files.filter((f) => /["']use server["']/.test(readFileSync(f, "utf8")));
    expect(endpoints).toEqual([]);
    expect(serverActions).toEqual([]);
  });

  it("macht keine Netzwerkaufrufe und liest keine Zugangsdaten", () => {
    const offenders = sourceFiles(SRC).filter((f) => /\bfetch\(|process\.env/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
