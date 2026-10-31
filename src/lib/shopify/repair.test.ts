import { describe, expect, it } from "vitest";
import { getProductAnalyses } from "@/lib/data";
import { buildDraftInput, type ProductSetInput } from "./product-input";
import type { ShopifyProduct, VariantInventory } from "./reconcile";
import { planRepairs } from "./repair";
import { planProductSync } from "./sync";

const expected = () => planProductSync(getProductAnalyses()).map((p) => p.input);
const LOCATION = "gid://shopify/Location/1";

/** Shopify-Produkt so, wie es live nach dem CSV-Import aussah: Entwurf, Bestand 0, nicht verfolgt, ohne Bild. */
function live(exp: ProductSetInput, n: number, opts: { tracked?: boolean; available?: number; hasMedia?: boolean } = {}): ShopifyProduct {
  return {
    id: `gid://shopify/Product/${n}`,
    title: exp.title,
    handle: exp.handle,
    status: "DRAFT",
    vendor: exp.vendor,
    productType: exp.productType,
    tags: exp.tags,
    featuredMedia: null,
    hasMedia: opts.hasMedia ?? false,
    variants: exp.variants.map((v, i) => {
      const inventory: VariantInventory = {
        tracked: opts.tracked ?? false,
        quantity: opts.available ?? 0,
        unitCost: v.inventoryItem.cost ?? null,
        locationsTruncated: false,
        locations: [{ locationId: LOCATION, locationName: "Standort 1", locationActive: null, available: opts.available ?? 0, onHand: 0, committed: 0, incoming: 0 }],
      };
      return {
        id: `gid://shopify/ProductVariant/${n}${i}`,
        title: v.optionValues[0].name,
        sku: v.inventoryItem.sku,
        price: v.price,
        inventoryPolicy: "DENY",
        selectedOptions: v.optionValues.map((o) => ({ name: o.optionName, value: o.name })),
        inventoryItemId: `gid://shopify/InventoryItem/${n}${i}`,
        inventory,
      };
    }),
  };
}

const complete = { inventoryComplete: true, productsComplete: true };

