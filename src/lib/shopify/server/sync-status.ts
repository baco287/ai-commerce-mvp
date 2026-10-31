// Ermittelt den Synchronisierungsstand für die Dashboard-Ansicht. Nur lesend, nur serverseitig.
// Das Ergebnis enthält nie Geheimnisse und darf an die Oberfläche gehen.

import "server-only";
import { getProductAnalyses } from "@/lib/data";
import { ShopifyGuardError } from "../guards";
import { summarizeInventory, type InventoryOverview } from "../inventory";
import type { ProductSetInput } from "../product-input";
import { reconcile, type ReconcileResult } from "../reconcile";
import { planProductSync } from "../sync";
import { createReadOnlyAdminClient, type ReadOnlyAdminClient } from "./admin-client";
import { isLocalDevelopment, readShopifyConfig, SHOPIFY_ENV } from "./config";
import { ShopifyConnectionError } from "./redact";
import { readAllProducts, readInventory, readShopInfo, type ShopInfo } from "./read-products";
import { loadSyncState, recordSync, successfulParts, type SyncOutcome, type SyncState } from "./sync-state";

type ErrorKind = ShopifyConnectionError["kind"] | "guard" | "unknown";

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

export interface ConnectedSync {
  state: "connected";
  shop: ShopInfo;
  apiVersion: string;
  fetchedAt: string;
  productCount: number;
  /** Mehr als die gelesene Menge vorhanden – Abgleich und Bestand sind dann unvollständig */
  moreProducts: boolean;
  moreVariantsIn: string[];
  /** Alle Produkte und Varianten gelesen – nur dann zählt die Abfrage als erfolgreiche Synchronisierung */
  productsComplete: boolean;
  result: ReconcileResult;
  inventory: InventoryStatus;
  lastSync: SyncState;
}

export type ShopifySyncStatus =
  | { state: "production-locked" }
  | { state: "not-configured"; missing: string[] }
  | { state: "invalid-config"; problems: string[] }
  | { state: "error"; kind: ErrorKind; message: string; lastSync: SyncState }
  | ConnectedSync;

export function describeError(error: unknown): { kind: ErrorKind; message: string } {
  if (error instanceof ShopifyConnectionError) return { kind: error.kind, message: error.message };
  if (error instanceof ShopifyGuardError) return { kind: "guard", message: `Von den Schutzregeln blockiert: ${error.reasons.join(" ")}` };
  // Unerwartete Fehler nicht im Wortlaut ausgeben oder protokollieren – sie könnten Interna enthalten.
  const type = error instanceof Error ? error.name : typeof error;
  return { kind: "unknown", message: `Unerwarteter Fehler bei der Shopify-Abfrage (${type}).` };
}

/**
 * Kern der Synchronisierung ohne Konfiguration und Speicher (mit Fake-Shopify testbar).
 * Fehler beim Lesen von Shop/Produkten werden geworfen; Bestandsfehler landen in `inventory`.
 * `outcome` sagt, was davon als erfolgreiche Synchronisierung gespeichert werden darf.
 */
export async function collectSync(
  client: ReadOnlyAdminClient,
  expected: ProductSetInput[],
  now: () => Date = () => new Date(),
): Promise<{ status: Omit<ConnectedSync, "lastSync">; outcome: SyncOutcome }> {
  const shop = await readShopInfo(client);
  const read = await readAllProducts(client);

  const fetchedAt = now().toISOString();
  const productsComplete = !read.moreProducts && read.moreVariantsIn.length === 0;
  const outcome: SyncOutcome = { fetchedAt, products: { count: read.products.length, complete: productsComplete } };
  let products = read.products;

  let inventory: InventoryStatus;
  if (!client.scopes.includes("read_inventory")) {
    inventory = { state: "missing-scope", scope: "read_inventory" };
  } else {
    try {
      const withInventory = await readInventory(client, products);
      products = withInventory.products;
      const overview = summarizeInventory(products, { missingVariants: withInventory.missingVariants });
      const complete = productsComplete && overview.missingVariants === 0 && !overview.truncated;
      inventory = { state: "ok", overview, complete };
      outcome.inventory = { variantCount: overview.rows.length, complete };
    } catch (error) {
      inventory = { state: "error", ...describeError(error) };
    }
  }

  return {
    status: {
      state: "connected",
      shop,
      apiVersion: client.apiVersion,
      fetchedAt,
      productCount: products.length,
      moreProducts: read.moreProducts,
      moreVariantsIn: read.moreVariantsIn,
      productsComplete,
      result: reconcile(expected, products, { inventoryRead: inventory.state === "ok" }),
      inventory,
    },
    outcome,
  };
}

export async function getShopifySyncStatus(): Promise<ShopifySyncStatus> {
  if (!isLocalDevelopment()) return { state: "production-locked" };

  const config = readShopifyConfig();
  if (config.status === "missing") return { state: "not-configured", missing: config.missing };
  if (config.status === "invalid") return { state: "invalid-config", problems: config.problems };

  let collected: Awaited<ReturnType<typeof collectSync>>;
  try {
    const client = await createReadOnlyAdminClient(config.credentials);
    collected = await collectSync(client, planProductSync(getProductAnalyses()).map((p) => p.input));
  } catch (error) {
    return { state: "error", ...describeError(error), lastSync: await loadSyncState() };
  }
  return { ...collected.status, lastSync: await recordSync(successfulParts(collected.outcome)) };
}

export const SETUP_ENV_NAMES = [SHOPIFY_ENV.storeDomain, SHOPIFY_ENV.clientId, SHOPIFY_ENV.clientSecret];
