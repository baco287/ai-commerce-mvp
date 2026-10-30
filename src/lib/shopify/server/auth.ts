// Access Token per Client-Credentials-Grant (Shopify Dev Dashboard, Store derselben Organisation).
// https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
//
// - Client ID und Secret stehen nur im Request-Body (nie in der URL).
// - Token lebt 24 h; wird im Speicher des Servers gecacht und 60 s vor Ablauf erneuert.
// - Token und Secret werden nie protokolliert oder zurückgegeben (außer an den Admin-Client).

import "server-only";
import type { ShopifyCredentials } from "./config";
import { redact, ShopifyConnectionError } from "./redact";

/** Maximale Wartezeit je Anfrage an Shopify, damit die Seite nie endlos lädt. */
export const SHOPIFY_TIMEOUT_MS = 15_000;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

interface CachedToken {
  token: string;
  scopes: string[];
  expiresAt: number;
}

const cache = new Map<string, CachedToken>();
const REFRESH_MARGIN_MS = 60_000;

export function clearTokenCache() {
  cache.clear();
}

export async function getAccessToken(
  credentials: ShopifyCredentials,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  now: () => number = Date.now,
): Promise<{ token: string; scopes: string[] }> {
  const cacheKey = `${credentials.storeDomain}:${credentials.clientId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) return { token: cached.token, scopes: cached.scopes };

  const secrets = [credentials.clientSecret, credentials.clientId];
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(`https://${credentials.storeDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(SHOPIFY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ShopifyConnectionError(
      `Shopify ist nicht erreichbar: ${redact(error instanceof Error ? error.message : String(error), secrets)}`,
      "network",
    );
  }

  if (!response.ok) {
    const detail = redact((await response.text()).slice(0, 300), secrets);
    const hint =
      response.status === 400 || response.status === 401
        ? " Prüfe Client ID/Secret, ob die App auf dem Store installiert ist und ob Store und App zur selben Organisation gehören."
        : "";
    throw new ShopifyConnectionError(`Token-Anfrage abgelehnt (HTTP ${response.status}).${hint} Antwort: ${detail}`, "auth");
  }

  const data = (await response.json()) as { access_token?: string; scope?: string; expires_in?: number };
  if (!data.access_token) throw new ShopifyConnectionError("Shopify hat kein Access Token geliefert.", "auth");

  const scopes = (data.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  cache.set(cacheKey, {
    token: data.access_token,
    scopes,
    expiresAt: now() + (data.expires_in ?? 0) * 1000,
  });
  return { token: data.access_token, scopes };
}
