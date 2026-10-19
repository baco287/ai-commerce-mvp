// Übersetzt eine Dashboard-Produktanalyse in die Eingabe für die Shopify Admin GraphQL
// Mutation `productSet`. Reine Funktion ohne Netzwerkzugriff – testbar und im Dry-Run nutzbar.
//
// Feldnamen entsprechen dem Admin-GraphQL-Typ `ProductSetInput` (nur die genutzte Teilmenge).

import type { ProductAnalysis } from "@/lib/data";
import { DEMO_MARKERS, DEMO_NOTICE_HTML, type ProductListing } from "./listings";

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface MetafieldInput {
  namespace: "ai_commerce";
  key: string;
  type: "single_line_text_field" | "number_decimal" | "number_integer";
  value: string;
}

export interface VariantInput {
  optionValues: { optionName: string; name: string }[];
  price: string;
  inventoryPolicy: "DENY" | "CONTINUE";
  inventoryItem: { sku: string; cost: string; tracked: boolean; requiresShipping: boolean };
  taxable: boolean;
}

export interface ProductSetInput {
  handle: string;
  title: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  status: ProductStatus;
  productOptions: { name: string; position: number; values: { name: string }[] }[];
  variants: VariantInput[];
  metafields: MetafieldInput[];
}

/** Shopify-Konvention für Produkte ohne Varianten */
export const DEFAULT_OPTION = { name: "Title", value: "Default Title" } as const;

const money = (v: number) => v.toFixed(2);

/**
 * Baut die productSet-Eingabe. Grundsätze:
 * - Status immer DRAFT; Veröffentlichen ist ausschließlich eine manuelle Aktion im Shopify-Admin.
 * - Bestand wird verfolgt, ohne Bestand, Überverkauf verboten (inventoryPolicy DENY):
 *   Shopify selbst lehnt Warenkorb und Checkout ab – unabhängig vom Theme.
 * - Keine Lieferzeit-Metafelder: kundensichtbare Lieferzeiten nur aus geprüften Lieferantenverträgen.
 */
export function buildProductSetInput(analysis: ProductAnalysis, listing: ProductListing): ProductSetInput {
  if (analysis.product.id !== listing.productId) {
    throw new Error(`Listing ${listing.handle} gehört zu ${listing.productId}, nicht zu ${analysis.product.id}`);
  }
  const best = analysis.best;
  const optionName = listing.option ?? DEFAULT_OPTION.name;

  return {
    handle: listing.handle,
    title: listing.title,
    descriptionHtml: DEMO_NOTICE_HTML + listing.descriptionHtml,
    vendor: DEMO_MARKERS.vendor,
    productType: listing.productType,
    tags: [DEMO_MARKERS.tag, "demo", listing.categoryTag],
    status: "DRAFT",
    productOptions: [
      {
        name: optionName,
        position: 1,
        values: listing.variants.map((v) => ({ name: v.value ?? DEFAULT_OPTION.value })),
      },
    ],
    variants: listing.variants.map((v) => ({
      optionValues: [{ optionName, name: v.value ?? DEFAULT_OPTION.value }],
      price: money(analysis.product.targetPriceGross),
      inventoryPolicy: "DENY",
      inventoryItem: {
        sku: v.sku,
        cost: best ? money(best.landedCost) : "0.00",
        tracked: true,
        requiresShipping: true,
      },
      taxable: true,
    })),
    metafields: [
      { namespace: "ai_commerce", key: "dashboard_product_id", type: "single_line_text_field", value: analysis.product.id },
      ...(best
        ? ([
            { namespace: "ai_commerce", key: "supplier_offer_id", type: "single_line_text_field", value: best.offer.id },
            {
              namespace: "ai_commerce",
              key: "supplier_shipping_cost",
              type: "number_decimal",
              value: money(best.offer.shippingCost + best.offer.importCost),
            },
            { namespace: "ai_commerce", key: "supplier_stock", type: "number_integer", value: String(best.offer.stock) },
          ] satisfies MetafieldInput[])
        : []),
      ...(analysis.margin
        ? ([
            {
              namespace: "ai_commerce",
              key: "expected_margin_percent",
              type: "number_decimal",
              value: (analysis.margin.marginPercent * 100).toFixed(1),
            },
          ] satisfies MetafieldInput[])
        : []),
      { namespace: "ai_commerce", key: "compliance_status", type: "single_line_text_field", value: "offen" },
      { namespace: "ai_commerce", key: "approval_status", type: "single_line_text_field", value: "entwurf" },
    ],
  };
}
