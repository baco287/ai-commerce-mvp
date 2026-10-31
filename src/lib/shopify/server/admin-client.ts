// Clients für die Shopify Admin GraphQL API. Nur serverseitig. Einzige Stelle mit Netzwerkzugriff
// auf die Admin API (siehe src/lib/guards/safety.test.ts).
//
// Schutz in mehreren Ebenen:
// 1. App-Rechte im Dev Dashboard: read_products (Pflicht), read_inventory, write_products,
//    write_inventory (freigegeben am 31.10.2026). Jedes andere Recht führt zum Abbruch.
// 2. Lese-Client: Jedes Dokument wird geprüft – mutation/subscription werden nie gesendet.
// 3. Schreib-Client: nimmt keine freien Dokumente an, nur Operationen aus der Positivliste
//    (write-operations.ts), und nur bei eingeschaltetem Sicherheitsschalter shopifyWriteEnabled.

import "server-only";
import { randomUUID } from "node:crypto";
import { SAFETY_SWITCHES } from "@/lib/config/budget";
import { SHOPIFY_ADMIN_API_VERSION } from "../graphql";
import { buildWriteRequest, type WriteOperation, type WriteScope } from "../write-operations";
import { getAccessToken, SHOPIFY_TIMEOUT_MS, type FetchLike } from "./auth";
import type { ShopifyCredentials } from "./config";
import { redact, ShopifyConnectionError } from "./redact";

/** Genau diese Rechte sind vorgesehen. Nur read_products ist Pflicht. */
export const REQUIRED_SCOPES = ["read_products"] as const;
export const OPTIONAL_SCOPES = ["read_inventory", "write_products", "write_inventory"] as const;
export const ALLOWED_SCOPES: readonly string[] = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES];
/** Freigegebene Schreibrechte – jedes andere write_-Recht (Bestellungen, Veröffentlichen …) ist verboten. */
export const ALLOWED_WRITE_SCOPES: readonly string[] = ["write_products", "write_inventory"];

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

/**
 * Shopify meldet bei Schreibrechten das zugehörige Leserecht nicht mit (write_products schließt
 * read_products ein; live geprüft am 31.10.2026: Token-Scopes „write_products,write_inventory“).
 * Ergänzt daher die eingeschlossenen Leserechte – ohne neue Rechte zu erfinden.
 */
export function withImpliedScopes(scopes: string[]): string[] {
  const implied = scopes.filter((s) => s.startsWith("write_")).map((s) => `read_${s.slice("write_".length)}`);
  return [...new Set([...scopes, ...implied])];
}

export function assertAllowedScopes(granted: string[]): void {
  const scopes = withImpliedScopes(granted);
  const write = scopes.filter((s) => (s.startsWith("write_") || s.startsWith("unauthenticated_write_")) && !ALLOWED_WRITE_SCOPES.includes(s));
  if (write.length) {
    throw new ShopifyConnectionError(
      `Die App hat nicht freigegebene Schreibrechte (${write.join(", ")}). Erlaubt sind nur ${ALLOWED_SCOPES.join(", ")}.`,
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

interface Connection {
  storeDomain: string;
  scopes: string[];
  /** Sendet ein Dokument; nicht exportiert – nur die Clients unten dürfen es benutzen. */
  send<T>(document: string, variables: Record<string, unknown>): Promise<T>;
}

async function connect(credentials: ShopifyCredentials, fetchImpl: FetchLike): Promise<Connection> {
  const { token, scopes: granted } = await getAccessToken(credentials, fetchImpl);
  assertAllowedScopes(granted);
  const scopes = withImpliedScopes(granted);
  const secrets = [token, credentials.clientSecret, credentials.clientId];
  const endpoint = `https://${credentials.storeDomain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;

  return {
    storeDomain: credentials.storeDomain,
    scopes,
    async send<T>(document: string, variables: Record<string, unknown>) {
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
        // Gleiche Meldungen (z. B. „Access denied“ je abgefragtem Lagerartikel) nur einmal ausgeben.
        const message = [...new Set(body.errors.map((e) => e.message))].join("; ");
        const kind = /access denied|scope/i.test(message) ? "scope" : "api";
        throw new ShopifyConnectionError(`Admin API meldet: ${redact(message, secrets).slice(0, 300)}`, kind);
      }
      if (!body.data) throw new ShopifyConnectionError("Admin API lieferte keine Daten.", "api");
      return body.data;
    },
  };
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
  const connection = await connect(credentials, fetchImpl);
  return {
    storeDomain: connection.storeDomain,
    apiVersion: SHOPIFY_ADMIN_API_VERSION,
    scopes: connection.scopes,
    async query<T>(document: string, variables: Record<string, unknown> = {}) {
      assertReadOnlyDocument(document);
      return connection.send<T>(document, variables);
    },
  };
}

export interface GuardedWriteClient {
  readonly scopes: string[];
  readonly runId: string;
  /** Führt genau eine Operation aus der Positivliste aus. Wirft bei Guard-, Rechte- oder Shopify-Fehlern. */
  run(operation: WriteOperation): Promise<unknown>;
}

export async function createGuardedWriteClient(
  credentials: ShopifyCredentials,
  options: { fetchImpl?: FetchLike; writeEnabled?: boolean; runId?: string } = {},
): Promise<GuardedWriteClient> {
  if (!(options.writeEnabled ?? SAFETY_SWITCHES.shopifyWriteEnabled)) {
    throw new ShopifyConnectionError("Shopify-Schreibzugriff ist deaktiviert (SAFETY_SWITCHES.shopifyWriteEnabled).", "readonly");
  }
  const connection = await connect(credentials, options.fetchImpl ?? (fetch as unknown as FetchLike));
  const hasScope = (scope: WriteScope) => connection.scopes.includes(scope);
  // Eine Kennung je Schreib-Client (= je Lauf von shopify:sync --apply) für Idempotenzschlüssel.
  const context = { runId: options.runId ?? randomUUID() };

  return {
    scopes: connection.scopes,
    runId: context.runId,
    async run(operation: WriteOperation) {
      // Guards laufen vor jedem Aufruf; freie Dokumente gibt es nicht.
      const request = buildWriteRequest(operation, context);
      if (!hasScope(request.requiredScope)) {
        throw new ShopifyConnectionError(`Der App fehlt die Berechtigung ${request.requiredScope}.`, "scope");
      }
      const data = await connection.send<Record<string, { userErrors?: { message: string }[] } | null>>(request.document, request.variables);
      const payload = data[request.payloadField];
      const userErrors = payload?.userErrors ?? [];
      if (!payload || userErrors.length) {
        const message = userErrors.map((e) => e.message).join("; ") || "keine Antwort";
        throw new ShopifyConnectionError(`Shopify hat die Änderung abgelehnt: ${message.slice(0, 300)}`, "api");
      }
      return payload;
    },
  };
}
