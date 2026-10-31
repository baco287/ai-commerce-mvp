// Speicher des Market Scout (Paket G): Lauf-Sperre, nur-neu-anlegen (wx) für Journal und Artefakte, Sicherung vor dem
// Speichern, getrennte Verzeichnisse. Ausschließlich in einem Temp-Verzeichnis – der echte Speicher bleibt unberührt.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalEntry } from "../journal";
import { emptyMarketState } from "../state";
import type { DraftArtifact } from "../store-manager";

// setup.ts ersetzt loadMarketState/isStopRequested global – hier wird der echte Speicher geprüft.
const store = await vi.importActual<typeof import("./market-store")>("./market-store");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "market-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date("2026-10-31T12:00:00Z");
const entries: JournalEntry[] = [{ type: "run_end", runId: "lauf-1", finishedAt: NOW.toISOString(), counts: { unreviewed: 0, deferred: 0, blocked: 0, review_ready: 0, approved: 0, draft_created: 0 }, errors: [] }];

describe("Lauf-Sperre", () => {
  it("blockiert bei frischem Lock und ersetzt einen veralteten (> 6 h) mit Vermerk", () => {
    expect(store.acquireRunLock(dir, NOW)).toMatchObject({ ok: true });
    expect(store.acquireRunLock(dir, new Date(NOW.getTime() + 60_000))).toMatchObject({ ok: false, since: NOW.toISOString() });
    const later = new Date(NOW.getTime() + store.RUN_LOCK_MAX_AGE_MS + 1);
    const replaced = store.acquireRunLock(dir, later);
    expect(replaced).toMatchObject({ ok: true, note: expect.stringMatching(/Veraltete Lauf-Sperre ersetzt/) });
    expect(JSON.parse(readFileSync(join(dir, "LOCK"), "utf8")).at).toBe(later.toISOString());
    store.releaseRunLock(dir);
    expect(existsSync(join(dir, "LOCK"))).toBe(false);
  });

  it("behandelt einen Lock mit Zeitpunkt in der Zukunft als belegt", () => {
    writeFileSync(join(dir, "LOCK"), JSON.stringify({ pid: 1, at: "2027-01-01T00:00:00.000Z" }));
    expect(store.acquireRunLock(dir, NOW).ok).toBe(false);
  });

  it("gibt die Sperre im finally frei – auch nach einer Ausnahme", () => {
    const run = () => {
      expect(store.acquireRunLock(dir, NOW).ok).toBe(true);
      try {
        throw new Error("Fehler im Lauf");
      } finally {
        store.releaseRunLock(dir);
      }
    };
    expect(run).toThrow("Fehler im Lauf");
    expect(existsSync(join(dir, "LOCK"))).toBe(false);
  });

  describe("Übernahme einer veralteten Sperre (Wettlauf zweier --save-Läufe)", () => {
    const LATER = new Date(NOW.getTime() + store.RUN_LOCK_MAX_AGE_MS + 1);
    const staleRaw = JSON.stringify({ pid: 1, at: NOW.toISOString() });
    const lockFile = () => join(dir, "LOCK");

    it("lässt von zwei Läufen, die dieselbe veraltete Sperre sahen, nur einen gewinnen", () => {
      writeFileSync(lockFile(), staleRaw);
      const seen = { raw: staleRaw, since: NOW.toISOString() };
      // A ersetzt die veraltete Sperre …
      const a = store.replaceStaleRunLock(dir, seen, LATER);
      expect(a).toMatchObject({ ok: true, note: expect.stringMatching(/Veraltete Lauf-Sperre ersetzt/) });
      const afterA = readFileSync(lockFile(), "utf8");
      // … B hatte vorher dieselbe veraltete Sperre gesehen und versucht es danach: abgewiesen, As Sperre bleibt.
      const b = store.replaceStaleRunLock(dir, seen, LATER);
      expect(b).toMatchObject({ ok: false });
      expect(readFileSync(lockFile(), "utf8")).toBe(afterA);
      // Und auch über acquireRunLock: As frische Sperre ist belegt
      expect(store.acquireRunLock(dir, LATER).ok).toBe(false);
      expect(readFileSync(lockFile(), "utf8")).toBe(afterA);
      // Keine Übernahme-Sperre und keine temporären Dateien bleiben liegen
      expect(readdirSync(dir).sort()).toEqual(["LOCK"]);
    });

    it("ersetzt nicht, solange ein anderer Lauf die Übernahme-Sperre hält", () => {
      writeFileSync(lockFile(), staleRaw);
      const other = JSON.stringify({ pid: 2, at: LATER.toISOString(), token: "anderer" });
      writeFileSync(join(dir, "LOCK.takeover"), other);
      const res = store.acquireRunLock(dir, LATER);
      expect(res).toMatchObject({ ok: false, file: join(dir, "LOCK.takeover") });
      expect(readFileSync(lockFile(), "utf8")).toBe(staleRaw);
      // Die fremde Übernahme-Sperre wird nicht angefasst
      expect(readFileSync(join(dir, "LOCK.takeover"), "utf8")).toBe(other);
    });

    it("legt die Sperre neu an, wenn die veraltete inzwischen freigegeben wurde – ohne Ausnahme (kein ENOENT)", () => {
      const res = store.replaceStaleRunLock(dir, { raw: staleRaw, since: NOW.toISOString() }, LATER);
      expect(res).toMatchObject({ ok: true });
      expect(JSON.parse(readFileSync(lockFile(), "utf8")).at).toBe(LATER.toISOString());
    });

    it("behandelt eine unlesbare Sperre erst nach der Schonfrist als veraltet", () => {
      writeFileSync(lockFile(), "");
      expect(store.acquireRunLock(dir, NOW)).toMatchObject({ ok: false, since: null });
      const old = new Date(Date.now() - store.RUN_LOCK_UNREADABLE_GRACE_MS - 1000);
      utimesSync(lockFile(), old, old);
      expect(store.acquireRunLock(dir, NOW)).toMatchObject({ ok: true, note: expect.stringMatching(/Zeitpunkt unbekannt/) });
    });
  });

  it("gibt nur die eigene Sperre frei (Besitzer-Kennung)", () => {
    const own = store.acquireRunLock(dir, NOW);
    if (!own.ok) throw new Error("Sperre erwartet");
    expect(store.releaseRunLock(dir, "fremde-kennung")).toBe(false);
    expect(existsSync(join(dir, "LOCK"))).toBe(true);
    // Fremde Sperre (andere Prozess-ID, andere Kennung) bleibt auch ohne Kennung bestehen
    writeFileSync(join(dir, "LOCK"), JSON.stringify({ pid: process.pid + 1, at: NOW.toISOString(), token: "fremd" }));
    expect(store.releaseRunLock(dir, own.token)).toBe(false);
    expect(store.releaseRunLock(dir)).toBe(false);
    expect(existsSync(join(dir, "LOCK"))).toBe(true);
    rmSync(join(dir, "LOCK"));
    const again = store.acquireRunLock(dir, NOW);
    if (!again.ok) throw new Error("Sperre erwartet");
    expect(store.releaseRunLock(dir, again.token)).toBe(true);
    expect(existsSync(join(dir, "LOCK"))).toBe(false);
    expect(store.releaseRunLock(dir, again.token)).toBe(false);
  });
});

