// Read-only-Client für die Shopify Admin GraphQL API. Nur serverseitig.
//
// Schutz in drei Ebenen:
// 1. App-Rechte im Dev Dashboard: read_products (Pflicht) und read_inventory (optional).
// 2. Prüfung der vom Token gemeldeten Rechte: Jede write_-Berechtigung und jedes nicht vorgesehene
//    Recht führt zum Abbruch (Prinzip der minimalen Rechte).
// 3. Prüfung jedes GraphQL-Dokuments: mutation/subscription werden nie gesendet.

import "server-only";
import { SHOPIFY_ADMIN_API_VERSION } from "../graphql";
import { getAccessToken, SHOPIFY_TIMEOUT_MS, type FetchLike } from "./auth";
import type { ShopifyCredentials } from "./config";
import { redact, ShopifyConnectionError } from "./redact";

/** Genau diese Rechte sind für die aktuelle Phase vorgesehen. read_inventory ist optional. */
export const REQUIRED_SCOPES = ["read_products"] as const;
export const OPTIONAL_SCOPES = ["read_inventory"] as const;
export const ALLOWED_SCOPES: readonly string[] = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES];

/** Entfernt Kommentare und Zeichenketten, damit Schlüsselwörter darin nicht stören. */
function stripGraphQL(document: string): string {
  return document.replace(/#[^\n]*/g, "").replace(/"""[\s\S]*?"""/g, "").replace(/"(?:\\.|[^"\\])*"/g, '""');
}

export function assertReadOnlyDocument(document: string): void {
  const code = stripGraphQL(document).trim();
  if (/\b(mutation|subscription)\b/.test(code)) {
    throw new ShopifyConnectionError("Schreibende GraphQL-Operationen sind gesperrt (Read-only-Verbindung).", "readonly");
  }
  if (!/^(query\b|\{)/.test(code)) {
    throw new ShopifyConnectionError("Nur GraphQL-Abfragen (query) sind erlaubt.", "readonly");
  }
}

export function assertReadOnlyScopes(scopes: string[]): void {
  const write = scopes.filter((s) => s.startsWith("write_") || s.startsWith("unauthenticated_write_"));
  if (write.length) {
    throw new ShopifyConnectionError(
      `Die App hat Schreibrechte (${write.join(", ")}). Für diese Phase nur ${ALLOWED_SCOPES.join(", ")} vergeben.`,
      "scope",
    );
  }
  const unexpected = scopes.filter((s) => !ALLOWED_SCOPES.includes(s));
  if (unexpected.length) {
    throw new ShopifyConnectionError(
      `Die App hat nicht vorgesehene Rechte (${unexpected.join(", ")}). Erlaubt sind nur ${ALLOWED_SCOPES.join(", ")}.`,
      "scope",
    );
  }
  for (const required of REQUIRED_SCOPES) {
    if (!scopes.includes(required)) {
      throw new ShopifyConnectionError(`Der App fehlt die Berechtigung ${required}.`, "scope");
    }
  }
}

export interface ReadOnlyAdminClient {
  readonly storeDomain: string;
  readonly apiVersion: string;
  readonly scopes: string[];
  query<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
}

export async function createReadOnlyAdminClient(
  credentials: ShopifyCredentials,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ReadOnlyAdminClient> {
  const { token, scopes } = await getAccessToken(credentials, fetchImpl);
  assertReadOnlyScopes(scopes);
  const secrets = [token, credentials.clientSecret, credentials.clientId];
  const endpoint = `https://${credentials.storeDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;

  return {
    storeDomain: credentials.storeDomain,
    apiVersion: SHOPIFY_ADMIN_API_VERSION,
    scopes,
    async query<T>(document: string, variables: Record<string, unknown> = {}) {
      assertReadOnlyDocument(document);
      let response: Awaited<ReturnType<FetchLike>>;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ query: document, variables }),
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
        throw new ShopifyConnectionError(`Admin API antwortet mit HTTP ${response.status}: ${detail}`, "api");
      }
      const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
      if (body.errors?.length) {
        const message = body.errors.map((e) => e.message).join("; ");
        const kind = /access denied|scope/i.test(message) ? "scope" : "api";
        throw new ShopifyConnectionError(`Admin API meldet: ${redact(message, secrets).slice(0, 300)}`, kind);
      }
      if (!body.data) throw new ShopifyConnectionError("Admin API lieferte keine Daten.", "api");
      return body.data;
    },
  };
}
