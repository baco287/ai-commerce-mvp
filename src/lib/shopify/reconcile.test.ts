import { describe, expect, it } from "vitest";
import { getProductAnalyses } from "@/lib/data";
import { DEMO_LISTINGS } from "./listings";
import { evaluatePipeline } from "./pipeline";
import { reconcile, type ShopifyProduct } from "./reconcile";
import { planProductSync } from "./sync";

const expected = () => planProductSync(getProductAnalyses()).map((p) => p.input);

/** Baut ein Shopify-Produkt so, wie die Admin API es liefern würde – exakt nach Soll. */
function asShopify(handle: string, id = handle): ShopifyProduct {
  const e = expected().find((p) => p.handle === handle)!;
  return {
    id: `gid://shopify/Product/${id}`,
    title: e.title,
    handle: e.handle,
    status: "DRAFT",
    vendor: e.vendor,
    productType: e.productType,
    tags: [...e.tags],
    featuredMedia: { id: `gid://shopify/MediaImage/${id}` },
    variants: e.variants.map((v, i) => ({
      id: `gid://shopify/ProductVariant/${id}-${i}`,
      title: v.optionValues[0].name,
      sku: v.inventoryItem.sku,
      price: v.price,
      inventoryPolicy: v.inventoryPolicy,
      selectedOptions: v.optionValues.map((o) => ({ name: o.optionName, value: o.name })),
    })),
  };
}

const snowboard: ShopifyProduct = {
  id: "gid://shopify/Product/999",
  title: "The 3p Fulfilled Snowboard",
  handle: "the-3p-fulfilled-snowboard",
  status: "ACTIVE",
  vendor: "yakru",
  productType: "",
  tags: [],
  featuredMedia: null,
  variants: [{ id: "v", title: "Default Title", sku: "", price: "2629.95", inventoryPolicy: "DENY", selectedOptions: [] }],
};

describe("Abgleich Shopify ↔ Kontrollzentrale", () => {
  it("meldet Übereinstimmung, wenn Shopify exakt dem Soll entspricht", () => {
    const shop = DEMO_LISTINGS.map((l) => asShopify(l.handle));
    const r = reconcile(expected(), [...shop, snowboard]);
    expect(r.summary).toEqual({ expected: 5, match: 5, drift: 0, missing: 0 });
    expect(r.otherCount).toBe(1);
    expect(r.unknownDemo).toEqual([]);
  });

  it("zeigt Preis-, Status- und Überverkaufs-Abweichungen je Feld", () => {
    const stand = asShopify("demo-laptopstaender");
    stand.status = "ACTIVE";
    stand.variants[0].price = "29.90";
    stand.variants[1].inventoryPolicy = "CONTINUE";
    const r = reconcile(expected(), [stand]);
    const row = r.rows.find((x) => x.handle === "demo-laptopstaender")!;
    expect(row.kind).toBe("drift");
    if (row.kind !== "drift") return;
    expect(row.diffs).toEqual([
      { field: "Status", expected: "DRAFT", actual: "ACTIVE" },
      { field: "Preis DEMO-STAND-SLV", expected: "34.90", actual: "29.90" },
      { field: "Überverkauf DEMO-STAND-GRY", expected: "DENY", actual: "CONTINUE" },
    ]);
  });

  it("meldet ein fehlendes Produktbild", () => {
    const cable = asShopify("demo-kabel-organizer");
    cable.featuredMedia = null;
    const row = reconcile(expected(), [cable]).rows.find((x) => x.handle === "demo-kabel-organizer")!;
    if (row.kind === "missing") throw new Error("erwartet gefunden");
    expect(row.diffs).toEqual([{ field: "Produktbild", expected: "vorhanden", actual: "fehlt" }]);
  });

  it("erkennt Produkte über die SKU, wenn das Handle geändert wurde", () => {
    const led = asShopify("demo-led-lichtleiste");
    led.handle = "led-streifen";
    const row = reconcile(expected(), [led]).rows[0];
    expect(row.kind).toBe("drift");
    if (row.kind === "missing") return;
    expect(row.matchedBy).toBe("sku");
    expect(row.diffs.map((d) => d.field)).toEqual(["Handle"]);
  });

  it("meldet fehlende Produkte und fehlende/zusätzliche Varianten", () => {
    const bottle = asShopify("demo-trinkflasche");
    bottle.variants = bottle.variants.slice(0, 2);
    bottle.variants.push({ ...bottle.variants[0], id: "x", sku: "DEMO-BOTTLE-RED", title: "Rot" });
    const r = reconcile(expected(), [bottle]);
    expect(r.summary.missing).toBe(4);
    const row = r.rows.find((x) => x.handle === "demo-trinkflasche")!;
    if (row.kind === "missing") throw new Error("erwartet gefunden");
    expect(row.diffs.map((d) => d.field)).toEqual(["Variante DEMO-BOTTLE-GRN", "Variante DEMO-BOTTLE-RED"]);
  });

  it("weist unbekannte Demo-Produkte gesondert aus", () => {
    const stray: ShopifyProduct = { ...snowboard, id: "s", handle: "demo-altlast", tags: ["ai-commerce-demo"] };
    const r = reconcile(expected(), [stray, snowboard]);
    expect(r.unknownDemo.map((p) => p.handle)).toEqual(["demo-altlast"]);
    expect(r.otherCount).toBe(1);
  });
});

