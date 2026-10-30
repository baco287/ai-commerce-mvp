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

  // Netzwerk und Zugangsdaten sind nur an genau diesen Stellen erlaubt (Shopify, nur lesend).
  // Jede neue Stelle muss hier bewusst eingetragen werden.
  const NETWORK_ALLOWED = ["lib/shopify/server/auth.ts", "lib/shopify/server/admin-client.ts"];
  const ENV_ALLOWED = ["lib/shopify/server/config.ts"];
  const rel = (f: string) => f.slice(SRC.length + 1).replaceAll("\\", "/");

  it("macht Netzwerkaufrufe nur im serverseitigen Shopify-Connector", () => {
    const network = /\bfetch\b|XMLHttpRequest|\baxios\b|node:https?|from ["']https?["']|\bWebSocket\b/;
    const offenders = sourceFiles(SRC)
      .filter((f) => network.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders.sort()).toEqual([...NETWORK_ALLOWED].sort());
  });

  it("liest Zugangsdaten nur in der Shopify-Konfiguration", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => /process\.env/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual(ENV_ALLOWED);
  });

  it("hält den Shopify-Connector vom Browser fern", () => {
    const files = sourceFiles(SRC);
    const serverModules = files.filter((f) => /[\\/]lib[\\/]shopify[\\/]server[\\/]/.test(f));
    expect(serverModules.length).toBeGreaterThan(0);
    for (const f of serverModules) expect(readFileSync(f, "utf8"), rel(f)).toMatch(/^(\/\/.*\n|\s)*import "server-only";/);

    const clientFiles = files.filter((f) => /^["']use client["']/m.test(readFileSync(f, "utf8")));
    for (const f of clientFiles) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/lib\/shopify\/server|process\.env/);
  });
});
