// Liest Shop-Infos, Produkte und Bestand über den Read-only-Client. Verändert nichts.

import "server-only";
import { INVENTORY_ITEMS_PER_QUERY, INVENTORY_ITEMS_QUERY, PRODUCTS_QUERY, SHOP_INFO_QUERY } from "../graphql";
import type { LocationQuantity, ShopifyProduct, VariantInventory } from "../reconcile";
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

interface Connection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

type ProductNode = Omit<ShopifyProduct, "variants"> & {
  variants: {
    pageInfo: { hasNextPage: boolean };
    nodes: (Omit<ShopifyProduct["variants"][number], "inventory" | "inventoryItemId"> & { inventoryItem: { id: string } })[];
  };
};

export interface ProductsRead {
  products: ShopifyProduct[];
  /** Mehr Produkte vorhanden, als gelesen wurden (Obergrenze maxPages × 100) */
  moreProducts: boolean;
  /** Handles der Produkte mit mehr als 100 Varianten (nur die ersten 100 gelesen) */
  moreVariantsIn: string[];
}

/** Alle Produkte mit Varianten (read_products). Abgeschnittene Mengen werden gemeldet, nie verschwiegen. */
export async function readAllProducts(client: ReadOnlyAdminClient, options: { maxPages?: number } = {}): Promise<ProductsRead> {
  const maxPages = options.maxPages ?? 10;
  const nodes: ProductNode[] = [];
  let after: string | null = null;
  let moreProducts = false;
  for (let page = 0; page < maxPages; page++) {
    const data: { products: Connection<ProductNode> } = await client.query(PRODUCTS_QUERY, { first: 100, after });
    nodes.push(...data.products.nodes);
    moreProducts = data.products.pageInfo.hasNextPage;
    if (!moreProducts) break;
    after = data.products.pageInfo.endCursor;
  }
  return {
    products: nodes.map(({ variants, ...p }) => ({
      ...p,
      variants: variants.nodes.map(({ inventoryItem, ...v }) => ({ ...v, inventoryItemId: inventoryItem.id })),
    })),
    moreProducts,
    moreVariantsIn: nodes.filter((p) => p.variants.pageInfo.hasNextPage).map((p) => p.handle),
  };
}

interface InventoryItemNode {
  id: string;
  tracked: boolean;
  unitCost: { amount: string } | null;
  inventoryLevels: {
    pageInfo: { hasNextPage: boolean };
    nodes: { location: { id: string; name: string; isActive: boolean }; quantities: { name: string; quantity: number }[] }[];
  };
}

export function toVariantInventory(item: InventoryItemNode): VariantInventory {
  const locations = item.inventoryLevels.nodes.map((level): LocationQuantity => {
    const q = (name: string) => level.quantities.find((x) => x.name === name)?.quantity ?? 0;
    return {
      locationId: level.location.id,
      locationName: level.location.name,
      locationActive: level.location.isActive,
      available: q("available"),
      onHand: q("on_hand"),
      committed: q("committed"),
      incoming: q("incoming"),
    };
  });
  return {
    tracked: item.tracked,
    quantity: locations.length ? locations.reduce((sum, l) => sum + l.available, 0) : null,
    unitCost: item.unitCost ? Number(item.unitCost.amount).toFixed(2) : null,
    locations,
    locationsTruncated: item.inventoryLevels.pageInfo.hasNextPage,
  };
}

export interface InventoryRead {
  products: ShopifyProduct[];
  /** Varianten, zu deren Lagerartikel Shopify keine Daten geliefert hat */
  missingVariants: number;
}

/**
 * Ergänzt die Produkte um Bestand je Standort, Bestandsverfolgung und Kosten (read_inventory).
 * Fragt genau die Lagerartikel der übergebenen Varianten ab, in kleinen Paketen.
 * Nur aufrufen, wenn die App dieses Recht hat – sonst meldet Shopify „Access denied“.
 */
export async function readInventory(client: ReadOnlyAdminClient, products: ShopifyProduct[]): Promise<InventoryRead> {
  const ids = [...new Set(products.flatMap((p) => p.variants.map((v) => v.inventoryItemId).filter((id): id is string => Boolean(id))))];
  const byId = new Map<string, VariantInventory>();
  for (let i = 0; i < ids.length; i += INVENTORY_ITEMS_PER_QUERY) {
    const data = await client.query<{ nodes: (InventoryItemNode | null)[] }>(INVENTORY_ITEMS_QUERY, { ids: ids.slice(i, i + INVENTORY_ITEMS_PER_QUERY) });
    for (const item of data.nodes) if (item?.inventoryLevels) byId.set(item.id, toVariantInventory(item));
  }

  let missingVariants = 0;
  const withInventory = products.map((p) => ({
    ...p,
    variants: p.variants.map((v) => {
      const inventory = v.inventoryItemId ? byId.get(v.inventoryItemId) : undefined;
      if (!inventory) {
        missingVariants++;
        return v;
      }
      return { ...v, inventory };
    }),
  }));
  return { products: withInventory, missingVariants };
}
