import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSyncState, recordSync, successfulParts } from "./sync-state";

const dirs: string[] = [];
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "sync-state-"));
  dirs.push(dir);
  return join(dir, "sub", "state.json");
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Letzte erfolgreiche Synchronisierung", () => {
  it("ist ohne Datei leer", async () => {
    expect(await loadSyncState(tempFile())).toEqual({});
  });

  it("merkt sich Produkte und Bestand getrennt", async () => {
    const file = tempFile();
    await recordSync({ productsAt: "2026-10-31T08:00:00.000Z", productCount: 5 }, file);
    await recordSync({ productsAt: "2026-10-31T09:00:00.000Z", productCount: 6, inventoryAt: "2026-10-31T09:00:00.000Z", inventoryVariantCount: 9 }, file);
    await recordSync({ productsAt: "2026-10-31T10:00:00.000Z", productCount: 6 }, file);
    expect(await loadSyncState(file)).toEqual({
      productsAt: "2026-10-31T10:00:00.000Z",
      productCount: 6,
      inventoryAt: "2026-10-31T09:00:00.000Z",
      inventoryVariantCount: 9,
    });
  });

  it("übernimmt aus der Datei nur bekannte, gültige Felder", async () => {
    const file = tempFile();
    await recordSync({}, file);
    writeFileSync(file, JSON.stringify({ productsAt: "kein Datum", productCount: -1, token: "shpat_x", inventoryAt: "2026-10-31T09:00:00.000Z" }));
    expect(await loadSyncState(file)).toEqual({ inventoryAt: "2026-10-31T09:00:00.000Z" });
  });

  it("überschreibt einen neueren Erfolg nicht mit einem älteren", async () => {
    const file = tempFile();
    await recordSync({ productsAt: "2026-10-31T10:00:00.000Z", productCount: 6, inventoryAt: "2026-10-31T10:00:00.000Z", inventoryVariantCount: 9 }, file);
    await recordSync({ productsAt: "2026-10-31T09:00:00.000Z", productCount: 5, inventoryAt: "2026-10-31T09:00:00.000Z", inventoryVariantCount: 1 }, file);
    expect(await loadSyncState(file)).toEqual({
      productsAt: "2026-10-31T10:00:00.000Z",
      productCount: 6,
      inventoryAt: "2026-10-31T10:00:00.000Z",
      inventoryVariantCount: 9,
    });
  });

  it("verliert bei gleichzeitigen Aufrufen keinen Bestandszeitpunkt", async () => {
    const file = tempFile();
    await Promise.all([
      recordSync({ productsAt: "2026-10-31T10:00:00.000Z", productCount: 5, inventoryAt: "2026-10-31T10:00:00.000Z", inventoryVariantCount: 9 }, file),
      recordSync({ productsAt: "2026-10-31T10:00:01.000Z", productCount: 5 }, file),
      recordSync({ productsAt: "2026-10-31T10:00:02.000Z", productCount: 5 }, file),
    ]);
    expect(await loadSyncState(file)).toEqual({
      productsAt: "2026-10-31T10:00:02.000Z",
      productCount: 5,
      inventoryAt: "2026-10-31T10:00:00.000Z",
      inventoryVariantCount: 9,
    });
  });

  it("übernimmt nur vollständige Teile als Erfolg", () => {
    const at = "2026-10-31T10:00:00.000Z";
    expect(successfulParts({ fetchedAt: at, products: { count: 5, complete: true }, inventory: { variantCount: 9, complete: true } })).toEqual({
      productsAt: at,
      productCount: 5,
      inventoryAt: at,
      inventoryVariantCount: 9,
    });
    expect(successfulParts({ fetchedAt: at, products: { count: 5, complete: true }, inventory: { variantCount: 9, complete: false } })).toEqual({
      productsAt: at,
      productCount: 5,
    });
    // Bestand gilt nie als vollständig, wenn die Produkte selbst unvollständig sind
    expect(successfulParts({ fetchedAt: at, products: { count: 1000, complete: false }, inventory: { variantCount: 9, complete: true } })).toEqual({});
  });

  it("verkraftet eine beschädigte Datei", async () => {
    const file = tempFile();
    await recordSync({}, file);
    writeFileSync(file, "{ kaputt");
    expect(await loadSyncState(file)).toEqual({});
    await recordSync({ productsAt: "2026-10-31T08:00:00.000Z", productCount: 1 }, file);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ productsAt: "2026-10-31T08:00:00.000Z", productCount: 1 });
  });
});
