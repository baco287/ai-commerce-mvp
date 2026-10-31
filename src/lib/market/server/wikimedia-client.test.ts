import { describe, expect, it, vi } from "vitest";
import { MARKET_USER_AGENT } from "../config";
import { SourceHttpError } from "../sources";
import { createWikimediaFetchJson } from "./wikimedia-client";

const okResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("Wikimedia-Client (einziger Netzwerkzugang des Market Scout)", () => {
  it("fragt nur wikimedia.org und de.wikipedia.org per HTTPS ab", async () => {
    const fetchImpl = vi.fn(async () => okResponse({}));
    const fetchJson = createWikimediaFetchJson({ fetchImpl, delayMs: 0 });
    await expect(fetchJson("https://example.com/x")).rejects.toThrow(/nicht erlaubt/);
    await expect(fetchJson("http://wikimedia.org/x")).rejects.toThrow(/nicht erlaubt/);
    await expect(fetchJson("https://en.wikipedia.org/w/api.php")).rejects.toThrow(/nicht erlaubt/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sendet nur lesende GET-Anfragen mit User-Agent nach Wikimedia-Richtlinie, ohne Weiterleitungen", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse({ items: [] }));
    await createWikimediaFetchJson({ fetchImpl, delayMs: 0 })("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/x");
    const init = fetchImpl.mock.calls[0][1]!;
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(MARKET_USER_AGENT);
    expect(MARKET_USER_AGENT).toMatch(/github\.com\/baco287\/ai-commerce-mvp/);
  });

  it("meldet HTTP-Fehler mit Status, ohne den Inhalt der Antwort weiterzugeben", async () => {
    const fetchImpl = vi.fn(async () => new Response("geheim", { status: 404 }));
    const err: unknown = await createWikimediaFetchJson({ fetchImpl, delayMs: 0 })("https://de.wikipedia.org/w/api.php?x=1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceHttpError);
    expect((err as SourceHttpError).status).toBe(404);
    expect((err as SourceHttpError).message).not.toMatch(/geheim/);
  });

  it("wartet zwischen zwei Anfragen (nacheinander, nie parallel)", async () => {
    const sleep = vi.fn(async () => {});
    const fetchJson = createWikimediaFetchJson({ fetchImpl: vi.fn(async () => okResponse({})), delayMs: 1000, sleep });
    await fetchJson("https://wikimedia.org/a");
    await fetchJson("https://wikimedia.org/b");
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
