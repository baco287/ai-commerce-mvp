// Erlaubte Schreib-Operationen Richtung Shopify (Positivliste). Reine Funktionen ohne Netzwerk.
//
// Freigegeben am 31.10.2026: write_products + write_inventory, ausschließlich für
// - Bestandsverfolgung einschalten,
// - Produktbild hinzufügen (nur eigene Illustrationen aus dem Repository),
// - Bestand von Demo-Produkten auf 0 setzen,
// - fehlende Produkte als ENTWURF anlegen.
// Jede Operation wird hier in ein festes GraphQL-Dokument mit geprüften Variablen übersetzt.
// Freie Dokumente gibt es nicht. Veröffentlichen, Aktivieren, Löschen, Bestellungen: nie.

import { assertOperationAllowed, assertProductInputAllowed, ShopifyGuardError } from "./guards";
import {
  ADD_PRODUCT_IMAGE_MUTATION,
  CREATE_DRAFT_PRODUCT_MUTATION,
  TRACK_INVENTORY_MUTATION,
  ZERO_DEMO_STOCK_MUTATION,
} from "./graphql";
import { DEMO_IMAGE_BASE_URL } from "./listings";
import type { ProductSetInput } from "./product-input";

export type WriteScope = "write_products" | "write_inventory";

export type WriteOperation =
  | { kind: "track-inventory"; inventoryItemId: string }
  | { kind: "add-image"; productId: string; source: string; alt: string }
  | { kind: "zero-demo-stock"; inventoryItemId: string; locationId: string; currentQuantity: number }
  | { kind: "create-draft"; input: ProductSetInput };

export interface WriteRequest {
  document: string;
  variables: Record<string, unknown>;
  /** Feld der Antwort, das userErrors enthält */
  payloadField: "inventoryItemUpdate" | "productUpdate" | "inventorySetQuantities" | "productSet";
  requiredScope: WriteScope;
}

export interface WriteContext {
  /** Kennung des Laufs (einmal je `shopify:sync --apply`); macht Idempotenzschlüssel je Lauf eindeutig */
  runId: string;
}

const GID = (type: string) => new RegExp(`^gid://shopify/${type}/\\d+$`);
const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RUN_ID = /^[a-z0-9-]{8,64}$/;

/** Felder, die ein neu angelegter Entwurf haben darf – alles andere (z. B. id, publications) wird abgelehnt. */
const DRAFT_INPUT_KEYS = new Set<string>([
  "handle",
  "title",
  "descriptionHtml",
  "vendor",
  "productType",
  "tags",
  "status",
  "productOptions",
  "variants",
  "metafields",
  "files",
]);

/** Schlüssel, die in keiner Schreib-Variable vorkommen dürfen (Veröffentlichen/Sichtbarkeit). */
const FORBIDDEN_VARIABLE_KEYS = new Set(["publications", "publishedAt", "publishDate", "published", "publishedScope", "publicationIds"]);

function check(condition: boolean, reason: string, reasons: string[]) {
  if (!condition) reasons.push(reason);
}

/** Nur eigene, als Symbolbild gekennzeichnete Illustrationen aus dem öffentlichen Repository. */
function checkImage(source: string, alt: string, reasons: string[]) {
  check(
    source.startsWith(DEMO_IMAGE_BASE_URL) && /^[a-z0-9-]+\.png$/.test(source.slice(DEMO_IMAGE_BASE_URL.length)),
    `Bildquelle nicht freigegeben: ${source}`,
    reasons,
  );
  check(alt.includes("Symbolbild"), "Alternativtext muss das Bild als Symbolbild kennzeichnen.", reasons);
}

/**
 * Zweite Ebene, strukturiert über alle Variablen: kein Status außer DRAFT, keine Veröffentlichungs-Felder.
 * Greift auch, falls eine vorgelagerte Prüfung später geändert wird.
 */