describe("Journal und Artefakte", () => {
  it("legt das Journal nur neu an und überschreibt es nie", () => {
    expect(store.journalExists("lauf-1", dir)).toBe(false);
    expect(store.writeJournal("lauf-1", entries, dir).status).toBe("written");
    expect(store.journalExists("lauf-1", dir)).toBe(true);
    const before = readFileSync(join(dir, "journal", "lauf-1.jsonl"), "utf8");
    expect(store.writeJournal("lauf-1", [...entries, ...entries], dir).status).toBe("exists");
    expect(readFileSync(join(dir, "journal", "lauf-1.jsonl"), "utf8")).toBe(before);
    expect(() => store.writeJournal("../ausbruch", entries, dir)).toThrow(/Ungültige Lauf-ID/);
  });

  it("legt ein Artefakt mit gleichem Fingerabdruck nur einmal an", () => {
    const artifact = { candidateKey: "catalog:x", fingerprint: "ab".repeat(32), demo: true } as unknown as DraftArtifact;
    expect(store.writeDraftArtifact(artifact, dir).status).toBe("written");
    expect(store.writeDraftArtifact({ ...artifact, runId: "anderer-lauf" } as DraftArtifact, dir).status).toBe("exists");
    expect(readdirSync(join(dir, "drafts"))).toHaveLength(1);
  });
});

describe("Stand", () => {
  it("sichert den bisherigen Stand als state.json.bak, bevor gespeichert wird", () => {
    const file = join(dir, "state.json");
    store.saveMarketState(emptyMarketState(), file);
    expect(existsSync(`${file}.bak`)).toBe(false);
    const first = readFileSync(file, "utf8");
    store.saveMarketState({ ...emptyMarketState(), runs: [] }, file);
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(first);
  });

  it("schreibt mit dem Simulationsverzeichnis nichts in den produktiven Pfad", () => {
    const sim = join(dir, "simulated");
    store.writeJournal("sim-1", entries, sim);
    store.saveMarketState(emptyMarketState(), store.marketPaths(sim).state);
    expect(readdirSync(dir)).toEqual(["simulated"]);
    expect(readdirSync(sim).sort()).toEqual(["journal", "state.json"]);
  });
});
