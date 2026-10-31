// Build- und Startsperre (Paket I): echte Daten in .data/ werden erkannt, Demo- und Testdaten nicht. Alles im Speicher.

import { describe, expect, it } from "vitest";
import { publicDataViolations } from "./public-data";

const reader = (files: Record<string, string>) => ({
  read: (rel: string) => files[rel] ?? null,
  list: (rel: string) =>
    Object.keys(files)
      .filter((f) => f.startsWith(`${rel}/`) && !f.slice(rel.length + 1).includes("/"))
      .map((f) => f.slice(rel.length + 1)),
});

const offers = (synthetic: boolean) => JSON.stringify({ version: 1, offers: { "s::1": { key: "s::1", provenance: { synthetic } } }, imports: [] });
const state = (demo: boolean) => JSON.stringify({ version: 1, candidates: { k: { latest: { candidate: { demo } } } }, runs: [] });

describe("publicDataViolations", () => {
  it("erlaubt ein leeres .data/ und reine Demo-/Testdaten", () => {
    expect(publicDataViolations(reader({}))).toEqual([]);
    expect(
      publicDataViolations(
        reader({
          "shopify-sync-state.json": "{}",
          "suppliers/offers.json": offers(true),
          "suppliers/evidence.json": JSON.stringify({ entries: [{ offerKey: "s::1" }] }),
          "market/state.json": state(true),
          "market/drafts/demo_p-led.abc.json": JSON.stringify({ demo: true }),
          "market/journal/lauf-1.jsonl": `${JSON.stringify({ type: "run_start" })}\n${JSON.stringify({ type: "candidate", demo: true })}\n`,
          "market/simulated/state.json": state(true),
        }),
      ),
    ).toEqual([]);
  });

  it("sperrt bei echten Angeboten, Nachweisen, Katalog, Kandidaten, Artefakten und Journalen", () => {
    const v = (files: Record<string, string>) => publicDataViolations(reader(files)).join(" ");
    expect(v({ "suppliers/offers.json": offers(false) })).toMatch(/nicht-synthetische Angebote/);
    expect(v({ "suppliers/evidence.json": JSON.stringify({ entries: [{ offerKey: "echt::1" }] }) })).toMatch(/Nachweise zu echten Angeboten/);
    expect(v({ "catalog/products.json": "[]" })).toMatch(/Zielproduktkatalog/);
    expect(v({ "market/state.json": state(false) })).toMatch(/echte Kandidaten/);
    expect(v({ "market/simulated/state.json": state(false) })).toMatch(/simulated\/state\.json enthält 1 echte Kandidaten/);
    expect(v({ "market/drafts/catalog_x.abc.json": JSON.stringify({ demo: false }) })).toMatch(/Entwurfs-Artefakte/);
    expect(v({ "market/journal/l.jsonl": JSON.stringify({ type: "candidate", demo: false }) })).toMatch(/Protokolle mit echten Kandidaten/);
  });

  it("behandelt unlesbare Dateien wie echte Daten (fail-closed)", () => {
    expect(publicDataViolations(reader({ "suppliers/offers.json": "{kaputt" })).join(" ")).toMatch(/nicht lesbar/);
    expect(publicDataViolations(reader({ "market/state.json": "kaputt" })).join(" ")).toMatch(/nicht lesbar/);
    expect(publicDataViolations(reader({ "market/drafts/x.json": "kaputt" })).join(" ")).toMatch(/Entwurfs-Artefakte/);
  });
});
