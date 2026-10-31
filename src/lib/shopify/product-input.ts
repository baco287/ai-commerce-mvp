// Übersetzt Shop-Angaben in die Eingabe für die Shopify Admin GraphQL Mutation `productSet`.
// Reine Funktionen ohne Netzwerkzugriff – testbar und im Dry-Run nutzbar.
//
// Der Entwurf entsteht EINMAL in `buildDraftInput` (öffentliche, laufunabhängige Angaben, keine Kosten). Der Demo-Weg
// `buildProductSetInput` ist nur dessen Demo-Erweiterung (Kosten und interne Kalkulations-Metafelder der Demo-Produkte).
//
// Feldnamen entsprechen dem Admin-GraphQL-Typ `ProductSetInput` (nur die genutzte Teilmenge).

import type { ProductAnalysis } from "@/lib/data";
import { DEMO_MARKERS, DEMO_NOTICE_HTML, demoImageUrl, type ProductListing } from "./listings";

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
  /** `cost` (Einkaufskosten) nur im Demo-Weg; echte Entwürfe tragen nie Kosten (Guard-Regel) */
  inventoryItem: { sku: string; cost?: string; tracked: boolean; requiresShipping: boolean };
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
  /** Produktbilder; Shopify lädt sie von der öffentlichen Adresse */
  files: { originalSource: string; alt: string; contentType: "IMAGE" }[];
}

/** Shopify-Konvention für Produkte ohne Varianten */
export const DEFAULT_OPTION = { name: "Title", value: "Default Title" } as const;

/**
 * Phase 1: nur laufunabhängige, öffentliche Metafelder – Positivliste für echte Entwürfe (Guard-Regel).
 * Lauf-ID und Fingerabdruck setzt erst `shopify:sync` (Phase 2) beim Anlegen; Einkaufspreise, Konditionen, Lieferanten-
 * und Margenangaben gehören nie in einen echten Entwurf.
 */
export const PUBLIC_DRAFT_METAFIELDS = ["dashboard_product_id", "compliance_status", "approval_status"] as const;
export type PublicDraftMetafield = (typeof PUBLIC_DRAFT_METAFIELDS)[number];

/** Tag aller Entwürfe aus der Market-Pipeline (echte Produkte; Demo-Produkte tragen den Demo-Tag). */
export const PIPELINE_DRAFT_TAG = "ai-commerce-pipeline";

/** Neutrale Shop-Angaben eines Entwurfs (Demo-Listing oder Katalogprodukt). */
export interface DraftListing {
  handle: string;
  title: string;
  descriptionHtml: string;
  productType: string;
  categoryTag: string;
  /** Name der Option (z. B. „Farbe“); fehlt = Shopify-Konvention „Title“ */
  option?: string;
}

export interface DraftSpec {
  demo: boolean;
  /** Produkt-ID der Kontrollzentrale bzw. `catalog:<id>` (öffentliches Metafeld dashboard_product_id) */
  productRef: string;
  listing: DraftListing;
  variants: { shopSku: string; optionValue?: string; priceGross: number }[];
  /** Nur Bilder mit belegten Nutzungsrechten (echte Entwürfe) bzw. das gekennzeichnete Demo-Symbolbild */
  images: { url: string; alt: string }[];
  /** Bestätigte bzw. angegebene Marke; Demo-Entwürfe tragen immer den Demo-Vendor */
  vendor: string;
  /** GPSR-Block (verantwortliche Person in der EU, Sicherheitshinweise) – vom Store Manager erzeugt */
  gpsrHtml?: string;
}

const money = (v: number) => v.toFixed(2);

const metafield = (key: PublicDraftMetafield, value: string): MetafieldInput => ({ namespace: "ai_commerce", key, type: "single_line_text_field", value });

/**
 * Baut die productSet-Eingabe eines Entwurfs. Grundsätze:
 * - Status immer DRAFT; Veröffentlichen ist ausschließlich eine manuelle Aktion im Shopify-Admin.
 * - Bestand wird verfolgt, ohne Bestand, Überverkauf verboten (inventoryPolicy DENY):
 *   Shopify selbst lehnt Warenkorb und Checkout ab – unabhängig vom Theme.
 * - Keine Kosten, keine Lieferanten- oder Margen-Metafelder, keine Lauf-ID; nur PUBLIC_DRAFT_METAFIELDS.
 * - Keine Lieferzeit-Metafelder: kundensichtbare Lieferzeiten nur aus geprüften Lieferantenverträgen.
 * - Demo-Kennzeichen (Hinweis, Demo-Vendor, Demo-Tag) nur bei `demo`; Titel, Handle und SKUs bringt das Demo-Listing mit.
 */
