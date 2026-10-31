// Produktabgleich Dashboard -> Shopify: Planung und Dry-Run (Vorschau im Dashboard).
// Echte Schreibzugriffe laufen NICHT hierüber, sondern ausschließlich über den abgesicherten
// Schreib-Client in server/admin-client.ts mit der Positivliste aus write-operations.ts.
// syncProducts nimmt daher nur Dry-Run-Transporte an.

import type { ProductAnalysis } from "@/lib/data";
import { assertOperationAllowed, assertProductInputAllowed } from "./guards";
import { PRODUCT_SET_MUTATION } from "./graphql";
import { DEMO_LISTINGS, type ProductListing } from "./listings";
import { buildProductSetInput, type ProductSetInput } from "./product-input";

export interface ShopifyAdminTransport {
  /** true = sendet nichts, protokolliert nur */
  readonly dryRun: boolean;
  execute(query: string, variables: Record<string, unknown>): Promise<unknown>;
}

export interface RecordedCall {
  query: string;
  variables: Record<string, unknown>;
}

/** Protokolliert Aufrufe statt sie zu senden. */
export class DryRunTransport implements ShopifyAdminTransport {
  readonly dryRun = true;
  readonly calls: RecordedCall[] = [];
  async execute(query: string, variables: Record<string, unknown>) {
    this.calls.push({ query, variables });
    return { dryRun: true };
  }
}

export interface PlannedProduct {
  productId: string;
  input: ProductSetInput;
}

/** Plant die Shopify-Eingaben für alle Produkte mit Shop-Angaben. */
export function planProductSync(analyses: ProductAnalysis[], listings: ProductListing[] = DEMO_LISTINGS): PlannedProduct[] {
  const byId = new Map(analyses.map((a) => [a.product.id, a]));
  return listings.map((listing) => {
    const analysis = byId.get(listing.productId);
    if (!analysis) throw new Error(`Keine Dashboard-Analyse für ${listing.productId}`);
    return { productId: listing.productId, input: buildProductSetInput(analysis, listing) };
  });
}

/**
 * Spielt die geplanten Produkte im Dry-Run durch. Guards laufen vor jedem Aufruf. Echte Transporte
 * werden abgelehnt – es gibt genau einen Schreibweg (Schreib-Client in server/admin-client.ts).
 */
export async function syncProducts(planned: PlannedProduct[], transport: ShopifyAdminTransport) {
  if (!transport.dryRun) {
    throw new Error("syncProducts ist nur ein Dry-Run. Echte Schreibzugriffe laufen nur über npm run shopify:sync.");
  }
  assertOperationAllowed(PRODUCT_SET_MUTATION);

  const results = [];
  for (const { productId, input } of planned) {
    assertProductInputAllowed(input);
    const response = await transport.execute(PRODUCT_SET_MUTATION, { input, identifier: { handle: input.handle } });
    results.push({ productId, handle: input.handle, response });
  }
  return results;
}
