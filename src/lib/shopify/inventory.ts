// Bestandsübersicht aus echten Shopify-Daten (read_inventory). Reine Funktionen ohne Netzwerk.
//
// Wichtig: Das ist der SHOPIFY-Bestand – die Mengen, die Shopify an den Standorten dieses Stores
// führt. Lieferantenbestände (Lager der Dropshipping-Partner) sind eine eigene Quelle und kommen
// später über eigene Lieferanten-Adapter und wird hier bewusst nicht vermischt.

import { isDemoLike, type LocationQuantity, type ShopifyProduct } from "./reconcile";

export type StockState = "untracked" | "oversold" | "out" | "low" | "ok";

export const STOCK_STATE_LABELS: Record<StockState, string> = {
  untracked: "nicht verfolgt",
  oversold: "überverkauft",
  out: "ausverkauft",
  low: "niedrig",
  ok: "verfügbar",
};

/** Ab dieser verfügbaren Menge (einschließlich) gilt der Bestand als niedrig. */
export const LOW_STOCK_THRESHOLD = 5;

export interface InventoryRow {
  /** Shopify-ID der Variante (eindeutig, auch bei fehlender oder doppelter SKU) */
  variantId: string;
  productTitle: string;
  productHandle: string;
  productStatus: ShopifyProduct["status"];
  variantTitle: string;
  sku: string | null;
  tracked: boolean;
  /** Summe „available“; null = Shopify liefert keine Standortdaten */
  available: number | null;
  state: StockState;
  /** Verkauf trotz Bestand 0 erlaubt (inventoryPolicy CONTINUE) */
  continueSelling: boolean;
  /** Demo-Produkt: Bestand 0 ist hier beabsichtigt (Kaufsperre) */
  demo: boolean;
  locations: LocationQuantity[];
}

export interface LocationTotal {
  id: string;
  name: string;
  active: boolean;
  available: number;
  onHand: number;
  committed: number;
  incoming: number;
}

export interface InventoryOverview {
  source: "shopify";
  rows: InventoryRow[];
  locations: LocationTotal[];
  counts: Record<StockState, number>;
  /** Mindestens ein Artikel liegt an mehr Standorten, als abgefragt wurden */
  truncated: boolean;
  /** Varianten, zu denen Shopify keine Bestandsdaten geliefert hat (fehlen in `rows`) */
  missingVariants: number;
}

export function classifyStock(tracked: boolean, available: number | null, threshold = LOW_STOCK_THRESHOLD): StockState {
  if (!tracked) return "untracked";
  const qty = available ?? 0;
  if (qty < 0) return "oversold";
  if (qty === 0) return "out";
  if (qty <= threshold) return "low";
  return "ok";
}

/** Fasst den Bestand aller Varianten zusammen, die mit read_inventory gelesen wurden. */
export function summarizeInventory(
  products: ShopifyProduct[],
  options: { threshold?: number; missingVariants?: number } = {},
): InventoryOverview {
  const threshold = options.threshold ?? LOW_STOCK_THRESHOLD;
  const rows: InventoryRow[] = [];
  const locations = new Map<string, LocationTotal>();
  let truncated = false;

  for (const p of products) {
    for (const v of p.variants) {
      const inv = v.inventory;
      if (!inv) continue;
      truncated ||= inv.locationsTruncated;
      rows.push({
        variantId: v.id,
        productTitle: p.title,
        productHandle: p.handle,
        productStatus: p.status,
        variantTitle: v.title,
        sku: v.sku,
        tracked: inv.tracked,
        available: inv.quantity,
        state: classifyStock(inv.tracked, inv.quantity, threshold),
        continueSelling: v.inventoryPolicy === "CONTINUE",
        demo: isDemoLike(p),
        locations: inv.locations,
      });
      for (const l of inv.locations) {
        const total = locations.get(l.locationId) ?? {
          id: l.locationId,
          name: l.locationName,
          active: l.locationActive,
          available: 0,
          onHand: 0,
          committed: 0,
          incoming: 0,
        };
        total.available += l.available;
        total.onHand += l.onHand;
        total.committed += l.committed;
        total.incoming += l.incoming;
        locations.set(l.locationId, total);
      }
    }
  }

  const counts: Record<StockState, number> = { untracked: 0, oversold: 0, out: 0, low: 0, ok: 0 };
  for (const r of rows) counts[r.state]++;

  return {
    source: "shopify",
    rows,
    locations: [...locations.values()].sort((a, b) => a.name.localeCompare(b.name, "de")),
    counts,
    truncated,
    missingVariants: options.missingVariants ?? 0,
  };
}