function forbiddenValues(value: unknown, path = "variables"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenValues(v, `${path}[${i}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => {
    const here = `${path}.${key}`;
    if (FORBIDDEN_VARIABLE_KEYS.has(key)) return [`${here} ist nicht erlaubt (Veröffentlichen).`];
    if (key === "status" && v !== "DRAFT") return [`${here} = ${String(v)} – nur DRAFT erlaubt.`];
    return forbiddenValues(v, here);
  });
}

/** Übersetzt eine Operation in ein festes Dokument mit geprüften Variablen – oder wirft ShopifyGuardError. */
export function buildWriteRequest(op: WriteOperation, context: WriteContext): WriteRequest {
  const reasons: string[] = [];
  let request: WriteRequest;

  switch (op.kind) {
    case "track-inventory":
      check(GID("InventoryItem").test(op.inventoryItemId), `Ungültige Lagerartikel-ID "${op.inventoryItemId}".`, reasons);
      request = {
        document: TRACK_INVENTORY_MUTATION,
        variables: { id: op.inventoryItemId },
        payloadField: "inventoryItemUpdate",
        requiredScope: "write_inventory",
      };
      break;

    case "add-image":
      check(GID("Product").test(op.productId), `Ungültige Produkt-ID "${op.productId}".`, reasons);
      checkImage(op.source, op.alt, reasons);
      request = {
        document: ADD_PRODUCT_IMAGE_MUTATION,
        variables: { product: { id: op.productId }, media: [{ originalSource: op.source, alt: op.alt, mediaContentType: "IMAGE" }] },
        payloadField: "productUpdate",
        requiredScope: "write_products",
      };
      break;

    case "zero-demo-stock":
      check(GID("InventoryItem").test(op.inventoryItemId), `Ungültige Lagerartikel-ID "${op.inventoryItemId}".`, reasons);
      check(GID("Location").test(op.locationId), `Ungültige Standort-ID "${op.locationId}".`, reasons);
      check(Number.isInteger(op.currentQuantity), "Aktueller Bestand muss bekannt sein.", reasons);
      check(RUN_ID.test(context.runId), "Ungültige Lauf-Kennung.", reasons);
      request = {
        document: ZERO_DEMO_STOCK_MUTATION,
        variables: {
          // Je Lauf eindeutig (Wiederholung im selben Lauf bucht nicht doppelt), über Läufe hinweg neu –
          // sonst würde eine spätere, berechtigte Korrektur als Duplikat verworfen. changeFromQuantity
          // verhindert zusätzlich das Überschreiben eines zwischenzeitlich geänderten Bestands.
          idempotencyKey: `ai-commerce-zero-${context.runId}-${op.inventoryItemId.split("/").pop()}-${op.locationId.split("/").pop()}-${op.currentQuantity}`,
          input: {
            name: "available",
            reason: "correction",
            quantities: [{ inventoryItemId: op.inventoryItemId, locationId: op.locationId, quantity: 0, changeFromQuantity: op.currentQuantity }],
          },
        },
        payloadField: "inventorySetQuantities",
        requiredScope: "write_inventory",
      };
      break;

    case "create-draft": {
      // Wirft selbst bei Status ≠ DRAFT, Überverkauf, unverfolgtem Bestand, fehlenden Demo-Kennzeichen …
      assertProductInputAllowed(op.input);
      const extra = Object.keys(op.input).filter((k) => !DRAFT_INPUT_KEYS.has(k));
      check(extra.length === 0, `Nicht erlaubte Felder im Entwurf: ${extra.join(", ")}.`, reasons);
      check(op.input.status === "DRAFT", "Neue Produkte nur als DRAFT.", reasons);
      check(HANDLE.test(op.input.handle), `Ungültiges Handle "${op.input.handle}".`, reasons);
      for (const file of op.input.files) {
        check(file.contentType === "IMAGE", "Nur Bilder als Produktmedien.", reasons);
        checkImage(file.originalSource, file.alt, reasons);
      }
      request = {
        document: CREATE_DRAFT_PRODUCT_MUTATION,
        variables: { input: op.input },
        payloadField: "productSet",
        requiredScope: "write_products",
      };
      break;
    }
  }

  // Zweite Ebene: strukturierte Prüfung aller Variablen und des Dokuments.
  reasons.push(...forbiddenValues(request.variables));
  if (reasons.length) throw new ShopifyGuardError(reasons);
  assertOperationAllowed(request.document);
  return request;
}

/** Kurzbeschreibung für Protokoll und Oberfläche (ohne IDs von Zugangsdaten, nur Shopify-Objekt-IDs). */
export function describeWriteOperation(op: WriteOperation): string {
  switch (op.kind) {
    case "track-inventory":
      return "Bestandsverfolgung einschalten";
    case "add-image":
      return `Produktbild hinzufügen (${op.source.slice(DEMO_IMAGE_BASE_URL.length)})`;
    case "zero-demo-stock":
      return `Demo-Bestand von ${op.currentQuantity} auf 0 setzen`;
    case "create-draft":
      return `Produkt als Entwurf anlegen (${op.input.handle})`;
  }
}