describe("Pipeline zur Produktanlage (Dry-Run)", () => {
  const listings = new Map(DEMO_LISTINGS.map((l) => [l.productId, l]));
  const run = (compliance?: "offen" | "freigegeben") =>
    getProductAnalyses().map((a) => evaluatePipeline(a, listings.get(a.product.id), compliance));

  it("stoppt heute jedes Produkt spätestens bei der Compliance-Prüfung", () => {
    for (const r of run()) {
      expect(r.wouldCreateDraft).toBe(false);
      const firstBlocked = r.steps.find((s) => s.state === "blocked")!;
      expect(["analysis", "margin", "compliance"]).toContain(firstBlocked.key);
    }
  });

  it("würde nach Compliance-Freigabe nur Kandidaten als Entwurf anlegen", () => {
    const results = run("freigegeben");
    const drafts = results.filter((r) => r.wouldCreateDraft).map((r) => r.productId);
    expect(drafts).toEqual(["p-led", "p-bottle"]);
    for (const r of results.filter((x) => x.wouldCreateDraft)) expect(r.input?.status).toBe("DRAFT");
  });

  it("stoppt das Uhrenarmband schon bei der Produktanalyse (geringe Nachfrage)", () => {
    const band = run("freigegeben").find((r) => r.productId === "p-band")!;
    expect(band.steps.find((s) => s.state === "blocked")?.key).toBe("analysis");
  });
});

describe("Abgleich mit Bestand (read_inventory)", () => {
  const withInventory = (handle: string, inv: { tracked: boolean; quantity: number | null; unitCost: string | null }) => {
    const p = asShopify(handle);
    p.variants = p.variants.map((v) => ({ ...v, inventory: { ...inv } }));
    return p;
  };

  it("prüft Bestand und Kosten nur, wenn sie gelesen wurden", () => {
    expect(reconcile(expected(), [asShopify("demo-led-lichtleiste")]).inventoryChecked).toBe(false);
    const r = reconcile(expected(), [withInventory("demo-led-lichtleiste", { tracked: true, quantity: 0, unitCost: "11.60" })]);
    expect(r.inventoryChecked).toBe(true);
    expect(r.rows[0].kind).toBe("match");
  });

  it("meldet fehlende Bestandsverfolgung, Bestand über 0 und abweichende Kosten", () => {
    const r = reconcile(expected(), [withInventory("demo-led-lichtleiste", { tracked: false, quantity: 5, unitCost: null })]);
    const row = r.rows[0];
    if (row.kind === "missing") throw new Error("erwartet gefunden");
    expect(row.diffs).toEqual([
      { field: "Bestand verfolgt DEMO-LED-001", expected: "ja", actual: "nein" },
      { field: "Bestand DEMO-LED-001", expected: "0", actual: "5" },
      { field: "Kosten DEMO-LED-001", expected: "11.60", actual: "nicht gepflegt" },
    ]);
  });
});
