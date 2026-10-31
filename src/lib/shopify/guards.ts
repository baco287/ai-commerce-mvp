// Schutzregeln für jeden Schreibvorgang Richtung Shopify. Werden vor JEDEM Aufruf geprüft –
// auch im Dry-Run – damit eine Fehlkonfiguration früh auffällt.

import { DEMO_MARKERS, DEMO_NOTICE_HTML } from "./listings";
import { PUBLIC_DRAFT_METAFIELDS, type ProductSetInput } from "./product-input";

export class ShopifyGuardError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Shopify-Schreibvorgang blockiert: ${reasons.join(" ")}`);
    this.name = "ShopifyGuardError";
  }
}

/** Interne Felder, die nie kundensichtbar werden dürfen, und kundensichtbare Felder ohne Freigabe. */
const FORBIDDEN_METAFIELDS = new Set(["delivery_days_min", "delivery_days_max"]);
const PUBLIC_METAFIELDS = new Set<string>(PUBLIC_DRAFT_METAFIELDS);
const DEMO_WORD = /\bdemo\b/i;

/**
 * Demo-Kennzeichen einer Eingabe. Demo ist eine Eingabe nur, wenn ALLE vorliegen: Demo-Tag, Handle-Präfix, Titel-Präfix
 * und das Präfix JEDER SKU. Jede echte Teilmenge ist „gemischt“ – die Eingabe wird dann wie eine echte geprüft.
 */
export function demoMarkersOf(input: Pick<ProductSetInput, "tags" | "handle" | "title" | "variants">): { demo: boolean; mixed: boolean } {
  const marks = [
    input.tags.includes(DEMO_MARKERS.tag),
    input.handle.startsWith(DEMO_MARKERS.handlePrefix),
    input.title.startsWith(DEMO_MARKERS.titlePrefix),
    input.variants.length > 0 && input.variants.every((v) => v.inventoryItem.sku.startsWith(DEMO_MARKERS.skuPrefix)),
  ];
  const demo = marks.every(Boolean);
  const any = marks.some(Boolean) || input.variants.some((v) => v.inventoryItem.sku.startsWith(DEMO_MARKERS.skuPrefix));
  return { demo, mixed: any && !demo };
}

export function productInputViolations(input: ProductSetInput): string[] {
  const reasons: string[] = [];
  if (input.status !== "DRAFT") reasons.push(`Status "${input.status}" – automatisch angelegte Produkte müssen DRAFT sein.`);

  const { demo: isDemo, mixed } = demoMarkersOf(input);
  if (mixed) {
    reasons.push("Gemischte Demo-Kennzeichen – Demo nur mit Demo-Tag, demo-Handle, [DEMO]-Titel und DEMO-Präfix jeder SKU; geprüft wie ein echter Entwurf.");
  }

  for (const v of input.variants) {
    if (v.inventoryPolicy !== "DENY") reasons.push(`Variante ${v.inventoryItem.sku}: Überverkauf muss verboten sein (DENY).`);
    if (!v.inventoryItem.tracked) reasons.push(`Variante ${v.inventoryItem.sku}: Bestand muss verfolgt werden.`);
    if (!/^\d+\.\d{2}$/.test(v.price) || Number(v.price) <= 0) reasons.push(`Variante ${v.inventoryItem.sku}: ungültiger Preis "${v.price}".`);
  }

  for (const m of input.metafields) {
    if (FORBIDDEN_METAFIELDS.has(m.key)) reasons.push(`Metafeld ${m.key} ist kundensichtbar und braucht eine geprüfte Lieferzusage.`);
  }

  // Echte Entwürfe: nur öffentliche, laufunabhängige Angaben – keine Kosten, keine internen Metafelder, keine Demo-Kennzeichen
  if (!isDemo) {
    for (const m of input.metafields) {
      if (!PUBLIC_METAFIELDS.has(m.key)) reasons.push(`Metafeld ${m.key} ist nicht für echte Entwürfe freigegeben.`);
    }
    for (const v of input.variants) {
      if (v.inventoryItem.cost !== undefined) reasons.push(`Variante ${v.inventoryItem.sku}: Einkaufskosten (cost) sind in echten Entwürfen nicht erlaubt.`);
      if (v.inventoryItem.sku.toUpperCase().startsWith(DEMO_MARKERS.skuPrefix)) reasons.push(`Variante ${v.inventoryItem.sku}: Demo-Kennzeichen in der SKU eines echten Entwurfs.`);
    }
    if (input.title.includes(DEMO_MARKERS.titlePrefix.trim()) || DEMO_WORD.test(input.title)) reasons.push("Demo-Kennzeichen im Titel eines echten Entwurfs.");
    if (input.handle.toLowerCase().startsWith(DEMO_MARKERS.handlePrefix) || DEMO_WORD.test(input.handle)) reasons.push("Demo-Kennzeichen im Handle eines echten Entwurfs.");
    if (input.tags.some((t) => t === DEMO_MARKERS.tag || DEMO_WORD.test(t))) reasons.push("Demo-Kennzeichen in den Tags eines echten Entwurfs.");
    if (DEMO_WORD.test(input.productType)) reasons.push("Demo-Kennzeichen im Produkttyp eines echten Entwurfs.");
    if (input.descriptionHtml.includes(DEMO_NOTICE_HTML)) reasons.push("Demo-Hinweis in der Beschreibung eines echten Entwurfs.");
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