export function buildDraftInput(spec: DraftSpec): ProductSetInput {
  const { listing } = spec;
  const optionName = listing.option ?? DEFAULT_OPTION.name;
  return {
    handle: listing.handle,
    title: listing.title,
    descriptionHtml: (spec.demo ? DEMO_NOTICE_HTML : "") + listing.descriptionHtml + (spec.gpsrHtml ?? ""),
    vendor: spec.demo ? DEMO_MARKERS.vendor : spec.vendor,
    productType: listing.productType,
    tags: spec.demo ? [DEMO_MARKERS.tag, "demo", listing.categoryTag] : [PIPELINE_DRAFT_TAG, listing.categoryTag],
    status: "DRAFT",
    productOptions: [
      {
        name: optionName,
        position: 1,
        values: spec.variants.map((v) => ({ name: v.optionValue ?? DEFAULT_OPTION.value })),
      },
    ],
    variants: spec.variants.map((v) => ({
      optionValues: [{ optionName, name: v.optionValue ?? DEFAULT_OPTION.value }],
      price: money(v.priceGross),
      inventoryPolicy: "DENY",
      inventoryItem: { sku: v.shopSku, tracked: true, requiresShipping: true },
      taxable: true,
    })),
    files: spec.images.map((img) => ({ originalSource: img.url, alt: img.alt, contentType: "IMAGE" })),
    metafields: [metafield("dashboard_product_id", spec.productRef), metafield("compliance_status", "offen"), metafield("approval_status", "entwurf")],
  };
}

/** Entwurfs-Angaben eines Demo-Listings (Demo-Symbolbild, Varianten aus dem Listing, ein Preis für alle Varianten). */
export function demoDraftSpec(listing: ProductListing, priceGross: number, gpsrHtml?: string): DraftSpec {
  return {
    demo: true,
    productRef: listing.productId,
    listing,
    variants: listing.variants.map((v) => ({ shopSku: v.sku, ...(v.value !== undefined && { optionValue: v.value }), priceGross })),
    images: [{ url: demoImageUrl(listing.handle), alt: listing.imageAlt }],
    vendor: DEMO_MARKERS.vendor,
    ...(gpsrHtml !== undefined && { gpsrHtml }),
  };
}

/**
 * Demo-Weg (Kontrollzentrale, `shopify:sync`): `buildDraftInput` + Demo-Erweiterung – Kosten je Variante und die
 * internen Kalkulations-Metafelder (supplier_*, expected_margin_percent) der Demo-Produkte.
 *
 * Wirft, wenn die Kalkulationsbasis KEIN Demo-Angebot ist (echtes, nicht synthetisches Preislisten-Angebot):
 * Konditionen echter Lieferanten gelangen so nie über den Demo-Weg in Shopify-Felder oder Metafelder.
 */
export function buildProductSetInput(analysis: ProductAnalysis, listing: ProductListing): ProductSetInput {
  if (analysis.product.id !== listing.productId) {
    throw new Error(`Listing ${listing.handle} gehört zu ${listing.productId}, nicht zu ${analysis.product.id}`);
  }
  const best = analysis.best;
  if (best) {
    const quote = [...analysis.scout.eligible, ...analysis.scout.excluded].find((e) => e.quote.id === best.offer.id)?.quote;
    if (!quote || !quote.demo) {
      throw new Error(
        `Kalkulationsbasis von ${listing.productId} ist kein Demo-Angebot – Konditionen echter Lieferanten gelangen nie über den Demo-Weg nach Shopify.`,
      );
    }
  }

  const base = buildDraftInput(demoDraftSpec(listing, analysis.product.targetPriceGross));
  const [productId, ...rest] = base.metafields;
  return {
    ...base,
    variants: base.variants.map((v) => ({
      ...v,
      inventoryItem: { sku: v.inventoryItem.sku, cost: best ? money(best.landedCost) : "0.00", tracked: v.inventoryItem.tracked, requiresShipping: v.inventoryItem.requiresShipping },
    })),
    metafields: [
      productId,
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
      ...rest,
    ],
  };
}
