// Liest Shop-Infos und Produkte über den Read-only-Client. Verändert nichts.

import "server-only";
import { PRODUCTS_QUERY, SHOP_INFO_QUERY } from "../graphql";
import type { ShopifyProduct } from "../reconcile";
import type { ReadOnlyAdminClient } from "./admin-client";

export interface ShopInfo {
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
  grantedScopes: string[];
}

export async function readShopInfo(client: ReadOnlyAdminClient): Promise<ShopInfo> {
  const data = await client.query<{
    shop: { name: string; myshopifyDomain: string; currencyCode: string };
    currentAppInstallation: { accessScopes: { handle: string }[] };
  }>(SHOP_INFO_QUERY);
  return {
    ...data.shop,
    grantedScopes: data.currentAppInstallation.accessScopes.map((s) => s.handle),
  };
}

/** Alle Produkte, seitenweise (Dev Store: wenige hundert Produkte, Obergrenze als Schutz). */
export async function readAllProducts(client: ReadOnlyAdminClient, maxPages = 10): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: (Omit<ShopifyProduct, "variants"> & { variants: { nodes: ShopifyProduct["variants"] } })[];
      };
    } = await client.query(PRODUCTS_QUERY, { first: 100, after });
    for (const node of data.products.nodes) products.push({ ...node, variants: node.variants.nodes });
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }
  return products;
}
