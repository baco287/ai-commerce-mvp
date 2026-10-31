// Liest Shop-Infos und Produkte über den Read-only-Client. Verändert nichts.

import "server-only";
import { INVENTORY_QUERY, PRODUCTS_QUERY, SHOP_INFO_QUERY } from "../graphql";
import type { ShopifyProduct, VariantInventory } from "../reconcile";
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

interface Page<T> {
  products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] };
}

/** Liest alle Seiten einer Produktabfrage (Obergrenze als Schutz). */
async function readPages<T>(client: ReadOnlyAdminClient, query: string, maxPages: number): Promise<T[]> {
  const nodes: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const data: Page<T> = await client.query(query, { first: 100, after });
    nodes.push(...data.products.nodes);
    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
  }
  return nodes;
}

type ProductNode = Omit<ShopifyProduct, "variants"> & { variants: { nodes: Omit<ShopifyProduct["variants"][number], "inventory">[] } };
type InventoryNode = {
  id: string;
  variants: {
    nodes: { id: string; inventoryQuantity: number | null; inventoryItem: { tracked: boolean; unitCost: { amount: string } | null } }[];
  };
};

/**
 * Alle Produkte mit Varianten. Mit `withInventory` zusätzlich Bestand und Kosten je Variante
 * (nur sinnvoll, wenn die App read_inventory hat).
 */
export async function readAllProducts(client: ReadOnlyAdminClient, options: { withInventory?: boolean; maxPages?: number } = {}) {
  const maxPages = options.maxPages ?? 10;
  const products = await readPages<ProductNode>(client, PRODUCTS_QUERY, maxPages);

  const inventory = new Map<string, VariantInventory>();
  if (options.withInventory) {
    for (const p of await readPages<InventoryNode>(client, INVENTORY_QUERY, maxPages)) {
      for (const v of p.variants.nodes) {
        inventory.set(v.id, {
          tracked: v.inventoryItem.tracked,
          quantity: v.inventoryQuantity,
          unitCost: v.inventoryItem.unitCost ? Number(v.inventoryItem.unitCost.amount).toFixed(2) : null,
        });
      }
    }
  }

  return products.map(
    (p): ShopifyProduct => ({
      ...p,
      variants: p.variants.nodes.map((v) => ({ ...v, inventory: inventory.get(v.id) })),
    }),
  );
}
