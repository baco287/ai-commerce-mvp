// Shopify-Zugangsdaten aus lokalen Umgebungsvariablen (.env.local, von Git ignoriert).
// EINZIGE Stelle im Code, die process.env liest (siehe src/lib/guards/safety.test.ts).
// Geheimnisse verlassen dieses Modul nur in Richtung auth.ts – nie in Logs, URLs oder die Oberfläche.

import "server-only";

export interface ShopifyCredentials {
  /** z. B. yakru.myshopify.com */
  storeDomain: string;
  clientId: string;
  clientSecret: string;
}

export type ShopifyConfigResult =
  | { status: "ok"; credentials: ShopifyCredentials }
  | { status: "missing"; missing: string[] }
  | { status: "invalid"; problems: string[] };

export const SHOPIFY_ENV = {
  storeDomain: "SHOPIFY_STORE_DOMAIN",
  clientId: "SHOPIFY_CLIENT_ID",
  clientSecret: "SHOPIFY_CLIENT_SECRET",
} as const;

const STORE_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function readShopifyConfig(env: Record<string, string | undefined> = process.env): ShopifyConfigResult {
  const storeDomain = env[SHOPIFY_ENV.storeDomain]?.trim().toLowerCase() ?? "";
  const clientId = env[SHOPIFY_ENV.clientId]?.trim() ?? "";
  const clientSecret = env[SHOPIFY_ENV.clientSecret]?.trim() ?? "";

  const missing = Object.entries({ storeDomain, clientId, clientSecret })
    .filter(([, v]) => !v)
    .map(([k]) => SHOPIFY_ENV[k as keyof typeof SHOPIFY_ENV]);
  if (missing.length) return { status: "missing", missing };

  const problems: string[] = [];
  if (!STORE_DOMAIN.test(storeDomain)) {
    problems.push(`${SHOPIFY_ENV.storeDomain} muss die Form "name.myshopify.com" haben (ohne https://).`);
  }
  if (problems.length) return { status: "invalid", problems };

  return { status: "ok", credentials: { storeDomain, clientId, clientSecret } };
}

/**
 * Live-Abfragen nur im lokalen Entwicklungsserver. Für eine öffentliche Bereitstellung fehlt noch ein
 * Login – bis dahin bleibt die Shopify-Ansicht im Produktionsbetrieb gesperrt.
 */
export function isLocalDevelopment(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "development";
}
