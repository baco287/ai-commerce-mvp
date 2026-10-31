// Kopplung Produkt (Kontrollzentrale) ↔ Supplier Scout ↔ Shopify-Produkt und -Varianten.
// Reine Funktion – macht sichtbar, wo die Zuordnung für eine spätere Automatisierung noch fehlt.
//
//   Produkt-ID (p-led) ──► ProductQuery (GTIN, Pflichtnachweise) ──► Lieferantenangebote (Scout)
//        │                                                                 │
//        └──► Shopify-Listing (Handle, Varianten-SKUs) ◄── Metafeld ai_commerce.supplier_offer_id
//                                                         (Angebots-ID der Kalkulationsbasis)
//
// Heute gelten Angebote je PRODUKT. Für Varianten (z. B. Farben) braucht es später je Variante die
// Artikelnummer des Lieferanten – `variantsWithoutSupplierSku` weist diese Lücke aus.

import type { ProductListing } from "@/lib/shopify/listings";
import type { Product } from "@/lib/types";
import type { ProductQuery } from "./model";

export interface SupplierProductLink {
  productId: string;
  productName: string;
  gtin: string | null;
  shopifyHandle: string | null;
  shopifySkus: string[];
  /** Angebots-ID, die als ai_commerce.supplier_offer_id an Shopify geht (Kalkulationsbasis) */
  supplierOfferId: string | null;
  /** Shopify-Varianten, für die noch keine Lieferanten-Artikelnummer zugeordnet ist */
  variantsWithoutSupplierSku: string[];
  /** Harte Lücken: ohne sie ist keine automatische Kopplung möglich */
  problems: string[];
}

export function buildSupplierLinks(input: {
  products: Product[];
  queries: Record<string, ProductQuery>;
  listings: ProductListing[];
  /** Angebots-ID der Kalkulationsbasis je Produkt-ID */
  calculationBasis: Record<string, string | undefined>;
  /** Lieferanten-Artikelnummern je Shopify-SKU (heute leer – Angebote gelten je Produkt) */
  supplierSkuByShopifySku?: Record<string, string>;
}): SupplierProductLink[] {
  const supplierSkus = input.supplierSkuByShopifySku ?? {};
  const allSkus = input.listings.flatMap((l) => l.variants.map((v) => v.sku));
  const duplicateSkus = new Set(allSkus.filter((s, i) => allSkus.indexOf(s) !== i));

  return input.products.map((product) => {
    const query = input.queries[product.id];
    const listing = input.listings.find((l) => l.productId === product.id);
    const skus = listing?.variants.map((v) => v.sku) ?? [];
    const problems: string[] = [];
    if (!query) problems.push("Keine Lieferanten-Suchanfrage (ProductQuery).");
    else if (!query.gtin) problems.push("Keine GTIN – Lieferantenangebote nicht eindeutig zuordenbar.");
    if (!listing) problems.push("Kein Shopify-Listing (Handle, Varianten).");
    for (const sku of skus) if (duplicateSkus.has(sku)) problems.push(`SKU ${sku} ist mehrfach vergeben.`);
    const supplierOfferId = input.calculationBasis[product.id] ?? null;
    if (!supplierOfferId) problems.push("Kein geeigneter Lieferant als Kalkulationsbasis.");

    return {
      productId: product.id,
      productName: product.name,
      gtin: query?.gtin ?? null,
      shopifyHandle: listing?.handle ?? null,
      shopifySkus: skus,
      supplierOfferId,
      variantsWithoutSupplierSku: skus.filter((s) => !supplierSkus[s]),
      problems,
    };
  });
}
