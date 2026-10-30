import { beforeEach, describe, expect, it } from "vitest";
import { SHOPIFY_ADMIN_API_VERSION } from "../graphql";
import { assertReadOnlyDocument, createReadOnlyAdminClient } from "./admin-client";
import { clearTokenCache, getAccessToken, type FetchLike } from "./auth";
import { isLocalDevelopment, readShopifyConfig, type ShopifyCredentials } from "./config";
import { redact, ShopifyConnectionError } from "./redact";

const credentials: ShopifyCredentials = {
  storeDomain: "yakru.myshopify.com",
  clientId: "test-client-id-123",
  clientSecret: "test-secret-abcdef",
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Fake-Shopify: Token-Endpunkt + GraphQL-Endpunkt, zeichnet alle Aufrufe auf. */
function fakeShopify(opts: { scope?: string; tokenStatus?: number; tokenBody?: string; graphql?: unknown } = {}) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (url.endsWith("/admin/oauth/access_token")) {
      const status = opts.tokenStatus ?? 200;
      return {
        ok: status === 200,
        status,
        json: async () => ({ access_token: "shpat_faketoken123456", scope: opts.scope ?? "read_products", expires_in: 86399 }),
        text: async () => opts.tokenBody ?? "",
      };
    }
    return { ok: true, status: 200, json: async () => opts.graphql ?? { data: { ok: true } }, text: async () => "" };
  };
  return { calls, fetchImpl };
}

beforeEach(() => clearTokenCache());

describe("Konfiguration", () => {
  it("meldet fehlende Einträge mit Namen, ohne Werte", () => {
    const r = readShopifyConfig({ SHOPIFY_STORE_DOMAIN: "yakru.myshopify.com" });
    expect(r).toEqual({ status: "missing", missing: ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"] });
  });

  it("verlangt eine myshopify.com-Domain ohne Protokoll", () => {
    const r = readShopifyConfig({ SHOPIFY_STORE_DOMAIN: "https://yakru.myshopify.com", SHOPIFY_CLIENT_ID: "a", SHOPIFY_CLIENT_SECRET: "b" });
    expect(r.status).toBe("invalid");
  });

  it("erlaubt Live-Abfragen nur im Entwicklungsmodus", () => {
    expect(isLocalDevelopment({ NODE_ENV: "development" })).toBe(true);
    expect(isLocalDevelopment({ NODE_ENV: "production" })).toBe(false);
    expect(isLocalDevelopment({})).toBe(false);
  });
});

describe("Token (Client-Credentials-Grant)", () => {
  it("sendet Client ID/Secret nur im Body, nie in der URL", async () => {
    const { calls, fetchImpl } = fakeShopify();
    await getAccessToken(credentials, fetchImpl);
    expect(calls[0].url).toBe("https://yakru.myshopify.com/admin/oauth/access_token");
    expect(calls[0].url).not.toContain(credentials.clientSecret);
    const body = new URLSearchParams(calls[0].body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_secret")).toBe(credentials.clientSecret);
  });

  it("verwendet das Token bis kurz vor Ablauf weiter", async () => {
    const { calls, fetchImpl } = fakeShopify();
    let now = 0;
    await getAccessToken(credentials, fetchImpl, () => now);
    now = 23 * 60 * 60 * 1000;
    await getAccessToken(credentials, fetchImpl, () => now);
    expect(calls).toHaveLength(1);
    now = 86399 * 1000 - 30_000;
    await getAccessToken(credentials, fetchImpl, () => now);
    expect(calls).toHaveLength(2);
  });

  it("entfernt Geheimnisse aus Fehlermeldungen", async () => {
    const { fetchImpl } = fakeShopify({ tokenStatus: 401, tokenBody: `invalid client test-secret-abcdef / shpat_leak999` });
    const error = await getAccessToken(credentials, fetchImpl).catch((e) => e);
    expect(error).toBeInstanceOf(ShopifyConnectionError);
    expect(error.message).not.toContain(credentials.clientSecret);
    expect(error.message).not.toContain("shpat_leak999");
    expect(error.message).toMatch(/HTTP 401/);
  });

  it("redact ersetzt alle Vorkommen", () => {
    expect(redact("a SECRET b SECRET", ["SECRET"])).toBe("a [entfernt] b [entfernt]");
  });
});

describe("Read-only-Admin-Client", () => {
  it("nutzt die fest konfigurierte API-Version und das Token im Header", async () => {
    const { calls, fetchImpl } = fakeShopify();
    const client = await createReadOnlyAdminClient(credentials, fetchImpl);
    await client.query("query { shop { name } }");
    const call = calls[1];
    expect(SHOPIFY_ADMIN_API_VERSION).toMatch(/^\d{4}-(01|04|07|10)$/);
    expect(call.url).toBe(`https://yakru.myshopify.com/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`);
    expect(call.headers["X-Shopify-Access-Token"]).toBe("shpat_faketoken123456");
    expect(call.url).not.toContain("shpat_");
  });

  it("sendet niemals Mutationen", async () => {
    const { calls, fetchImpl } = fakeShopify();
    const client = await createReadOnlyAdminClient(credentials, fetchImpl);
    await expect(client.query('mutation { productDelete(input: {id: "1"}) { deletedProductId } }')).rejects.toThrow(/gesperrt/);
    expect(calls).toHaveLength(1); // nur die Token-Anfrage
  });

  it("erkennt Mutationen auch hinter Kommentaren, lässt Wörter in Zeichenketten aber zu", () => {
    expect(() => assertReadOnlyDocument("# Kommentar\nmutation X { a }")).toThrow();
    expect(() => assertReadOnlyDocument('query { products(query: "mutation") { nodes { id } } }')).not.toThrow();
    expect(() => assertReadOnlyDocument("subscription { a }")).toThrow();
  });

  it("bricht ab, wenn die App Schreibrechte hat", async () => {
    const { fetchImpl } = fakeShopify({ scope: "read_products,write_products" });
    await expect(createReadOnlyAdminClient(credentials, fetchImpl)).rejects.toThrow(/Schreibrechte/);
  });

  it("bricht ab, wenn read_products fehlt", async () => {
    const { fetchImpl } = fakeShopify({ scope: "read_orders" });
    await expect(createReadOnlyAdminClient(credentials, fetchImpl)).rejects.toThrow(/read_products/);
  });

  it("gibt GraphQL-Fehler ohne Token weiter", async () => {
    const { fetchImpl } = fakeShopify({ graphql: { errors: [{ message: "Access denied for shpat_faketoken123456" }] } });
    const client = await createReadOnlyAdminClient(credentials, fetchImpl);
    const error = await client.query("query { shop { name } }").then(
      () => null,
      (e: unknown) => e,
    );
    if (!(error instanceof ShopifyConnectionError)) throw new Error("ShopifyConnectionError erwartet");
    expect(error.kind).toBe("scope");
    expect(error.message).not.toContain("shpat_faketoken123456");
  });
});
