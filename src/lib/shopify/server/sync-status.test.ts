// Vollständigkeit der Synchronisierung: Unvollständige oder abgeschnittene Daten dürfen nie als
// erfolgreiche Synchronisierung gespeichert werden. Läuft durch die echte Lese-Pipeline mit Fake-Shopify.

import { beforeEach, describe, expect, it } from "vitest";
import { createReadOnlyAdminClient } from "./admin-client";
import { clearTokenCache, type FetchLike } from "./auth";
import { collectSync } from "./sync-status";
import { successfulParts } from "./sync-state";

const credentials = { storeDomain: "yakru.myshopify.com", clientId: "test-client-id-123", clientSecret: "test-secret-abcdef" };
const NOW = new Date("2026-10-31T10:00:00.000Z");

const level = (id: string, available: number) => ({
  location: { id },
  quantities: [
    { name: "available", quantity: available },
    { name: "on_hand", quantity: available },
    { name: "committed", quantity: 0 },
    { name: "incoming", quantity: 0 },
  ],
});
const item = (id: string, opts: { moreLocations?: boolean } = {}) => ({
  id,
  tracked: true,
  unitCost: null,
  inventoryLevels: { pageInfo: { hasNextPage: opts.moreLocations ?? false }, nodes: [level("a", 0)] },
});
const product = (n: number, opts: { moreVariants?: boolean } = {}) => ({
  id: `gid://shopify/Product/${n}`,
  title: `Produkt ${n}`,
  handle: `produkt-${n}`,
  status: "DRAFT",
  vendor: "",
  productType: "",
  tags: [],
  featuredMedia: null,
  media: { nodes: [] },
  variants: {
    pageInfo: { hasNextPage: opts.moreVariants ?? false },
    nodes: [{ id: `v${n}`, title: "Default Title", sku: `S-${n}`, price: "1.00", inventoryPolicy: "DENY", inventoryItem: { id: `item-${n}` }, selectedOptions: [] }],
  },
});

interface FakeOptions {
  scope?: string;
  products?: ReturnType<typeof product>[];
  /** Produkte melden immer eine weitere Seite (mehr als die Obergrenze vorhanden) */
  endlessProducts?: boolean;
  items?: Record<string, unknown>;
  inventoryError?: string;
}

function fakeShopify(o: FakeOptions = {}): FetchLike {
  const products = o.products ?? [product(1), product(2)];
  const items = o.items ?? { "item-1": item("item-1"), "item-2": item("item-2") };
  return async (url, init) => {
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
    if (url.endsWith("/admin/oauth/access_token")) {
      return json({ access_token: "shpat_faketoken123456", scope: o.scope ?? "read_products,read_inventory", expires_in: 86399 });
    }
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: { ids?: string[] } };
    if (query.includes("AiCommerceShopInfo")) {
      return json({ data: { shop: { name: "Yakru", myshopifyDomain: "yakru.myshopify.com", currencyCode: "EUR" }, currentAppInstallation: { accessScopes: [] } } });
    }
    if (query.includes("nodes(ids:")) {
      if (o.inventoryError) return json({ errors: [{ message: o.inventoryError }] });
      return json({ data: { nodes: (variables.ids ?? []).map((id) => items[id] ?? null) } });
    }
    return json({ data: { products: { pageInfo: { hasNextPage: o.endlessProducts ?? false, endCursor: "next" }, nodes: products } } });
  };
}

async function run(o: FakeOptions = {}) {
  const client = await createReadOnlyAdminClient(credentials, fakeShopify(o));
  const { status, outcome } = await collectSync(client, [], () => NOW);
  return { status, saved: successfulParts(outcome) };
}

const AT = NOW.toISOString();

beforeEach(() => clearTokenCache());

describe("Synchronisierung: nur Vollständiges gilt als Erfolg", () => {
  it("speichert Produkte und Bestand, wenn alles vollständig gelesen wurde", async () => {
    const { status, saved } = await run();
    expect(status.productsComplete).toBe(true);
    expect(status.inventory).toMatchObject({ state: "ok", complete: true });
    expect(saved).toEqual({ productsAt: AT, productCount: 2, inventoryAt: AT, inventoryVariantCount: 2 });
  });

  it("speichert ohne read_inventory nur die Produkte", async () => {
    const { status, saved } = await run({ scope: "read_products" });
    expect(status.inventory).toEqual({ state: "missing-scope", scope: "read_inventory" });
    expect(saved).toEqual({ productsAt: AT, productCount: 2 });
  });

  it("speichert bei einem Bestandsfehler nur die Produkte und meldet den Fehler", async () => {
    const { status, saved } = await run({ inventoryError: "Throttled" });
    expect(status.inventory).toMatchObject({ state: "error", kind: "api" });
    expect(saved).toEqual({ productsAt: AT, productCount: 2 });
  });

  it("speichert nichts, wenn mehr Produkte vorhanden sind, als gelesen wurden", async () => {
    const { status, saved } = await run({ endlessProducts: true });
    expect(status).toMatchObject({ moreProducts: true, productsComplete: false });
    expect(status.inventory).toMatchObject({ state: "ok", complete: false });
    expect(saved).toEqual({});
  });

  it("speichert nichts, wenn bei einem Produkt mehr als 100 Varianten vorhanden sind", async () => {
    const { status, saved } = await run({ products: [product(1), product(2, { moreVariants: true })] });
    expect(status).toMatchObject({ moreVariantsIn: ["produkt-2"], productsComplete: false });
    expect(saved).toEqual({});
  });

  it("speichert den Bestand nicht, wenn ein Artikel an mehr Standorten liegt, als gelesen wurden", async () => {
    const { status, saved } = await run({ items: { "item-1": item("item-1"), "item-2": item("item-2", { moreLocations: true }) } });
    expect(status.inventory).toMatchObject({ state: "ok", complete: false, overview: { truncated: true } });
    expect(saved).toEqual({ productsAt: AT, productCount: 2 });
  });

  it("speichert den Bestand nicht, wenn Shopify zu einer Variante keine Daten liefert", async () => {
    const { status, saved } = await run({ items: { "item-1": item("item-1") } });
    expect(status.inventory).toMatchObject({ state: "ok", complete: false, overview: { missingVariants: 1 } });
    expect(saved).toEqual({ productsAt: AT, productCount: 2 });
  });
});
