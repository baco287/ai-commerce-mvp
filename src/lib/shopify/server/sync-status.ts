// Ermittelt den Synchronisierungsstand für die Dashboard-Ansicht. Nur lesend, nur serverseitig.
// Das Ergebnis enthält nie Geheimnisse und darf an die Oberfläche gehen.

import "server-only";
import { getProductAnalyses } from "@/lib/data";
import { reconcile, type ReconcileResult } from "../reconcile";
import { planProductSync } from "../sync";
import { createReadOnlyAdminClient } from "./admin-client";
import { isLocalDevelopment, readShopifyConfig, SHOPIFY_ENV } from "./config";
import { ShopifyConnectionError } from "./redact";
import { readAllProducts, readShopInfo, type ShopInfo } from "./read-products";

export type ShopifySyncStatus =
  | { state: "production-locked" }
  | { state: "not-configured"; missing: string[] }
  | { state: "invalid-config"; problems: string[] }
  | { state: "error"; kind: ShopifyConnectionError["kind"] | "unknown"; message: string }
  | {
      state: "connected";
      shop: ShopInfo;
      apiVersion: string;
      fetchedAt: string;
      productCount: number;
      result: ReconcileResult;
    };

export async function getShopifySyncStatus(): Promise<ShopifySyncStatus> {
  if (!isLocalDevelopment()) return { state: "production-locked" };

  const config = readShopifyConfig();
  if (config.status === "missing") return { state: "not-configured", missing: config.missing };
  if (config.status === "invalid") return { state: "invalid-config", problems: config.problems };

  try {
    const client = await createReadOnlyAdminClient(config.credentials);
    const shop = await readShopInfo(client);
    const products = await readAllProducts(client);
    const expected = planProductSync(getProductAnalyses()).map((p) => p.input);
    return {
      state: "connected",
      shop,
      apiVersion: client.apiVersion,
      fetchedAt: new Date().toISOString(),
      productCount: products.length,
      result: reconcile(expected, products),
    };
  } catch (error) {
    if (error instanceof ShopifyConnectionError) return { state: "error", kind: error.kind, message: error.message };
    // Unerwartete Fehler nicht im Wortlaut ausgeben oder protokollieren – sie könnten Interna enthalten.
    const type = error instanceof Error ? error.name : typeof error;
    return { state: "error", kind: "unknown", message: `Unerwarteter Fehler bei der Shopify-Abfrage (${type}).` };
  }
}

export const SETUP_ENV_NAMES = [SHOPIFY_ENV.storeDomain, SHOPIFY_ENV.clientId, SHOPIFY_ENV.clientSecret];
