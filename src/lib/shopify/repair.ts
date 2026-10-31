// Plant automatische Reparaturen aus dem Abgleich Soll (Kontrollzentrale) ↔ Ist (Shopify).
// Reine Funktion ohne Netzwerk. Erzeugt nur Operationen aus der Positivliste (write-operations.ts);
// alle übrigen Abweichungen werden zur manuellen Prüfung ausgewiesen, nicht automatisch geändert.

import { demoMarkersOf } from "./guards";
import type { ProductSetInput } from "./product-input";
import { countSkus, findShopifyProduct, isDemoLike, reconcile, type FieldDiff, type ShopifyProduct } from "./reconcile";
import { describeWriteOperation, type WriteOperation } from "./write-operations";

export interface PlannedRepair {
  handle: string;
  /** SKU, falls die Operation eine Variante betrifft */
  sku?: string;
  description: string;
  operation: WriteOperation;
}

export interface RepairPlan {
  actions: PlannedRepair[];
  /** Abweichungen, die bewusst NICHT automatisch behoben werden */
  manual: (FieldDiff & { handle: string })[];
  /** Gründe, warum gar nicht oder nur eingeschränkt repariert werden darf */
  blocked: string[];
}

export interface RepairInput {
  expected: ProductSetInput[];
  shopify: ShopifyProduct[];
  /** Bestand vollständig gelesen (read_inventory, keine fehlenden/abgeschnittenen Daten) */
  inventoryComplete: boolean;
  /** Produkte und Varianten vollständig gelesen */
  productsComplete: boolean;
}

/** Abgleich-Feld, das eine geplante Operation behebt (Schlüssel: Handle + Feldname aus reconcile). */
function coveredField(repair: PlannedRepair): string | undefined {
  switch (repair.operation.kind) {
    case "add-image":
      return `${repair.handle}|Produktbild`;
    case "track-inventory":
      return `${repair.handle}|Bestand verfolgt ${repair.sku}`;
    case "zero-demo-stock":
      return `${repair.handle}|Bestand ${repair.sku}`;
    case "create-draft":
      return undefined;
  }
}

export function planRepairs({ expected, shopify, inventoryComplete, productsComplete }: RepairInput): RepairPlan {
  const plan: RepairPlan = { actions: [], manual: [], blocked: [] };

  const result = reconcile(expected, shopify, { inventoryRead: inventoryComplete });

  // Auf unvollständiger Datenbasis wird nichts geschrieben – sonst könnten z. B. Produkte doppelt angelegt
  // werden. Abweichungen werden trotzdem gemeldet (nur Bericht).
  if (!productsComplete) {
    plan.blocked.push("Produkte oder Varianten wurden nicht vollständig gelesen – keine automatischen Änderungen.");
    for (const row of result.rows) {
      if (row.kind === "missing") plan.manual.push({ handle: row.handle, field: "Produkt", expected: "vorhanden", actual: "nicht gefunden" });
      else for (const d of row.diffs) plan.manual.push({ handle: row.handle, ...d });
    }
    return plan;
  }
  if (!inventoryComplete) plan.blocked.push("Bestand nicht vollständig gelesen – keine Bestandsreparaturen.");

  // Ein Shopify-Produkt, auf das mehrere Soll-Produkte passen, wird gar nicht automatisch angefasst.
  const matches = expected.map((exp) => ({ exp, match: findShopifyProduct(exp, shopify) }));
  const claims = new Map<string, number>();
  for (const { match } of matches) if (match) claims.set(match.product.id, (claims.get(match.product.id) ?? 0) + 1);

  for (const { exp, match } of matches) {
    // Phase 1: Nur vollständig als Demo gekennzeichnete Eingaben (Tag, Handle-, Titel- und SKU-Präfixe) dürfen
    // automatisch angelegt bzw. bebildert werden. Echte oder gemischt gekennzeichnete Entwürfe erst mit Freigabe-Akte.
    const expDemo = demoMarkersOf(exp).demo;
    if (!match) {
      if (expDemo) add(plan, exp.handle, undefined, { kind: "create-draft", input: exp });
      else plan.blocked.push(`${exp.handle}: echter Entwurf – Anlage erst mit Freigabe-Akte (Phase 2).`);
      continue;
    }
    const product = match.product;
    if ((claims.get(product.id) ?? 0) > 1) {
      plan.blocked.push(`${exp.handle}: passt auf dasselbe Shopify-Produkt (${product.handle}) wie ein anderes Produkt – keine automatischen Änderungen.`);
      continue;
    }
    const demo = isDemoLike(product);
    const skuCounts = countSkus(product);

    // Bild nur, wenn das Produkt noch GAR KEIN Medium hat (auch keins in Verarbeitung) – nie doppelt. Und nur Demo-Bilder
    // an Demo-Produkte: Shopify-Produkt als Demo erkennbar UND Soll-Eingabe vollständig als Demo gekennzeichnet.
    const image = exp.files[0];
    if (image && demo && expDemo && !product.featuredMedia && product.hasMedia === false) {
      add(plan, exp.handle, undefined, { kind: "add-image", productId: product.id, source: image.originalSource, alt: image.alt });
    }

    if (inventoryComplete) {
      const bySku = new Map(product.variants.map((v) => [v.sku ?? "", v]));
      for (const ev of exp.variants) {
        if ((skuCounts.get(ev.inventoryItem.sku) ?? 0) > 1) {
          plan.blocked.push(`${ev.inventoryItem.sku}: SKU mehrfach vergeben – Bestand nicht automatisch korrigiert.`);
          continue;
        }
        const av = bySku.get(ev.inventoryItem.sku);
        if (!av?.inventory || !av.inventoryItemId) continue;
        if (ev.inventoryItem.tracked && !av.inventory.tracked) {
          add(plan, exp.handle, ev.inventoryItem.sku, { kind: "track-inventory", inventoryItemId: av.inventoryItemId });
        }
        if (demo) {
          if (av.inventory.locationsTruncated) {
            plan.blocked.push(`${ev.inventoryItem.sku}: mehr als 10 Standorte – Demo-Bestand nicht automatisch korrigiert.`);
            continue;
          }
          for (const l of av.inventory.locations) {
            if (l.available !== 0) {
              add(plan, exp.handle, ev.inventoryItem.sku, {
                kind: "zero-demo-stock",
                inventoryItemId: av.inventoryItemId,
                locationId: l.locationId,
                currentQuantity: l.available,
              });
            }
          }
        }
      }
    }
  }

  // Alles, was keine geplante Operation behebt, bleibt sichtbar und wird nicht automatisch geändert.
  const covered = new Set(plan.actions.map(coveredField).filter(Boolean));
  for (const row of result.rows) {
    if (row.kind === "missing") continue;
    for (const d of row.diffs) {
      if (!covered.has(`${row.handle}|${d.field}`)) plan.manual.push({ handle: row.handle, ...d });
    }
  }
  return plan;
}

/** Vorübergehende Abweichungen, die sich ohne Eingriff auflösen (Shopify verarbeitet Bilder asynchron). */
export function isTransient(diff: FieldDiff): boolean {
  return diff.field === "Produktbild" && diff.actual === "wird verarbeitet";
}

function add(plan: RepairPlan, handle: string, sku: string | undefined, operation: WriteOperation) {
  plan.actions.push({ handle, sku, description: describeWriteOperation(operation), operation });
}
