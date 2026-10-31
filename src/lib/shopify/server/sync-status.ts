// Ermittelt den Synchronisierungsstand für die Dashboard-Ansicht. Nur lesend, nur serverseitig.
// Das Ergebnis enthält nie Geheimnisse und darf an die Oberfläche gehen.

import "server-only";
import { getProductAnalyses } from "@/lib/data";
import { summarizeInventory, type InventoryOverview } from "../inventory";
import { reconcile, type ReconcileResult } from "../reconcile";
import { planProductSync } from "../sync";
import { createReadOnlyAdminClient, type ReadOnlyAdminClient } from "./admin-client";
import { isLocalDevelopment, readShopifyConfig, SHOPIFY_ENV } from "./config";
import { ShopifyConnectionError } from "./redact";
import { readAllProducts, readInventory, readShopInfo, type ProductsRead, type ShopInfo } from "./read-products";
import { loadSyncState, recordSync, type SyncState } from "./sync-state";

type ErrorKind = ShopifyConnectionError["kind"] | "unknown";

/** Bestandsteil: läuft getrennt, damit der Produktabgleich auch ohne read_inventory sichtbar bleibt. */
export type InventoryStatus =
  | { state: "missing-scope"; scope: "read_inventory" }
  | { state: "error"; kind: ErrorKind; message: string }
  | {
      state: "ok";
      overview: InventoryOverview;
      /** false = Bestand nur teilweise gelesen; zählt dann nicht als erfolgreiche Synchronisierung */
      complete: boolean;
    };

export type ShopifySyncStatus =
  | { state: "production-locked" }
  | { state: "not-configured"; missing: string[] }
  | { state: "invalid-config"; problems: string[] }
  | { state: "error"; kind: ErrorKind; message: string; lastSync: SyncState }
  | {
      state: "connected";
      shop: ShopInfo;
      apiVersion: string;
      fetchedAt: string;
      productCount: number;
      /** Mehr als die gelesene Menge vorhanden – Abgleich und Bestand sind dann unvollständig */
      moreProducts: boolean;
      moreVariantsIn: string[];
      result: ReconcileResult;
      inventory: InventoryStatus;
      lastSync: SyncState;
    };

function describeError(error: unknown): { kind: ErrorKind; message: string } {
  if (error instanceof ShopifyConnectionError) return { kind: error.kind, message: error.message };
  // Unerwartete Fehler nicht im Wortlaut ausgeben oder protokollieren – sie könnten Interna enthalten.
  const type = error instanceof Error ? error.name : typeof error;
  return { kind: "unknown", message: `Unerwarteter Fehler bei der Shopify-Abfrage (${type}).` };
}

export async function getShopifySyncStatus(): Promise<ShopifySyncStatus> {
  if (!isLocalDevelopment()) return { state: "production-locked" };

  const config = readShopifyConfig();
  if (config.status === "missing") return { state: "not-configured", missing: config.missing };
  if (config.status === "invalid") return { state: "invalid-config", problems: config.problems };

  let client: ReadOnlyAdminClient;
  let shop: ShopInfo;
  let read: ProductsRead;
  try {
    client = await createReadOnlyAdminClient(config.credentials);
    shop = await readShopInfo(client);
    read = await readAllProducts(client);
  } catch (error) {
    return { state: "error", ...describeError(error), lastSync: await loadSyncState() };
  }

  const fetchedAt = new Date().toISOString();
  const update: SyncState = { productsAt: fetchedAt, productCount: read.products.length };
  let products = read.products;

  let inventory: InventoryStatus;
  if (!client.scopes.includes("read_inventory")) {
    inventory = { state: "missing-scope", scope: "read_inventory" };
  } else {
    try {
      const withInventory = await readInventory(client, products);
      products = withInventory.products;
      const overview = summarizeInventory(products, { missingVariants: withInventory.missingVariants });
      const complete = overview.missingVariants === 0 && !overview.truncated && !read.moreProducts && read.moreVariantsIn.length === 0;
      inventory = { state: "ok", overview, complete };
      if (complete) {
        update.inventoryAt = fetchedAt;
        update.inventoryVariantCount = overview.rows.length;
      }
    } catch (error) {
      inventory = { state: "error", ...describeError(error) };
    }
  }

  const expected = planProductSync(getProductAnalyses()).map((p) => p.input);
  return {
    state: "connected",
    shop,
    apiVersion: client.apiVersion,
    fetchedAt,
    productCount: products.length,
    moreProducts: read.moreProducts,
    moreVariantsIn: read.moreVariantsIn,
    result: reconcile(expected, products, { inventoryRead: inventory.state === "ok" }),
    inventory,
    lastSync: await recordSync(update),
  };
}

export const SETUP_ENV_NAMES = [SHOPIFY_ENV.storeDomain, SHOPIFY_ENV.clientId, SHOPIFY_ENV.clientSecret];
