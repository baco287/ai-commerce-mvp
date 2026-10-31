// Wikimedia als reale, kostenlose Marktquelle: Adressen bauen und Antworten streng prüfen.
// Reine Funktionen OHNE Netzwerk – der Abruf liegt in server/wikimedia-client.ts.
//
// Genutzte, offiziell dokumentierte Schnittstellen (frei, ohne Schlüssel, Daten unter CC0 bzw. CC BY-SA):
// - Pageviews-API: https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html
// - MediaWiki-API list=categorymembers: https://www.mediawiki.org/wiki/API:Categorymembers
// Zugriffsregeln: https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy
// (aussagekräftiger User-Agent mit Kontakt, Anfragen nacheinander statt parallel).

import { fillDays } from "./interest";
import type { DailyValue, MarketSourceInfo } from "./model";

export const WIKIMEDIA_SOURCE: MarketSourceInfo = {
  id: "wikimedia-pageviews",
  name: "Wikipedia-Aufrufe (de.wikipedia, Wikimedia-API)",
  kind: "api",
  signalKind: "public_interest",
  paid: false,
  network: true,
  docsUrl: "https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html",
  license: "Pageview-Daten: CC0; Artikeltitel: CC BY-SA 4.0",
};

export const WIKI_PROJECT = "de.wikipedia";
const API_HOST = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";
const MEDIAWIKI_API = "https://de.wikipedia.org/w/api.php";

/** Tage, die je Artikel abgefragt werden: gut ein Jahr für den Saisonvergleich (eine einzige Anfrage). */
export const HISTORY_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const compact = (iso: string) => iso.replaceAll("-", "");

/** Abfragezeitraum: bis gestern (UTC), da der aktuelle Tag noch unvollständig ist. */
export function requestWindow(now: Date, days = HISTORY_DAYS): { start: string; end: string } {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS;
  return { start: isoDay(end - (days - 1) * DAY_MS), end: isoDay(end) };
}

/** Artikeltitel in der Schreibweise der API (Leerzeichen → Unterstrich, sicher kodiert). */
export const articleSlug = (title: string) => encodeURIComponent(title.trim().replaceAll(" ", "_"));
export const articleUrl = (title: string) => `https://de.wikipedia.org/wiki/${articleSlug(title)}`;

export function pageviewsUrl(title: string, window: { start: string; end: string }): string {
  return `${API_HOST}/${WIKI_PROJECT}/all-access/user/${articleSlug(title)}/daily/${compact(window.start)}/${compact(window.end)}`;
}

export function categoryMembersUrl(category: string, limit: number, startPrefix?: string): string {
  const params = new URLSearchParams({
    action: "query",
    list: "categorymembers",
    cmtitle: category.startsWith("Kategorie:") ? category : `Kategorie:${category}`,
    cmtype: "page",
    cmnamespace: "0",
    cmlimit: String(Math.min(Math.max(1, Math.floor(limit)), 50)),
    format: "json",
    formatversion: "2",
  });
  if (startPrefix) params.set("cmstartsortkeyprefix", startPrefix);
  return `${MEDIAWIKI_API}?${params.toString()}`;
}

/**
 * Startbuchstabe für die Kategorie-Abfrage. Die API sortiert alphabetisch – ohne Rotation sähe der Agent immer nur
 * dieselben ersten Artikel. Deterministisch nach Tag und Kategorie, damit Läufe nachvollziehbar bleiben.
 */
export function rotationPrefix(now: Date, categoryIndex: number): string {
  const day = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
  return "ABCDEFGHIJKLMNOPRSTUVWZ"[(day + categoryIndex * 7) % 23];
}

export class WikimediaFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikimediaFormatError";
  }
}

/** Liest eine Pageviews-Antwort und füllt fehlende Tage mit 0 auf. Unbekanntes Format → Fehler, nie geraten. */
export function parsePageviews(json: unknown, window: { start: string; end: string }): DailyValue[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) throw new WikimediaFormatError("Pageviews-Antwort ohne items-Liste.");
  const values: DailyValue[] = [];
  for (const it of items) {
    const ts = (it as { timestamp?: unknown }).timestamp;
    const views = (it as { views?: unknown }).views;
    if (typeof ts !== "string" || !/^\d{10}$/.test(ts) || typeof views !== "number" || !Number.isInteger(views) || views < 0) {
      throw new WikimediaFormatError("Pageviews-Eintrag mit unerwartetem Format.");
    }
    values.push({ date: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`, value: views });
  }
  return fillDays(values, window.start, window.end);
}

/** Liest Artikeltitel einer Kategorie (nur Artikel, keine Unterkategorien). */
export function parseCategoryMembers(json: unknown): string[] {
  const members = (json as { query?: { categorymembers?: unknown } })?.query?.categorymembers;
  if (!Array.isArray(members)) throw new WikimediaFormatError("Kategorie-Antwort ohne categorymembers-Liste.");
  return members
    .filter((m) => (m as { ns?: unknown }).ns === 0 && typeof (m as { title?: unknown }).title === "string")
    .map((m) => (m as { title: string }).title);
}
