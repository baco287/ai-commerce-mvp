import { describe, expect, it } from "vitest";
import { getProductAnalyses } from "@/lib/data";
import { ShopifyGuardError } from "./guards";
import { DEMO_IMAGE_BASE_URL } from "./listings";
import { buildDraftInput, type ProductSetInput } from "./product-input";
import { planProductSync } from "./sync";
import { buildWriteRequest, type WriteOperation } from "./write-operations";

const ITEM = "gid://shopify/InventoryItem/123";
const PRODUCT = "gid://shopify/Product/456";
const LOCATION = "gid://shopify/Location/789";
const RUN = { runId: "0f1e2d3c-run-0001" };
const draft = () => planProductSync(getProductAnalyses())[0].input;
const build = (op: WriteOperation, context = RUN) => buildWriteRequest(op, context);

describe("Schreib-Operationen (Positivliste)", () => {
  it("schaltet die Bestandsverfolgung mit festem Dokument ein (tracked: true steht im Dokument)", () => {
    const r = build({ kind: "track-inventory", inventoryItemId: ITEM });
    expect(r.document).toMatch(/inventoryItemUpdate\(id: \$id, input: \{ tracked: true \}\)/);
    expect(r.variables).toEqual({ id: ITEM });
    expect(r.requiredScope).toBe("write_inventory");
  });

  it("fügt nur eigene, als Symbolbild gekennzeichnete Illustrationen aus dem Repository hinzu", () => {
    const ok: WriteOperation = { kind: "add-image", productId: PRODUCT, source: `${DEMO_IMAGE_BASE_URL}demo-led.png`, alt: "Illustration (Symbolbild): LED" };
    expect(build(ok)).toMatchObject({
      requiredScope: "write_products",
      variables: { product: { id: PRODUCT }, media: [{ originalSource: ok.source, mediaContentType: "IMAGE" }] },
    });
    for (const source of ["https://example.com/bild.png", `${DEMO_IMAGE_BASE_URL}../geheim.png`, `${DEMO_IMAGE_BASE_URL}bild.svg`]) {
      expect(() => build({ ...ok, source } as WriteOperation), source).toThrow(ShopifyGuardError);
    }
    expect(() => build({ ...ok, alt: "Produktfoto" } as WriteOperation)).toThrow(/Symbolbild/);
  });

  it("setzt Demo-Bestand nur auf 0, mit Vergleichswert; Idempotenzschlüssel je Lauf eindeutig", () => {
    const op: WriteOperation = { kind: "zero-demo-stock", inventoryItemId: ITEM, locationId: LOCATION, currentQuantity: 3 };
    const a = build(op);
    expect(a.document).toMatch(/@idempotent\(key: \$idempotencyKey\)/);
    expect(a.variables).toMatchObject({
      input: { name: "available", reason: "correction", quantities: [{ inventoryItemId: ITEM, locationId: LOCATION, quantity: 0, changeFromQuantity: 3 }] },
    });
    // gleicher Lauf → gleicher Schlüssel (keine Doppelbuchung bei Wiederholung) …
    expect(build(op).variables.idempotencyKey).toBe(a.variables.idempotencyKey);
    // … neuer Lauf → neuer Schlüssel (spätere berechtigte Korrektur wird nicht verschluckt)
    expect(build(op, { runId: "11112222-run-0002" }).variables.idempotencyKey).not.toBe(a.variables.idempotencyKey);
    expect(() => build(op, { runId: "x" })).toThrow(/Lauf-Kennung/);
  });

  it("legt nur Entwürfe an, die alle Produkt-Guards bestehen – ohne identifier (kein Überschreiben)", () => {
    const r = build({ kind: "create-draft", input: draft() });
    expect(r.document).not.toMatch(/identifier/);
    expect(r.requiredScope).toBe("write_products");
    for (const bad of [
      { ...draft(), status: "ACTIVE" as const },
      { ...draft(), variants: draft().variants.map((v) => ({ ...v, inventoryPolicy: "CONTINUE" as const })) },
      { ...draft(), variants: draft().variants.map((v) => ({ ...v, inventoryItem: { ...v.inventoryItem, tracked: false } })) },
    ]) {
      expect(() => build({ kind: "create-draft", input: bad })).toThrow(ShopifyGuardError);
    }
  });

  it("prüft beim Anlegen Bilder, Handle und erlaubte Felder wie beim Bild-Ergänzen", () => {
    const withFile = (file: Partial<ProductSetInput["files"][number]>): ProductSetInput => ({ ...draft(), files: [{ ...draft().files[0], ...file }] });
    expect(() => build({ kind: "create-draft", input: withFile({ originalSource: "https://example.com/foto.png" }) })).toThrow(/Bildquelle/);
    expect(() => build({ kind: "create-draft", input: withFile({ alt: "Produktfoto" }) })).toThrow(/Symbolbild/);
    expect(() => build({ kind: "create-draft", input: { ...draft(), handle: "demo-x/../../fremd" } })).toThrow(/Handle/);
    const withId = { ...draft(), id: "gid://shopify/Product/1" } as ProductSetInput;
    expect(() => build({ kind: "create-draft", input: withId })).toThrow(/Nicht erlaubte Felder.*id/);
  });

  it("zweite Schutzebene: kein Status außer DRAFT und keine Veröffentlichungs-Felder in Variablen", () => {
    // Simuliert eine später gelockerte Produkt-Prüfung: ein verschachteltes Status-/Veröffentlichungs-Feld.
    const sneaky = { ...draft(), metafields: [{ ...draft().metafields[0], status: "ACTIVE" }] } as unknown as ProductSetInput;
    expect(() => build({ kind: "create-draft", input: sneaky })).toThrow(/nur DRAFT/);
    const publish = { ...draft(), variants: [{ ...draft().variants[0], publications: ["online-store"] }] } as unknown as ProductSetInput;
    expect(() => build({ kind: "create-draft", input: publish })).toThrow(/Veröffentlichen/);
  });

  it("lehnt ungültige Shopify-IDs ab", () => {
    expect(() => build({ kind: "track-inventory", inventoryItemId: "gid://shopify/Product/1" })).toThrow(/Lagerartikel-ID/);
    expect(() => build({ kind: "zero-demo-stock", inventoryItemId: ITEM, locationId: "1", currentQuantity: 1 })).toThrow(/Standort-ID/);
  });

  it("enthält in keinem Dokument Veröffentlichen, Aktivieren, Löschen oder Bestellungen", () => {
    const ops: WriteOperation[] = [
      { kind: "track-inventory", inventoryItemId: ITEM },
      { kind: "add-image", productId: PRODUCT, source: `${DEMO_IMAGE_BASE_URL}a.png`, alt: "Symbolbild" },
      { kind: "zero-demo-stock", inventoryItemId: ITEM, locationId: LOCATION, currentQuantity: 1 },
      { kind: "create-draft", input: draft() },
    ];
    for (const op of ops) {
      const { document } = build(op);
      expect(document, op.kind).not.toMatch(/publish|Publication|Delete|delete|order|Order|status:\s*ACTIVE/);
    }
  });
});

describe("Schreib-Operationen: Phase 1 – nur vollständig gekennzeichnete Demo-Entwürfe (Paket I)", () => {
  it("lehnt create-draft für echte Eingaben ab – auch wenn sie sonst alle Guards erfüllen", () => {
    const real = buildDraftInput({
      demo: false,
      productRef: "catalog:kabelkanal",
      listing: { handle: "kabelkanal", title: "Kabelkanal selbstklebend", descriptionHtml: "<p>Kabelkanal</p>", productType: "Kabelmanagement", categoryTag: "buero" },
      variants: [{ shopSku: "KK-1", priceGross: 39.9 }],
      images: [],
      vendor: "Kabelfix",
    });
    expect(() => build({ kind: "create-draft", input: real })).toThrow(/Freigabe-Akte/);
    expect(() => build({ kind: "create-draft", input: { ...draft(), handle: "ohne-demo-praefix" } })).toThrow(ShopifyGuardError);
  });
});
