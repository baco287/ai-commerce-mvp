import { describe, expect, it } from "vitest";
import {
  articleUrl,
  categoryMembersUrl,
  pageviewsUrl,
  parseCategoryMembers,
  parsePageviews,
  requestWindow,
  rotationPrefix,
  WIKIMEDIA_SOURCE,
  WikimediaFormatError,
} from "./wikimedia";

describe("Wikimedia-Schnittstelle (ohne Netzwerk)", () => {
  it("ist als kostenlose, reale Quelle für öffentliches Interesse beschrieben", () => {
    expect(WIKIMEDIA_SOURCE).toMatchObject({ kind: "api", signalKind: "public_interest", paid: false, network: true });
  });

  it("fragt bis gestern ab (der heutige Tag ist unvollständig)", () => {
    // 400 Tage einschließlich Start- und Endtag
    expect(requestWindow(new Date("2026-10-31T10:00:00Z"), 400)).toEqual({ start: "2025-09-26", end: "2026-10-30" });
  });

  it("baut Adressen mit sicher kodierten Artikeltiteln", () => {
    const w = { start: "2026-10-01", end: "2026-10-30" };
    expect(pageviewsUrl("Kräuterschere", w)).toBe(
      "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/de.wikipedia/all-access/user/Kr%C3%A4uterschere/daily/20261001/20261030",
    );
    expect(pageviewsUrl("Abkühl gitter/../x", w)).toContain("/Abk%C3%BChl_gitter%2F..%2Fx/");
    expect(articleUrl("Trinkflasche")).toBe("https://de.wikipedia.org/wiki/Trinkflasche");
  });

  it("fragt Kategorien begrenzt und nur nach Artikeln ab", () => {
    const url = new URL(categoryMembersUrl("Haushaltsgerät", 500, "K"));
    expect(url.host).toBe("de.wikipedia.org");
    expect(url.searchParams.get("cmtitle")).toBe("Kategorie:Haushaltsgerät");
    expect(url.searchParams.get("cmlimit")).toBe("50");
    expect(url.searchParams.get("cmnamespace")).toBe("0");
    expect(url.searchParams.get("cmstartsortkeyprefix")).toBe("K");
  });

  it("rotiert den Startbuchstaben deterministisch nach Tag und Kategorie", () => {
    const d = new Date("2026-10-31T05:00:00Z");
    expect(rotationPrefix(d, 0)).toBe(rotationPrefix(new Date("2026-10-31T23:00:00Z"), 0));
    expect(rotationPrefix(d, 0)).not.toBe(rotationPrefix(new Date("2026-11-01T05:00:00Z"), 0));
    expect(rotationPrefix(d, 0)).not.toBe(rotationPrefix(d, 1));
  });

  it("liest Pageviews und füllt fehlende Tage mit 0 auf", () => {
    const json = {
      items: [
        { timestamp: "2026102000", views: 4 },
        { timestamp: "2026102200", views: 1 },
      ],
    };
    expect(parsePageviews(json, { start: "2026-10-20", end: "2026-10-22" }).map((d) => d.value)).toEqual([4, 0, 1]);
  });

  it("lehnt unerwartete Antworten ab, statt zu raten", () => {
    const w = { start: "2026-10-20", end: "2026-10-22" };
    expect(() => parsePageviews({}, w)).toThrow(WikimediaFormatError);
    expect(() => parsePageviews({ items: [{ timestamp: "2026102000", views: -1 }] }, w)).toThrow(WikimediaFormatError);
    expect(() => parsePageviews({ items: [{ timestamp: "x", views: 3 }] }, w)).toThrow(WikimediaFormatError);
    expect(() => parseCategoryMembers({ query: {} })).toThrow(WikimediaFormatError);
  });

  it("liest nur Artikel aus Kategorien (keine Unterkategorien oder Dateien)", () => {
    const json = { query: { categorymembers: [{ ns: 0, title: "Aquastop" }, { ns: 14, title: "Kategorie:Küchengerät" }, { ns: 0, title: "Bügelbrett" }] } };
    expect(parseCategoryMembers(json)).toEqual(["Aquastop", "Bügelbrett"]);
  });
});
