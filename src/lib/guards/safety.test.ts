// Regressionstests für die MVP-Sicherheitsgrenzen. Schlägt einer dieser Tests fehl, wurde eine
// Echtgeld-Sperre gelockert – das muss eine bewusste, reviewte Entscheidung sein.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BUDGET, FUNDING, SAFETY_SWITCHES } from "@/lib/config/budget";
import { goodsFunds } from "@/lib/suppliers/liquidity";
import { NETWORK_BLOCKED_MESSAGE } from "@/test/setup";
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
  it("hat alle Echtgeld-Schalter ausgeschaltet; Shopify-Schreibzugriff ist bewusst freigegeben", () => {
    expect(SAFETY_SWITCHES).toEqual({
      autoPurchaseEnabled: false,
      realAdsEnabled: false,
      paidApiCallsEnabled: false,
      // Freigegeben am 31.10.2026 – nur die Positivliste in lib/shopify/write-operations.ts (siehe Tests dort).
      shopifyWriteEnabled: true,
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
  // test/setup.ts nennt fetch/WebSocket und SHOPIFY_-Variablen nur, um sie in Tests zu SPERREN bzw. zu entfernen.
  // lib/market/server/wikimedia-client.ts: lesende GET-Anfragen an zwei Wikimedia-Hosts (kostenlose öffentliche Daten),
  // nur im Befehl `npm run market:scan -- --live` – siehe Test „hält den Market Scout …“ unten.
  const NETWORK_ALLOWED = ["lib/shopify/server/auth.ts", "lib/shopify/server/admin-client.ts", "lib/market/server/wikimedia-client.ts", "test/setup.ts"];
  const ENV_ALLOWED = ["lib/shopify/server/config.ts", "test/setup.ts"];
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
    expect(offenders.sort()).toEqual([...ENV_ALLOWED].sort());
  });

  // Befehle außerhalb von src/ (z. B. scripts/shopify-sync.ts) – gleiche Regeln, Pfade relativ zum Projekt.
  const ROOT = join(SRC, "..");
  const SCRIPTS = join(ROOT, "scripts");
  const allFiles = () => [...sourceFiles(SRC), ...sourceFiles(SCRIPTS)];
  const fromRoot = (f: string) => f.slice(ROOT.length + 1).replaceAll("\\", "/");

  it("definiert Schreib-Operationen nur an einer Stelle (src/lib/shopify/graphql.ts) – auch anonyme", () => {
    const offenders = allFiles()
      .filter((f) => /\bmutation\b\s*[A-Za-z_({]/.test(readFileSync(f, "utf8")))
      .map(fromRoot);
    expect(offenders).toEqual(["src/lib/shopify/graphql.ts"]);
  });

  it("nutzt den Shopify-Schreib-Client nur im Befehl shopify:sync – nie im Dashboard, in keiner Importform", () => {
    // Jede Erwähnung zählt (benannter, Namespace-, dynamischer Import, Re-Export).
    const users = allFiles()
      .filter((f) => /\bcreateGuardedWriteClient\b/.test(readFileSync(f, "utf8")))
      .map(fromRoot)
      .sort();
    expect(users).toEqual(["scripts/shopify-sync.ts", "src/lib/shopify/server/admin-client.ts"]);
    // Dashboard-Code (Seiten, Komponenten) darf den Admin-Client gar nicht direkt einbinden.
    const dashboard = sourceFiles(SRC)
      .filter((f) => /[\\/](app|components)[\\/]/.test(f))
      .filter((f) => /server\/admin-client/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(dashboard).toEqual([]);
  });

  it("macht in Befehlen (scripts/) weder eigene Netzwerkaufrufe noch liest es Zugangsdaten direkt", () => {
    const network = /\bfetch\b|XMLHttpRequest|\baxios\b|node:https?|\bWebSocket\b/;
    const offenders = sourceFiles(SCRIPTS)
      .filter((f) => network.test(readFileSync(f, "utf8")) || /process\.env/.test(readFileSync(f, "utf8")))
      .map(fromRoot);
    expect(offenders).toEqual([]);
  });

  it("bietet auf der Lieferanten-Seite keine Bestellung, Freigabe oder Shopify-Änderung an", () => {
    const files = sourceFiles(SRC).filter((f) => /[\\/](app[\\/]lieferanten|components[\\/]suppliers)[\\/]/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const code = readFileSync(f, "utf8");
      expect(code, rel(f)).not.toMatch(/["']use (client|server)["']/);
      expect(code, rel(f)).not.toMatch(/<button|<form|onClick|formAction/);
      expect(code, rel(f)).not.toMatch(/lib\/shopify\/server|admin-client|sync-status/);
      expect(code, rel(f)).not.toMatch(/\b(bestellen|jetzt kaufen|in den warenkorb)\b/i);
    }
  });

  it("hält den Market Scout in seinen Grenzen: nur lesende Wikimedia-Abrufe, kein Shopify-Schreiben, kein Einkauf, keine Freigabe", () => {
    const marketFiles = [...sourceFiles(join(SRC, "lib", "market")), join(SCRIPTS, "market-scan.ts")];
    expect(marketFiles.length).toBeGreaterThan(8);
    for (const f of marketFiles) {
      const code = readFileSync(f, "utf8");
      // Shopify nur lesend über die bestehende Dry-Run-Pipeline – nie Admin-Client, Schreib-Client oder GraphQL
      // Neu: auch keine Reparatur- oder Sync-Planung und nicht mehr die Dashboard-Pipeline (der Store Manager prüft direkt
      // mit den Guards und baut den Entwurf über buildDraftInput)
      expect(code, fromRoot(f)).not.toMatch(/lib\/shopify\/server|admin-client|createGuardedWriteClient|shopify\/graphql|write-operations/);
      expect(code, fromRoot(f)).not.toMatch(/shopify\/repair|shopify\/sync|shopify-sync|shopify\/pipeline/);
      expect(code, fromRoot(f)).not.toMatch(/evaluateAutoPurchase|toPurchaseGuardTerms|\b(placeOrder|createOrder|submitOrder|purchase|pay)\s*\(/);
      expect(code, fromRoot(f)).not.toMatch(/process\.env/);
      // Der Agent setzt nie selbst „freigegeben“ oder „Entwurf erstellt“
      expect(code, fromRoot(f)).not.toMatch(/state:\s*["'](approved|draft_created)["']/);
    }
    // Netzwerk nur im Wikimedia-Client, und der ist serverseitig
    const withNetwork = marketFiles.filter((f) => /\bfetch\b|XMLHttpRequest|\baxios\b|node:https?|\bWebSocket\b/.test(readFileSync(f, "utf8"))).map(fromRoot);
    expect(withNetwork).toEqual(["src/lib/market/server/wikimedia-client.ts"]);
    for (const f of sourceFiles(join(SRC, "lib", "market", "server"))) {
      expect(readFileSync(f, "utf8"), fromRoot(f)).toMatch(/^(\/\/.*\n|\s)*import "server-only";/);
    }
    // Dashboard bindet den Netzwerk-Client nie ein und bietet keine Aktion an
    const ui = sourceFiles(SRC).filter((f) => /[\\/](app|components)[\\/]/.test(f));
    for (const f of ui) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/wikimedia-client|runMarketScan\(.*allowNetwork:\s*true/);
    for (const f of sourceFiles(join(SRC, "components", "market"))) {
      const code = readFileSync(f, "utf8");
      expect(code, rel(f)).not.toMatch(/["']use (client|server)["']|<button|<form|onClick|formAction/);
    }
  });

  it("übergibt Entwurfs-Artefakte in Phase 1 an nichts: kein Shopify-Code, kein Dashboard, nur der Befehl market:scan schreibt sie", () => {
    // Keine Datei unter lib/shopify und kein shopify:sync kennt die Artefakte – es gibt keine Übergabe vor Phase 2.
    const shopifyFiles = [...sourceFiles(join(SRC, "lib", "shopify")), join(SCRIPTS, "shopify-sync.ts")];
    expect(shopifyFiles.length).toBeGreaterThan(5);
    for (const f of shopifyFiles) {
      expect(readFileSync(f, "utf8"), fromRoot(f)).not.toMatch(/MARKET_DRAFTS_DIR|drafts\/|DraftArtifact|draftArtifact|store-manager|writeDraftArtifact/);
    }
    // Dashboard-Code liest weder das Artefakt-Verzeichnis noch Artefakte und schreibt keine
    const ui = sourceFiles(SRC).filter((f) => /[\\/](app|components)[\\/]/.test(f));
    for (const f of ui) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/MARKET_DRAFTS_DIR|writeDraftArtifact|draftArtifact\b/);
    // Artefakte und Journal schreibt nur der Speicher (market-store.ts), aufgerufen nur vom Ablauf des Befehls
    // (scan-runner.ts, mit --save), und den startet nur der Befehl market:scan bzw. pipeline:dry-run.
    const artifactWriters = allFiles()
      .filter((f) => /\b(writeDraftArtifact|writeJournal|acquireRunLock)\b/.test(readFileSync(f, "utf8")))
      .map(fromRoot)
      .sort();
    expect(artifactWriters).toEqual(["src/lib/market/server/market-store.ts", "src/lib/market/server/scan-runner.ts"]);
    const runners = allFiles()
      .filter((f) => /\brunScanCommand\b/.test(readFileSync(f, "utf8")))
      .map(fromRoot)
      .sort();
    expect(runners).toEqual(["scripts/market-scan.ts", "src/lib/market/server/scan-runner.ts"]);
    // Das Artefakt sagt nie „würde angelegt“ oder „freigegeben“
    const storeManager = readFileSync(join(SRC, "lib", "market", "store-manager.ts"), "utf8");
    expect(storeManager).not.toMatch(/wouldCreate:\s*true|status:\s*["'](approved|draft_created|freigegeben)["']/);
  });

  it("hält den Lieferanten-Import lokal: kein Shopify, kein Netzwerk, keine Bestellung", () => {
    const importFiles = [
      ...sourceFiles(join(SRC, "lib", "suppliers", "import")),
      ...sourceFiles(join(SRC, "lib", "suppliers", "server")),
      join(SCRIPTS, "supplier-import.ts"),
    ];
    expect(importFiles.length).toBeGreaterThan(5);
    for (const f of importFiles) {
      const code = readFileSync(f, "utf8");
      expect(code, fromRoot(f)).not.toMatch(/lib\/shopify|admin-client|graphql|createGuardedWriteClient/);
      expect(code, fromRoot(f)).not.toMatch(/\bfetch\b|XMLHttpRequest|\baxios\b|node:https?|node:net|\bWebSocket\b|process\.env/);
      expect(code, fromRoot(f)).not.toMatch(/evaluateAutoPurchase|\b(placeOrder|createOrder|submitOrder|purchase|pay)\s*\(/);
    }
    // Dateien schreiben nur die lokalen Speicher (Sync-Status, Lieferantenangebote, Market Scout) – unter .data/ (von Git
    // ignoriert). Paket G: Die Erkennung umfasst auch Streams, Kopien, Löschen und Temp-Verzeichnisse. Vor der
    // Verschärfung gab es außerhalb von Tests keine weiteren Treffer; market-store.ts nutzt neu unlinkSync (Lauf-Sperre).
    const writers = allFiles()
      .filter((f) =>
        /\b(writeFileSync|renameSync|appendFileSync|writeFile|createWriteStream|copyFileSync|openSync|unlinkSync|rmSync|mkdtempSync)\b/.test(readFileSync(f, "utf8")),
      )
      .map(fromRoot);
    expect(writers.sort()).toEqual(["src/lib/market/server/market-store.ts", "src/lib/shopify/server/sync-state.ts", "src/lib/suppliers/server/offer-store.ts"]);
    expect(readFileSync(join(SRC, "lib", "suppliers", "server", "offer-store.ts"), "utf8")).toMatch(/^(\/\/.*\n|\s)*import "server-only";/);
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8")).toMatch(/^\.data\/$/m);
  });

  it("sperrt in Tests jeden echten Netzwerkzugriff – auch einen Shopify-Schreib-Client", async () => {
    await expect(fetch("https://example.myshopify.com/admin/api/graphql.json")).rejects.toThrow(NETWORK_BLOCKED_MESSAGE);
    expect(Object.keys(process.env).filter((k) => k.startsWith("SHOPIFY_"))).toEqual([]);
    const { createGuardedWriteClient } = await import("@/lib/shopify/server/admin-client");
    const fetchMock = vi.mocked(fetch);
    const before = fetchMock.mock.calls.length;
    await expect(
      createGuardedWriteClient({ storeDomain: "test.myshopify.com", clientId: "test", clientSecret: "test" }, { writeEnabled: true }),
    ).rejects.toThrow();
    // Der einzige Versuch (Token-Abruf) ist am gesperrten fetch gescheitert – keine Anfrage hat das Netz erreicht.
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it("liest den Zielproduktkatalog nur – serverseitig, ohne Schreibzugriff, nie aus Dashboard-Code", () => {
    const store = join(SRC, "lib", "market", "server", "catalog-store.ts");
    const code = readFileSync(store, "utf8");
    expect(code).toMatch(/^(\/\/.*\n|\s)*import "server-only";/);
    expect(code).not.toMatch(/\b(writeFileSync|renameSync|appendFileSync|writeFile|unlinkSync|copyFileSync|rmSync|createWriteStream|openSync|mkdirSync)\b/);
    const ui = sourceFiles(SRC).filter((f) => /[\\/](app|components)[\\/]/.test(f));
    for (const f of ui) expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/catalog-store|loadCatalog|loadCachedSignals/);
  });

  it("vergleicht GTINs im Supplier Scout nur über den GTIN-Kern; der Demo-Abgleich bleibt auf den Demo-Weg beschränkt", () => {
    const supplierFiles = sourceFiles(join(SRC, "lib", "suppliers"));
    const direct = supplierFiles.filter((f) => /\bgtin\s*===|===\s*[\w.?]*gtin\b/i.test(readFileSync(f, "utf8"))).map(rel);
    expect(direct).toEqual([]);
    const demoMatch = allFiles()
      .filter((f) => /\bsameDemoGtin\b/.test(readFileSync(f, "utf8")))
      .map(fromRoot);
    for (const f of demoMatch) expect(["src/lib/suppliers/identity.ts", "src/lib/suppliers/import/adapter.ts"], f).toContain(f);
  });

  it("gleicht Pflichtunterlagen nur über feste Dokumenttypen ab – nie über Freitext", () => {
    // Freitext-Unterlagen (`safety.documents`) dienen nur der Anzeige; der Abgleich liegt einmal in documents.ts.
    const freeText = sourceFiles(join(SRC, "lib"))
      .filter((f) =>
        /safety\.documents\.(some|find|filter|every|includes|indexOf)\(|documents\.(some|find|filter|every)\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.(startsWith|includes)\(/.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map(rel);
    expect(freeText).toEqual([]);
    // Supplier-Code bindet den Market Scout höchstens als Typ ein (keine Laufzeit-Abhängigkeit, keine Zyklen)
    const supplierFiles = sourceFiles(join(SRC, "lib", "suppliers"));
    const runtimeMarket = supplierFiles.filter((f) => /^import\s+(?!type\b)[^;]*from\s+["']@\/lib\/market/m.test(readFileSync(f, "utf8"))).map(rel);
    expect(runtimeMarket).toEqual([]);
  });

  it("behauptet ohne Kontonachweis keine verfügbaren Mittel", () => {
    expect(FUNDING.verified).toBe(false);
  });

  it("meldet nie „vorfinanzierungsfrei gesichert“ und plant ohne Mittel für Wareneinkauf keine Bestellung ein", () => {
    // Phase 1: securedWithoutPrefinancing ist im Typ hart false; kein Code darf es auf true setzen.
    const setsTrue = sourceFiles(join(SRC, "lib")).filter((f) => /securedWithoutPrefinancing\s*[:=]\s*true/.test(readFileSync(f, "utf8"))).map(rel);
    expect(setsTrue).toEqual([]);
    // Mit dem heutigen Budget gibt es keine Mittel für Wareneinkauf → keine Kapazität, keine geplante Menge
    expect(goodsFunds()).toBe(0);
    expect(goodsFunds(BUDGET, { ...FUNDING, verified: true })).toBe(0);
    // Die Liquidität wird nicht aus Shopify-, Einkaufs- oder Schreibmodulen gespeist und ruft keine Einkaufssperre auf
    const liquidity = readFileSync(join(SRC, "lib", "suppliers", "liquidity.ts"), "utf8");
    expect(liquidity).not.toMatch(/lib\/shopify|guards\/purchase|evaluateAutoPurchase|process\.env|\bfetch\b/);
  });

  it("rendert jede Seite mit lokalen Daten dynamisch und liest weder Journal noch Katalog noch Simulationen im Dashboard", () => {
    // Paket I: Seiten, die @/lib/data importieren, rendern je Anfrage – nie beim Build mit Daten aus .data/ vorgerendert.
    const pages = sourceFiles(join(SRC, "app")).filter((f) => /[\\/]page\.tsx$/.test(f));
    const dataPages = pages.filter((f) => /from ["']@\/lib\/data["']/.test(readFileSync(f, "utf8")));
    expect(dataPages.length).toBeGreaterThanOrEqual(6);
    for (const f of dataPages) expect(readFileSync(f, "utf8"), rel(f)).toMatch(/await connection\(\)/);
    // Dashboard-Code liest weder Journal, Katalog, Simulationsverzeichnis noch den Ablauf des Befehls
    const ui = sourceFiles(SRC).filter((f) => /[\\/](app|components)[\\/]/.test(f));
    for (const f of ui) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/market\/journal|catalog-store|scan-runner|MARKET_JOURNAL_DIR|MARKET_DRAFTS_DIR|MARKET_SIMULATED_DIR|buildJournal|writeJournal/);
    }
    // Die Datenschicht der Oberfläche liest das Journal nie
    expect(readFileSync(join(SRC, "lib", "data.ts"), "utf8")).not.toMatch(/journal|MARKET_JOURNAL_DIR|MARKET_DRAFTS_DIR|MARKET_SIMULATED_DIR|scan-runner/i);
  });

  it("sperrt Build und Start bei echten Daten in .data/ und bindet den Entwicklungsserver nur lokal", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.prebuild).toMatch(/scripts\/check-public-data\.ts/);
    expect(pkg.scripts.prestart).toMatch(/scripts\/check-public-data\.ts/);
    expect(pkg.scripts.dev).toMatch(/-H 127\.0\.0\.1/);
    // Der Dry-Run-Alias speichert nur über market:scan (kein eigener Orchestrator, kein Shopify)
    expect(pkg.scripts["pipeline:dry-run"]).toMatch(/scripts\/market-scan\.ts --save$/);
    const check = readFileSync(join(SCRIPTS, "check-public-data.ts"), "utf8");
    expect(check).not.toMatch(/\b(writeFileSync|renameSync|appendFileSync|writeFile|createWriteStream|copyFileSync|unlinkSync|rmSync|mkdirSync)\b|process\.env|\bfetch\b/);
  });

  it("schreibt die Liste der Shopify-Schreiboperationen fest – jede Erweiterung ist eine bewusste Entscheidung", () => {
    const code = readFileSync(join(SRC, "lib", "shopify", "write-operations.ts"), "utf8");
    const union = code.slice(code.indexOf("export type WriteOperation"), code.indexOf("export interface WriteRequest"));
    const kinds = [...union.matchAll(/kind:\s*"([a-z-]+)"/g)].map((m) => m[1]).sort();
    expect(kinds).toEqual(["add-image", "create-draft", "track-inventory", "zero-demo-stock"]);
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