describe("Reparatur-Planung", () => {
  it("plant für den Live-Stand genau Bilder und Bestandsverfolgung – sonst nichts", () => {
    const exp = expected();
    const plan = planRepairs({ expected: exp, shopify: exp.map((e, i) => live(e, i + 1)), ...complete });
    const kinds = plan.actions.map((a) => a.operation.kind);
    expect(kinds.filter((k) => k === "add-image")).toHaveLength(5);
    expect(kinds.filter((k) => k === "track-inventory")).toHaveLength(9);
    expect(kinds).not.toContain("create-draft");
    expect(plan.manual).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  it("ist nach erfolgreicher Reparatur leer (idempotent)", () => {
    const exp = expected();
    const fixed = exp.map((e, i) => ({ ...live(e, i + 1, { tracked: true }), featuredMedia: { id: "m" }, hasMedia: true }));
    expect(planRepairs({ expected: exp, shopify: fixed, ...complete })).toEqual({ actions: [], manual: [], blocked: [] });
  });

  it("lädt kein Bild hoch, wenn eins existiert, verarbeitet wird oder der Medienstand unbekannt ist", () => {
    const exp = expected();
    for (const variant of [{ hasMedia: true }, { hasMedia: undefined }]) {
      const shopify = exp.map((e, i) => ({ ...live(e, i + 1, { tracked: true }), hasMedia: variant.hasMedia }));
      expect(planRepairs({ expected: exp, shopify, ...complete }).actions, JSON.stringify(variant)).toEqual([]);
    }
  });

  it("setzt Demo-Bestand über 0 je Standort zurück auf 0", () => {
    const exp = expected();
    const shopify = exp.map((e, i) => ({ ...live(e, i + 1, { tracked: true, available: 4 }), featuredMedia: { id: "m" }, hasMedia: true }));
    const zero = planRepairs({ expected: exp, shopify, ...complete }).actions.filter((a) => a.operation.kind === "zero-demo-stock");
    expect(zero).toHaveLength(9);
    expect(zero[0].operation).toMatchObject({ locationId: LOCATION, currentQuantity: 4 });
  });

  it("legt fehlende Produkte als Entwurf an", () => {
    const exp = expected();
    const shopify = exp.slice(1).map((e, i) => ({ ...live(e, i + 2, { tracked: true }), featuredMedia: { id: "m" }, hasMedia: true }));
    const plan = planRepairs({ expected: exp, shopify, ...complete });
    expect(plan.actions).toEqual([expect.objectContaining({ handle: exp[0].handle, operation: { kind: "create-draft", input: exp[0] } })]);
  });

  it("ändert nichts automatisch, was nicht auf der Positivliste steht (z. B. Preis)", () => {
    const exp = expected();
    const shopify = exp.map((e, i) => ({ ...live(e, i + 1, { tracked: true }), featuredMedia: { id: "m" }, hasMedia: true }));
    shopify[0].variants[0].price = "1.00";
    const plan = planRepairs({ expected: exp, shopify, ...complete });
    expect(plan.actions).toEqual([]);
    expect(plan.manual).toEqual([expect.objectContaining({ handle: exp[0].handle, field: expect.stringMatching(/^Preis /), actual: "1.00" })]);
  });

  it("schreibt nichts auf unvollständiger Datenbasis", () => {
    const exp = expected();
    const plan = planRepairs({ expected: exp, shopify: [], inventoryComplete: false, productsComplete: false });
    expect(plan.actions).toEqual([]);
    expect(plan.blocked[0]).toMatch(/nicht vollständig gelesen/);
  });

  it("repariert ohne vollständigen Bestand keine Bestandsfelder, Bilder aber schon", () => {
    const exp = expected();
    const plan = planRepairs({ expected: exp, shopify: exp.map((e, i) => live(e, i + 1)), inventoryComplete: false, productsComplete: true });
    expect(new Set(plan.actions.map((a) => a.operation.kind))).toEqual(new Set(["add-image"]));
    expect(plan.blocked).toEqual([expect.stringMatching(/Bestand nicht vollständig/)]);
  });
});

describe("Reparatur-Planung: Konflikte und Sonderfälle", () => {
  const fixedTracked = (e: ProductSetInput, n: number) => ({ ...live(e, n, { tracked: true }), featuredMedia: { id: "m" }, hasMedia: true });

  it("korrigiert keinen Bestand bei doppelter SKU und meldet sie", () => {
    const exp = expected();
    const shopify = exp.map((e, i) => fixedTracked(e, i + 1));
    const bottle = shopify.find((p) => p.handle === "demo-trinkflasche")!;
    const copy = { ...bottle.variants[0], id: "gid://shopify/ProductVariant/999", inventoryItemId: "gid://shopify/InventoryItem/999" };
    copy.inventory = { ...copy.inventory!, tracked: false, quantity: 7, locations: [{ ...copy.inventory!.locations[0], available: 7 }] };
    bottle.variants.push(copy);

    const plan = planRepairs({ expected: exp, shopify, ...complete });
    expect(plan.actions).toEqual([]);
    expect(plan.blocked).toEqual([expect.stringMatching(/DEMO-BOTTLE-BLK: SKU mehrfach vergeben/)]);
    expect(plan.manual).toEqual(expect.arrayContaining([expect.objectContaining({ field: "Doppelte SKU DEMO-BOTTLE-BLK", actual: "2 Varianten" })]));
  });

  it("fasst ein Shopify-Produkt nicht an, auf das zwei Soll-Produkte passen (kein falsches zweites Bild)", () => {
    const exp = expected();
    const stand = live(exp[1], 2);
    stand.variants.push({ ...live(exp[0], 1).variants[0] }); // LED-SKU wandert in den Laptopständer
    const plan = planRepairs({ expected: exp, shopify: [stand], ...complete });
    const touchingStand = plan.actions.filter((a) => a.operation.kind !== "create-draft");
    expect(touchingStand).toEqual([]);
    expect(plan.blocked.filter((b) => /passt auf dasselbe Shopify-Produkt/.test(b))).toHaveLength(2);
  });

  it("meldet Abweichungen auch bei blockierter Planung (nur Bericht)", () => {
    const exp = expected();
    const plan = planRepairs({ expected: exp, shopify: exp.slice(1).map((e, i) => live(e, i + 2)), inventoryComplete: true, productsComplete: false });
    expect(plan.actions).toEqual([]);
    expect(plan.manual).toEqual(expect.arrayContaining([expect.objectContaining({ handle: exp[0].handle, actual: "nicht gefunden" })]));
  });
});

describe("Reparatur-Planung: Phase 1 – echte Entwürfe erst mit Freigabe-Akte (Paket I)", () => {
  /** NUR TEST: echte (nicht als Demo gekennzeichnete) Entwurfs-Eingabe */
  const realDraft = () =>
    buildDraftInput({
      demo: false,
      productRef: "catalog:kabelkanal",
      listing: { handle: "kabelkanal", title: "Kabelkanal selbstklebend", descriptionHtml: "<p>Kabelkanal</p>", productType: "Kabelmanagement", categoryTag: "buero" },
      variants: [{ shopSku: "KK-1", priceGross: 39.9 }],
      images: [{ url: "https://bilder.example/kabelkanal.jpg", alt: "Kabelkanal" }],
      vendor: "Kabelfix",
    });

  it("plant für eine echte Eingabe kein create-draft, sondern einen gesperrten Eintrag", () => {
    const plan = planRepairs({ expected: [realDraft()], shopify: [], ...complete });
    expect(plan.actions).toEqual([]);
    expect(plan.blocked).toEqual(["kabelkanal: echter Entwurf – Anlage erst mit Freigabe-Akte (Phase 2)."]);
  });

  it("behandelt gemischte Demo-Kennzeichen wie eine echte Eingabe", () => {
    const [demo] = expected();
    const mixed: ProductSetInput = { ...demo, handle: "lichtleiste-ohne-demo-praefix" };
    const plan = planRepairs({ expected: [mixed], shopify: [], ...complete });
    expect(plan.actions.map((a) => a.operation.kind)).not.toContain("create-draft");
    expect(plan.blocked.join(" ")).toMatch(/Freigabe-Akte/);
  });

  it("fügt einem Nicht-Demo-Produkt kein Demo-Bild hinzu", () => {
    const [demo] = expected();
    const product = { ...live(demo, 1), tags: [], handle: demo.handle.replace(/^demo-/, ""), variants: live(demo, 1).variants.map((v) => ({ ...v, sku: "ECHT-1" })) };
    const plan = planRepairs({ expected: [{ ...demo, handle: product.handle }], shopify: [product], ...complete });
    expect(plan.actions.map((a) => a.operation.kind)).not.toContain("add-image");
  });
});
