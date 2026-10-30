// Vergleicht echte Shopify-Produkte mit den Soll-Daten aus dem Dashboard (productSet-Planung).
// Reine Funktion ohne Netzwerk – vollständig testbar.

import { DEMO_MARKERS } from "./listings";
import type { ProductSetInput } from "./product-input";

/** Teilmenge der Admin-API-Produktdaten (lesbar mit read_products). */
export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED" | "UNLISTED";
  vendor: string;
  productType: string;
  tags: string[];
  variants: {
    id: string;
    title: string;
    sku: string | null;
    price: string;
    inventoryPolicy: "DENY" | "CONTINUE";
    selectedOptions: { name: string; value: string }[];
  }[];
}

export type FieldDiff = { field: string; expected: string; actual: string };

export type ReconcileRow =
  | { kind: "missing"; handle: string; title: string; expected: ProductSetInput }
  | { kind: "match" | "drift"; handle: string; title: string; matchedBy: "handle" | "sku"; shopifyId: string; diffs: FieldDiff[] };

export interface ReconcileResult {
  rows: ReconcileRow[];
  /** Produkte mit Demo-Merkmalen in Shopify, die das Dashboard nicht kennt */
  unknownDemo: ShopifyProduct[];
  /** Alle übrigen Shopify-Produkte (z. B. Shopify-Testdaten) */
  otherCount: number;
  summary: { expected: number; match: number; drift: number; missing: number };
}

const isDemoLike = (p: ShopifyProduct) =>
  p.tags.includes(DEMO_MARKERS.tag) ||
  p.handle.startsWith(DEMO_MARKERS.handlePrefix) ||
  p.variants.some((v) => v.sku?.startsWith(DEMO_MARKERS.skuPrefix));

function compareProduct(expected: ProductSetInput, actual: ShopifyProduct): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const add = (field: string, exp: string, act: string) => {
    if (exp !== act) diffs.push({ field, expected: exp, actual: act });
  };

  add("Titel", expected.title, actual.title);
  add("Handle", expected.handle, actual.handle);
  add("Status", expected.status, actual.status);
  add("Hersteller", expected.vendor, actual.vendor);
  add("Produkttyp", expected.productType, actual.productType);

  const missingTags = expected.tags.filter((t) => !actual.tags.includes(t));
  if (missingTags.length) diffs.push({ field: "Tags", expected: expected.tags.join(", "), actual: actual.tags.join(", ") || "–" });

  const actualBySku = new Map(actual.variants.map((v) => [v.sku ?? "", v]));
  for (const ev of expected.variants) {
    const sku = ev.inventoryItem.sku;
    const av = actualBySku.get(sku);
    if (!av) {
      diffs.push({ field: `Variante ${sku}`, expected: ev.optionValues.map((o) => o.name).join(" / "), actual: "fehlt" });
      continue;
    }
    add(`Preis ${sku}`, ev.price, Number(av.price).toFixed(2));
    add(`Überverkauf ${sku}`, ev.inventoryPolicy, av.inventoryPolicy);
    add(`Option ${sku}`, ev.optionValues.map((o) => o.name).join(" / "), av.selectedOptions.map((o) => o.value).join(" / "));
  }
  const expectedSkus = new Set(expected.variants.map((v) => v.inventoryItem.sku));
  for (const av of actual.variants) {
    if (!expectedSkus.has(av.sku ?? "")) diffs.push({ field: `Variante ${av.sku || av.title}`, expected: "nicht vorgesehen", actual: "vorhanden" });
  }
  return diffs;
}

export function reconcile(expected: ProductSetInput[], shopify: ShopifyProduct[]): ReconcileResult {
  const used = new Set<string>();
  const rows: ReconcileRow[] = expected.map((exp) => {
    const skus = new Set(exp.variants.map((v) => v.inventoryItem.sku));
    let matchedBy: "handle" | "sku" = "handle";
    let found = shopify.find((p) => p.handle === exp.handle);
    if (!found) {
      found = shopify.find((p) => p.variants.some((v) => v.sku && skus.has(v.sku)));
      matchedBy = "sku";
    }
    if (!found) return { kind: "missing", handle: exp.handle, title: exp.title, expected: exp };
    used.add(found.id);
    const diffs = compareProduct(exp, found);
    return { kind: diffs.length ? "drift" : "match", handle: exp.handle, title: found.title, matchedBy, shopifyId: found.id, diffs };
  });

  const rest = shopify.filter((p) => !used.has(p.id));
  const unknownDemo = rest.filter(isDemoLike);
  return {
    rows,
    unknownDemo,
    otherCount: rest.length - unknownDemo.length,
    summary: {
      expected: expected.length,
      match: rows.filter((r) => r.kind === "match").length,
      drift: rows.filter((r) => r.kind === "drift").length,
      missing: rows.filter((r) => r.kind === "missing").length,
    },
  };
}
