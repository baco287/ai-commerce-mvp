// Durchgängiger Dry-Run des Befehls (Pakete G und H) als Integrationstest – ausschließlich in Temp-Verzeichnissen.
// Prüft Determinismus, Idempotenz (Exit 5), Lauf-Sperre (Exit 3), „ohne --save nichts schreiben“, STOP, Simulation,
// kein Netzwerk und kein Shopify. Alle Daten synthetisch (nur Test).

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { marketEvaluationDeps } from "@/lib/data";
import { catalogFileContent, resetSupplierData, withFullRealOffer } from "@/test/market-fixtures";
import { EXIT_CODES, type ScanArgs } from "../scan-command";
import { runScanCommand, type ScanRunnerOptions } from "./scan-runner";

// Kein Shopify: Das Laden des Admin-Clients würde den Test scheitern lassen.
vi.mock("@/lib/shopify/server/admin-client", () => {
  throw new Error("Der Shopify-Admin-Client darf im Dry-Run nicht geladen werden.");
});

const SYSTEM_NOW = new Date("2026-10-31T12:00:00Z");
const SIM_NOW = new Date("2026-10-19T12:00:00Z");

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dry-run-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetSupplierData();
});

const args = (a: Partial<ScanArgs> = {}): ScanArgs => ({ live: false, save: false, status: false, strict: false, now: null, runId: null, limit: null, requests: null, ...a });

function options(a: Partial<ScanArgs>, o: Partial<ScanRunnerOptions> = {}): ScanRunnerOptions {
  return {
    args: args(a),
    systemNow: SYSTEM_NOW,
    clock: () => SYSTEM_NOW,
    evaluationDeps: marketEvaluationDeps,
    appVersion: "0.0.0-test",
    log: () => {},
    dataDir: join(root, "market"),
    catalogFile: join(root, "catalog", "products.json"),
    shouldStop: () => false,
    ...o,
  };
}

/** Alle Dateien unter einem Verzeichnis (relativ, sortiert) */
function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? files(p).map((f) => join(name, f)) : [name];
    })
    .map((f) => f.replaceAll("\\", "/"))
    .sort();
}

