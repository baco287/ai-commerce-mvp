import { beforeEach, describe, expect, it } from "vitest";
import { INVENTORY_ITEMS_QUERY, SHOPIFY_ADMIN_API_VERSION } from "../graphql";
import { assertReadOnlyDocument, createReadOnlyAdminClient } from "./admin-client";
import { clearTokenCache, getAccessToken, type FetchLike } from "./auth";
import { isLocalDevelopment, readShopifyConfig, type ShopifyCredentials } from "./config";
import { readAllProducts, readInventory } from "./read-products";
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

/**
 * Fake-Shopify: Token-Endpunkt + GraphQL-Endpunkt, zeichnet alle Aufrufe auf.
 * `graphql` ist eine feste Antwort oder eine Funktion des gesendeten Dokuments.
 */
function fakeShopify(
  opts: { scope?: string; tokenStatus?: number; tokenBody?: string; graphql?: unknown | ((query: string, variables: Record<string, unknown>) => unknown) } = {},
) {
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
    const request = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
    const answer = typeof opts.graphql === "function" ? opts.graphql(request.query, request.variables) : opts.graphql;
    return { ok: true, status: 200, json: async () => answer ?? { data: { ok: true } }, text: async () => "" };
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

  it("akzeptiert zusätzlich read_inventory, aber keine anderen Rechte", async () => {
    await expect(createReadOnlyAdminClient(credentials, fakeShopify({ scope: "read_products,read_inventory" }).fetchImpl)).resolves.toBeDefined();
    clearTokenCache();
    await expect(createReadOnlyAdminClient(credentials, fakeShopify({ scope: "read_products,read_orders" }).fetchImpl)).rejects.toThrow(/nicht vorgesehene Rechte/);
  });

  it("lehnt jede Schreibberechtigung ab, auch für Bestand und Standorte", async () => {
    for (const scope of ["read_products,read_inventory,write_inventory", "read_products,write_locations", "read_products,read_inventory,write_products"]) {
      clearTokenCache();
      await expect(createReadOnlyAdminClient(credentials, fakeShopify({ scope }).fetchImpl), scope).rejects.toThrow(/Schreibrechte/);
    }
  });

  it("bricht ab, wenn read_products fehlt", async () => {
    const { fetchImpl } = fakeShopify({ scope: "read_inventory" });
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

describe("Produkte und Bestand lesen", () => {
  // Shopify liefert vom Standort nur die ID (Name und Aktiv-Status bräuchten read_locations).
  const level = (id: string, available: number, onHand = available) => ({
    location: { id },
    quantities: [
      { name: "available", quantity: available },
      { name: "on_hand", quantity: onHand },
      { name: "committed", quantity: onHand - available },
      { name: "incoming", quantity: 0 },
    ],
  });
  const variant = (n: number) => ({
    id: `v${n}`,
    title: `Variante ${n}`,
    sku: `L-${n}`,
    price: "10.00",
    inventoryPolicy: "DENY",
    inventoryItem: { id: `item-${n}` },
    selectedOptions: [],
  });
  const product = (handle: string, variantNumbers: number[], moreVariants = false) => ({
    id: `gid://shopify/Product/${handle}`,
    title: handle,
    handle,
    status: "ACTIVE",
    vendor: "",
    productType: "",
    tags: [],
    featuredMedia: null,
    variants: { pageInfo: { hasNextPage: moreVariants }, nodes: variantNumbers.map(variant) },
  });
  const ITEMS: Record<string, unknown> = {
    "item-1": {
      id: "item-1",
      tracked: true,
      unitCost: { amount: "4.5" },
      inventoryLevels: { pageInfo: { hasNextPage: false }, nodes: [level("gid://shopify/Location/111", 7, 9), level("gid://shopify/Location/222", 3)] },
    },
    "item-2": { id: "item-2", tracked: false, unitCost: null, inventoryLevels: { pageInfo: { hasNextPage: true }, nodes: [] } },
  };

  /** Fake mit Produktseiten und Bestandsabfrage per ID; unbekannte IDs liefert Shopify als null. */
  function shopify(productPages: unknown[][] = [[product("lampe", [1, 2])]], items: Record<string, unknown> = ITEMS) {
    return fakeShopify({
      scope: "read_products,read_inventory",
      graphql: (query: string, variables: Record<string, unknown>) => {
        if (query.includes("nodes(ids:")) return { data: { nodes: (variables.ids as string[]).map((id) => items[id] ?? null) } };
        const index = variables.after ? Number(variables.after) : 0;
        const hasNextPage = index + 1 < productPages.length;
        return { data: { products: { pageInfo: { hasNextPage, endCursor: hasNextPage ? String(index + 1) : null }, nodes: productPages[index] } } };
      },
    });
  }

  it("ordnet Bestand je Standort über die Lagerartikel-ID der Variante zu", async () => {
    const client = await createReadOnlyAdminClient(credentials, shopify().fetchImpl);
    const { products, missingVariants } = await readInventory(client, (await readAllProducts(client)).products);
    const [black, white] = products[0].variants;

    expect(missingVariants).toBe(0);
    expect(black.inventoryItemId).toBe("item-1");
    expect(black.inventory).toEqual({
      tracked: true,
      quantity: 10,
      unitCost: "4.50",
      locationsTruncated: false,
      locations: [
        { locationId: "gid://shopify/Location/111", locationName: "Standort 111", locationActive: null, available: 7, onHand: 9, committed: 2, incoming: 0 },
        { locationId: "gid://shopify/Location/222", locationName: "Standort 222", locationActive: null, available: 3, onHand: 3, committed: 0, incoming: 0 },
      ],
    });
    expect(white.inventory).toMatchObject({ tracked: false, quantity: null, unitCost: null, locationsTruncated: true });
  });

  it("fragt vom Standort nur die ID ab – Name und Aktiv-Status bräuchten read_locations", () => {
    const location = INVENTORY_ITEMS_QUERY.match(/location\s*\{([^}]*)\}/)?.[1].trim().split(/\s+/);
    expect(location).toEqual(["id"]);
  });

  it("fragt genau die Lagerartikel der gelesenen Varianten ab, in Paketen von 25", async () => {
    const numbers = Array.from({ length: 30 }, (_, i) => i + 1);
    const { calls, fetchImpl } = shopify([[product("viele", numbers)]]);
    const client = await createReadOnlyAdminClient(credentials, fetchImpl);
    await readInventory(client, (await readAllProducts(client)).products);
    const inventoryCalls = calls
      .filter((c) => c.url.endsWith("/graphql.json"))
      .map((c) => JSON.parse(c.body) as { query: string; variables: { ids?: string[] } })
      .filter((b) => b.query.includes("nodes(ids:"));
    expect(inventoryCalls.map((b) => b.variables?.ids?.length)).toEqual([25, 5]);
    expect(inventoryCalls.flatMap((b) => b.variables?.ids ?? [])).toEqual(numbers.map((n) => `item-${n}`));
  });

  it("meldet Varianten ohne Bestandsdaten, statt sie zu verschweigen", async () => {
    const client = await createReadOnlyAdminClient(credentials, shopify([[product("lampe", [1, 2, 3])]]).fetchImpl);
    const { products, missingVariants } = await readInventory(client, (await readAllProducts(client)).products);
    expect(missingVariants).toBe(1);
    expect(products[0].variants[2].inventory).toBeUndefined();
  });

  it("meldet abgeschnittene Produkt- und Variantenlisten", async () => {
    const pages = [[product("a", [1])], [product("b", [2], true)], [product("c", [3])]];
    const client = await createReadOnlyAdminClient(credentials, shopify(pages).fetchImpl);
    const all = await readAllProducts(client);
    expect(all).toMatchObject({ moreProducts: false, moreVariantsIn: ["b"] });
    expect(all.products.map((p) => p.handle)).toEqual(["a", "b", "c"]);
    const limited = await readAllProducts(client, { maxPages: 2 });
    expect(limited).toMatchObject({ moreProducts: true, moreVariantsIn: ["b"] });
  });

  it("sendet für den Bestand nur lesende Abfragen", async () => {
    const { calls, fetchImpl } = shopify();
    const client = await createReadOnlyAdminClient(credentials, fetchImpl);
    await readInventory(client, (await readAllProducts(client)).products);
    const documents = calls.slice(1).map((c) => (JSON.parse(c.body) as { query: string }).query);
    expect(documents).toHaveLength(2);
    for (const d of documents) expect(() => assertReadOnlyDocument(d)).not.toThrow();
    expect(documents[1]).toMatch(/quantities\(names: \["available","on_hand","committed","incoming"\]\)/);
  });

  it("meldet fehlendes read_inventory als Berechtigungsfehler ohne Zugangsdaten", async () => {
    const { fetchImpl } = fakeShopify({
      graphql: (query: string) =>
        query.includes("nodes(ids:")
          ? { errors: [1, 2, 3].map(() => ({ message: "Access denied for inventoryLevels field. Required access: `read_inventory` access scope." })) }
          : { data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [product("lampe", [1])] } } },
    });
    const client = await createReadOnlyAdminClient(credentials, fetchImpl);
    const { products } = await readAllProducts(client);
    const error = await readInventory(client, products).then(
      () => null,
      (e: unknown) => e,
    );
    if (!(error instanceof ShopifyConnectionError)) throw new Error("ShopifyConnectionError erwartet");
    expect(error.kind).toBe("scope");
    expect(error.message).toContain("read_inventory");
    expect(error.message.match(/Access denied/g)).toHaveLength(1);
    for (const secret of [credentials.clientSecret, credentials.clientId, "shpat_faketoken123456"]) expect(error.message).not.toContain(secret);
  });
});
