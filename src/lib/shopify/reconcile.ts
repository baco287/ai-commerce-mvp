// Vergleicht echte Shopify-Produkte mit den Soll-Daten aus dem Dashboard (productSet-Planung).
// Reine Funktion ohne Netzwerk – vollständig testbar.

import { DEMO_MARKERS } from "./listings";
import type { ProductSetInput } from "./product-input";

/** Mengen eines Lagerartikels an einem Shopify-Standort. */
export interface LocationQuantity {
  locationId: string;
  locationName: string;
  /** null = unbekannt (nur mit read_locations lesbar, nicht freigegeben) */
  locationActive: boolean | null;
  /** verkaufbar */
  available: number;
  /** physisch vorhanden (inkl. reserviert) */
  onHand: number;
  /** durch offene Bestellungen reserviert */
  committed: number;
  /** erwarteter Zugang */
  incoming: number;
}

/** Bestand und Kosten einer Variante (nur mit read_inventory verfügbar). */
export interface VariantInventory {
  tracked: boolean;
  /** Summe „available“ über alle Standorte; null = keine Standortdaten */
  quantity: number | null;
  /** „Kosten pro Artikel“, zwei Nachkommastellen; null = nicht gepflegt */
  unitCost: string | null;
  locations: LocationQuantity[];
  /** true, wenn der Artikel an mehr Standorten geführt wird, als abgefragt wurden */
  locationsTruncated: boolean;
}

/** Teilmenge der Admin-API-Produktdaten (lesbar mit read_products, Bestand mit read_inventory). */
export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED" | "UNLISTED";
  vendor: string;
  productType: string;
  tags: string[];
  /** Hauptbild; null = kein Bild */
  featuredMedia: { id: string } | null;
  variants: {
    id: string;
    title: string;
    sku: string | null;
    price: string;
    inventoryPolicy: "DENY" | "CONTINUE";
    selectedOptions: { name: string; value: string }[];
    /** Lagerartikel-ID; verknüpft die Variante mit den Bestandsdaten */
    inventoryItemId?: string;
    /** undefined = nicht gelesen (App ohne read_inventory) */
    inventory?: VariantInventory;
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
  /** Wurden Bestand und Kosten mitverglichen (read_inventory vorhanden)? */
  inventoryChecked: boolean;
  summary: { expected: number; match: number; drift: number; missing: number };
}

export const isDemoLike = (p: ShopifyProduct) =>
  p.tags.includes(DEMO_MARKERS.tag) ||
  p.handle.startsWith(DEMO_MARKERS.handlePrefix) ||
  p.variants.some((v) => v.sku?.startsWith(DEMO_MARKERS.skuPrefix));

export interface ReconcileOptions {
  /**
   * Bestand wurde gelesen (read_inventory vorhanden, Abfrage erfolgreich). Dann gilt eine Variante
   * ohne Bestandsdaten als Abweichung – sonst bliebe eine gebrochene Kaufsperre unbemerkt.
   */
  inventoryRead?: boolean;
}

function compareProduct(expected: ProductSetInput, actual: ShopifyProduct, options: ReconcileOptions): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const add = (field: string, exp: string, act: string) => {
    if (exp !== act) diffs.push({ field, expected: exp, actual: act });
  };

  add("Titel", expected.title, actual.title);
  add("Handle", expected.handle, actual.handle);
  add("Status", expected.status, actual.status);
  add("Hersteller", expected.vendor, actual.vendor);
  add("Produkttyp", expected.productType, actual.productType);

  if (expected.files.length > 0) add("Produktbild", "vorhanden", actual.featuredMedia ? "vorhanden" : "fehlt");

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
    if (av.inventory) {
      // Demo-Produkte: Bestand verfolgt und 0 – Shopify sperrt damit Warenkorb und Checkout serverseitig.
      // Ohne Standort (quantity null) ist nichts verkaufbar, das entspricht 0.
      add(`Bestand verfolgt ${sku}`, ev.inventoryItem.tracked ? "ja" : "nein", av.inventory.tracked ? "ja" : "nein");
      const quantity = String(av.inventory.quantity ?? 0);
      add(`Bestand ${sku}`, "0", av.inventory.locationsTruncated ? `${quantity}+ (unvollständig, mehr als 10 Standorte)` : quantity);
      add(`Kosten ${sku}`, ev.inventoryItem.cost, av.inventory.unitCost ?? "nicht gepflegt");
    } else if (options.inventoryRead) {
      diffs.push({ field: `Bestand ${sku}`, expected: "0", actual: "nicht gelesen" });
    }
  }
  const expectedSkus = new Set(expected.variants.map((v) => v.inventoryItem.sku));
  for (const av of actual.variants) {
    if (!expectedSkus.has(av.sku ?? "")) diffs.push({ field: `Variante ${av.sku || av.title}`, expected: "nicht vorgesehen", actual: "vorhanden" });
  }
  return diffs;
}

export function reconcile(expected: ProductSetInput[], shopify: ShopifyProduct[], options: ReconcileOptions = {}): ReconcileResult {
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
    const diffs = compareProduct(exp, found, options);
    return { kind: diffs.length ? "drift" : "match", handle: exp.handle, title: found.title, matchedBy, shopifyId: found.id, diffs };
  });

  const rest = shopify.filter((p) => !used.has(p.id));
  const unknownDemo = rest.filter(isDemoLike);
  return {
    rows,
    unknownDemo,
    otherCount: rest.length - unknownDemo.length,
    inventoryChecked: options.inventoryRead ?? shopify.some((p) => p.variants.some((v) => v.inventory !== undefined)),
    summary: {
      expected: expected.length,
      match: rows.filter((r) => r.kind === "match").length,
      drift: rows.filter((r) => r.kind === "drift").length,
      missing: rows.filter((r) => r.kind === "missing").length,
    },
  };
}
