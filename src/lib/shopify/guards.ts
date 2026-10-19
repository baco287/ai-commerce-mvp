// Schutzregeln für jeden Schreibvorgang Richtung Shopify. Werden vor JEDEM Aufruf geprüft –
// auch im Dry-Run – damit eine Fehlkonfiguration früh auffällt.

import { DEMO_MARKERS } from "./listings";
import type { ProductSetInput } from "./product-input";

export class ShopifyGuardError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Shopify-Schreibvorgang blockiert: ${reasons.join(" ")}`);
    this.name = "ShopifyGuardError";
  }
}

/** Interne Felder, die nie kundensichtbar werden dürfen, und kundensichtbare Felder ohne Freigabe. */
const FORBIDDEN_METAFIELDS = new Set(["delivery_days_min", "delivery_days_max"]);

export function productInputViolations(input: ProductSetInput): string[] {
  const reasons: string[] = [];
  if (input.status !== "DRAFT") reasons.push(`Status "${input.status}" – automatisch angelegte Produkte müssen DRAFT sein.`);

  const isDemo = input.tags.includes(DEMO_MARKERS.tag);
  if (isDemo) {
    if (!input.title.startsWith(DEMO_MARKERS.titlePrefix)) reasons.push("Demo-Produkt ohne [DEMO]-Titel.");
    if (!input.handle.startsWith(DEMO_MARKERS.handlePrefix)) reasons.push("Demo-Produkt ohne demo-Handle.");
  }

  for (const v of input.variants) {
    if (v.inventoryPolicy !== "DENY") reasons.push(`Variante ${v.inventoryItem.sku}: Überverkauf muss verboten sein (DENY).`);
    if (!v.inventoryItem.tracked) reasons.push(`Variante ${v.inventoryItem.sku}: Bestand muss verfolgt werden.`);
    if (isDemo && !v.inventoryItem.sku.startsWith(DEMO_MARKERS.skuPrefix)) reasons.push(`Variante ${v.inventoryItem.sku}: SKU ohne DEMO-Präfix.`);
    if (!/^\d+\.\d{2}$/.test(v.price) || Number(v.price) <= 0) reasons.push(`Variante ${v.inventoryItem.sku}: ungültiger Preis "${v.price}".`);
  }

  for (const m of input.metafields) {
    if (FORBIDDEN_METAFIELDS.has(m.key)) reasons.push(`Metafeld ${m.key} ist kundensichtbar und braucht eine geprüfte Lieferzusage.`);
  }
  return reasons;
}

export function assertProductInputAllowed(input: ProductSetInput): void {
  const reasons = productInputViolations(input);
  if (reasons.length) throw new ShopifyGuardError(reasons);
}

/**
 * Prüft eine GraphQL-Operation, bevor sie gesendet wird. Veröffentlichen und Aktivieren sind
 * grundsätzlich verboten – unabhängig von Schaltern.
 */
export function assertOperationAllowed(query: string): void {
  const forbidden = [/\bpublishablePublish\b/, /\bproductPublish\b/, /\bpublicationCreate\b/, /status:\s*ACTIVE/, /\borderCreate\b/, /\bdraftOrderComplete\b/];
  const hit = forbidden.find((re) => re.test(query));
  if (hit) throw new ShopifyGuardError([`Operation enthält verbotenen Aufruf (${hit}).`]);
}
