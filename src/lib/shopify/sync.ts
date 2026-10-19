// Produktabgleich Dashboard -> Shopify. Heute ausschließlich Dry-Run: Es gibt bewusst noch keinen
// HTTP-Transport (siehe src/lib/guards/safety.test.ts). Ein echter Transport wird erst ergänzt, wenn
// SAFETY_SWITCHES.shopifyWriteEnabled per Code-Review eingeschaltet wird.

import { SAFETY_SWITCHES } from "@/lib/config/budget";
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

export interface SyncOptions {
  /** Nur für Tests: Schalterstand überschreiben */
  writeEnabled?: boolean;
}

/**
 * Sendet die geplanten Produkte über den Transport. Echte Schreibzugriffe sind nur erlaubt, wenn
 * der Sicherheitsschalter an ist; Guards laufen in jedem Fall vor jedem Aufruf.
 */
export async function syncProducts(planned: PlannedProduct[], transport: ShopifyAdminTransport, options: SyncOptions = {}) {
  const writeEnabled = options.writeEnabled ?? SAFETY_SWITCHES.shopifyWriteEnabled;
  if (!transport.dryRun && !writeEnabled) {
    throw new Error("Shopify-Schreibzugriff ist deaktiviert (SAFETY_SWITCHES.shopifyWriteEnabled).");
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
