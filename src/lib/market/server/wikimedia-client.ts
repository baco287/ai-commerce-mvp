import "server-only";

// Einziger Netzwerkzugang des Market Scout: lesende GET-Anfragen an zwei Wikimedia-Hosts.
// - nur HTTPS, nur wikimedia.org und de.wikipedia.org (alles andere wird abgelehnt)
// - nacheinander mit Pause, Zeitlimit je Anfrage, User-Agent nach Wikimedia-Richtlinie
// - keine Zugangsdaten, keine Cookies, keine Schreibzugriffe

import { MARKET_SCAN, MARKET_USER_AGENT } from "../config";
import { SourceHttpError, type FetchJson } from "../sources";

export const ALLOWED_HOSTS = new Set(["wikimedia.org", "de.wikipedia.org"]);

export interface WikimediaClientOptions {
  /** Ersetzbar für Tests; Standard ist das globale fetch */
  fetchImpl?: typeof fetch;
  delayMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createWikimediaFetchJson(options: WikimediaClientOptions = {}): FetchJson {
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayMs = options.delayMs ?? MARKET_SCAN.requestDelayMs;
  const timeoutMs = options.timeoutMs ?? MARKET_SCAN.requestTimeoutMs;
  const sleep = options.sleep ?? defaultSleep;
  let last = 0;

  return async (url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.host)) {
      throw new Error(`Adresse nicht erlaubt: ${parsed.protocol}//${parsed.host}`);
    }
    const wait = last + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();

    const res = await fetchImpl(url, {
      method: "GET",
      headers: { "User-Agent": MARKET_USER_AGENT, "Api-User-Agent": MARKET_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!res.ok) throw new SourceHttpError(res.status, url);
    return res.json();
  };
}