describe("market:scan / pipeline:dry-run", () => {
  it("schreibt ohne --save nichts – auch keinen Lock", async () => {
    const res = await runScanCommand(options({}));
    expect(res.exitCode).toBe(EXIT_CODES.ok);
    expect(res.run?.results.filter((r) => r.candidate.demo)).toHaveLength(5);
    expect(files(root)).toEqual([]);
  });

  it("ist deterministisch: zwei Simulationen in leeren Verzeichnissen ergeben byte-gleiches Journal und gleiche Artefakte", async () => {
    const other = mkdtempSync(join(tmpdir(), "dry-run-b-"));
    try {
      const a = await runScanCommand(options({ save: true, now: SIM_NOW, runId: "abnahme" }));
      const b = await runScanCommand(options({ save: true, now: SIM_NOW, runId: "abnahme" }, { dataDir: join(other, "market"), clock: () => new Date() }));
      expect([a.exitCode, b.exitCode]).toEqual([0, 0]);
      const journalA = readFileSync(a.written.journal!, "utf8");
      expect(journalA).toBe(readFileSync(b.written.journal!, "utf8"));
      expect(files(join(root, "market"))).toEqual(files(join(other, "market")));
      for (const f of files(join(root, "market", "simulated", "drafts"))) {
        expect(readFileSync(join(root, "market", "simulated", "drafts", f), "utf8")).toBe(readFileSync(join(other, "market", "simulated", "drafts", f), "utf8"));
      }
      // Simulation: nur unter simulated/, nie „bereit zur Prüfung“
      expect(files(join(root, "market")).every((f) => f.startsWith("simulated/"))).toBe(true);
      expect(a.run?.results.some((r) => r.state === "review_ready")).toBe(false);
      expect(journalA).toMatch(/"clockOverride":true/);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("bricht bei bereits protokollierter Lauf-ID mit Exit 5 ab und ändert nichts", async () => {
    const first = await runScanCommand(options({ save: true, runId: "lauf-1" }));
    expect(first.exitCode).toBe(EXIT_CODES.ok);
    const dir = join(root, "market");
    const before = Object.fromEntries(files(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
    const again = await runScanCommand(options({ save: true, runId: "lauf-1" }));
    expect(again.exitCode).toBe(EXIT_CODES.duplicateRunId);
    expect(again.run).toBeNull();
    expect(Object.fromEntries(files(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]))).toEqual(before);
    expect(files(join(dir, "journal"))).toEqual(["lauf-1.jsonl"]);
    expect(existsSync(join(dir, "LOCK"))).toBe(false);
  });

  it("bricht bei belegter Lauf-Sperre mit Exit 3 ab – der Speicher bleibt unverändert", async () => {
    const dir = join(root, "market");
    await runScanCommand(options({ save: true, runId: "lauf-1" }));
    writeFileSync(join(dir, "LOCK"), JSON.stringify({ pid: 1, at: SYSTEM_NOW.toISOString() }));
    const before = files(dir);
    const res = await runScanCommand(options({ save: true, runId: "lauf-2" }));
    expect(res.exitCode).toBe(EXIT_CODES.locked);
    expect(files(dir)).toEqual(before);
    // Der fremde Lock bleibt bestehen
    expect(existsSync(join(dir, "LOCK"))).toBe(true);
  });

  it("schreibt bei STOP ein vollständiges Journal mit run_end.aborted und kein halbes Artefakt", async () => {
    let checks = 0;
    const res = await runScanCommand(options({ save: true, runId: "lauf-stop" }, { shouldStop: () => checks++ >= 2 }));
    expect(res.exitCode).toBe(EXIT_CODES.ok);
    const lines = readFileSync(res.written.journal!, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string; aborted?: string; draft?: { file?: string } });
    expect(lines[0].type).toBe("run_start");
    expect(lines.at(-1)).toMatchObject({ type: "run_end", aborted: expect.stringMatching(/Abbruchschalter/) });
    // Jedes geschriebene Artefakt gehört zu einem vollständig bewerteten Kandidaten
    const drafts = files(join(root, "market", "drafts")).map((f) => `drafts/${f}`);
    const referenced = lines.flatMap((l) => (l.draft?.file ? [l.draft.file] : []));
    expect(drafts.sort()).toEqual([...new Set(referenced)].sort());
    for (const f of drafts) expect(() => JSON.parse(readFileSync(join(root, "market", f), "utf8"))).not.toThrow();
  });

  it("meldet Fehler im Lauf mit --strict als Exit 4", async () => {
    const res = await runScanCommand(
      options({ strict: true }, { evaluationDeps: (now, o) => ({ ...marketEvaluationDeps(now, o), product: () => { throw new Error("Testfehler"); } }) }),
    );
    expect(res.run?.errors.length).toBeGreaterThan(0);
    expect(res.exitCode).toBe(EXIT_CODES.runErrors);
  });

  it("speichert echte Kandidaten nur geschwärzt – vertrauliche Werte stehen nur im Journal", async () => {
    withFullRealOffer();
    const catalogDir = join(root, "catalog");
    mkdirSync(catalogDir, { recursive: true });
    writeFileSync(join(catalogDir, "products.json"), catalogFileContent());
    const res = await runScanCommand(options({ save: true, runId: "lauf-echt" }));
    expect(res.exitCode).toBe(EXIT_CODES.ok);
    const state = readFileSync(res.written.state!, "utf8");
    expect(state).toContain("catalog:kabelkanal");
    expect(state).not.toContain("lieferant-a::KK-SKU-1");
    // Demo-Kandidaten dürfen fiktive Preise behalten – der echte Kandidat nicht
    const real = JSON.stringify((JSON.parse(state) as { candidates: Record<string, unknown> }).candidates["catalog:kabelkanal"]);
    expect(real).not.toMatch(/€|4\.37|4,37|777/);
    expect(real).toContain('"redacted":true');
    const journal = readFileSync(res.written.journal!, "utf8");
    expect(journal).toContain("lieferant-a::KK-SKU-1");
    // Artefakt ohne Beträge und ohne Angebots-Schlüssel im Shopify-Teil
    const artifactFile = files(join(root, "market", "drafts")).find((f) => f.startsWith("catalog_kabelkanal."))!;
    const artifact = JSON.parse(readFileSync(join(root, "market", "drafts", artifactFile), "utf8")) as { shopifyInput: unknown; demo: boolean };
    expect(artifact.demo).toBe(false);
    expect(JSON.stringify(artifact.shopifyInput)).not.toMatch(/lieferant-a::|cost|4\.37|supplier_|expected_margin|lauf-echt/);
    expect(relative(root, res.written.journal!).replaceAll("\\", "/")).toBe("market/journal/lauf-echt.jsonl");
  });

  it("ruft nie das Netz auf und lädt keinen Shopify-Code", async () => {
    const fetchMock = vi.mocked(fetch);
    const before = fetchMock.mock.calls.length;
    await runScanCommand(options({ save: true, runId: "lauf-netz" }));
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  describe("beschädigte Eingabedateien", () => {
    const write = (rel: string, content: string) => {
      const file = join(root, rel);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, content);
      return file;
    };

    it.each([
      ["Nachweisdatei kein JSON", "evidence", "{kaputt"],
      ["Nachweisdatei ohne Liste", "evidence", JSON.stringify({ eintraege: [] })],
      ["Angebotsspeicher kein JSON", "offers", "{kaputt"],
      ["Katalog kein JSON", "catalog", "{broken"],
    ] as const)("bricht mit --save ab (%s): Exit 1, weder Journal noch Stand noch Artefakte", async (_name, kind, content) => {
      const evidenceFile = kind === "evidence" ? write("suppliers/evidence.json", content) : undefined;
      const offerStoreFile = kind === "offers" ? write("suppliers/offers.json", content) : undefined;
      if (kind === "catalog") write("catalog/products.json", content);
      const lines: string[] = [];
      const res = await runScanCommand(options({ save: true, strict: true, runId: "c1" }, { evidenceFile, offerStoreFile, log: (l = "") => lines.push(l) }));
      expect(res.exitCode).toBe(EXIT_CODES.fatal);
      expect(res.run).toBeNull();
      expect(lines.join("\n")).toMatch(/Abbruch: .*(Nachweisdatei|Angebotsspeicher|Zielproduktkatalog).*nicht überschrieben/);
      // Nichts geschrieben – auch der Lock ist wieder frei
      expect(files(join(root, "market"))).toEqual([]);
    });

    it("meldet sie ohne --save als Lauffehler – mit --strict Exit 4, ohne --strict sichtbar in der Ausgabe", async () => {
      const evidenceFile = write("suppliers/evidence.json", "{kaputt");
      write("catalog/products.json", "{broken");
      const lines: string[] = [];
      const strict = await runScanCommand(options({ strict: true }, { evidenceFile, log: (l = "") => lines.push(l) }));
      expect(strict.exitCode).toBe(EXIT_CODES.runErrors);
      expect(strict.run?.errors).toEqual(expect.arrayContaining([expect.stringMatching(/Nachweisdatei ist nicht lesbar/), expect.stringMatching(/Zielproduktkatalog ist kein gültiges JSON/)]));
      expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^! Nachweisdatei ist nicht lesbar/), expect.stringMatching(/^! Zielproduktkatalog/)]));
      const lax = await runScanCommand(options({}, { evidenceFile }));
      expect(lax.exitCode).toBe(EXIT_CODES.ok);
      expect(files(join(root, "market"))).toEqual([]);
    });

    it("zählt einzelne ungültige Nachweise mit --strict als Lauffehler, speichert aber weiter", async () => {
      const evidenceFile = write("suppliers/evidence.json", JSON.stringify({ entries: [{ offerKey: "kaputt" }] }));
      const res = await runScanCommand(options({ save: true, strict: true, runId: "c2" }, { evidenceFile }));
      expect(res.exitCode).toBe(EXIT_CODES.runErrors);
      expect(res.run?.errors.some((e) => /^Nachweis 1:/.test(e))).toBe(true);
      expect(res.written.journal).toBeDefined();
    });
  });

  it("gibt nur die eigene Lauf-Sperre frei – eine während des Laufs übernommene bleibt bestehen", async () => {
    const lockFile = join(root, "market", "LOCK");
    const foreign = `${JSON.stringify({ pid: 999_999, at: SYSTEM_NOW.toISOString(), token: "fremd" })}\n`;
    let replaced = false;
    const res = await runScanCommand(
      options(
        { save: true, runId: "lauf-fremd" },
        {
          shouldStop: () => {
            if (!replaced) writeFileSync(lockFile, foreign);
            replaced = true;
            return false;
          },
        },
      ),
    );
    expect(res.exitCode).toBe(EXIT_CODES.ok);
    expect(readFileSync(lockFile, "utf8")).toBe(foreign);
  });
});
