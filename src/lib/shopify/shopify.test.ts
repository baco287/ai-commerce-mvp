import { describe, expect, it } from "vitest";
import { getProductAnalyses } from "@/lib/data";
import { assertOperationAllowed, productInputViolations, ShopifyGuardError } from "./guards";
import { DEMO_LISTINGS } from "./listings";
import type { ShopifyAdminTransport } from "./sync";
import { DryRunTransport, planProductSync, syncProducts } from "./sync";

const planned = () => planProductSync(getProductAnalyses());
const input = (handle: string) => planned().find((p) => p.input.handle === handle)!.input;

describe("Shopify-Produkteingabe aus Dashboard-Daten", () => {
  it("plant alle fünf Demo-Produkte", () => {
    expect(planned().map((p) => p.input.handle)).toEqual(DEMO_LISTINGS.map((l) => l.handle));
  });

  it("übernimmt Preis und Kosten aus der Kalkulation (Laptopständer 34,90 € / 15,10 €)", () => {
    const stand = input("demo-laptopstaender");
    expect(stand.variants.map((v) => v.price)).toEqual(["34.90", "34.90"]);
    expect(stand.variants.map((v) => v.inventoryItem.cost)).toEqual(["15.10", "15.10"]);
    expect(stand.productOptions[0]).toEqual({ name: "Farbe", position: 1, values: [{ name: "Silber" }, { name: "Space Grau" }] });
  });

  it("nutzt die Shopify-Konvention für Produkte ohne Varianten", () => {
    const led = input("demo-led-lichtleiste");
    expect(led.variants).toHaveLength(1);
    expect(led.variants[0].optionValues).toEqual([{ optionName: "Title", name: "Default Title" }]);
    expect(led.variants[0].price).toBe("29.90");
  });

  it("legt alles als Entwurf an und sperrt den Verkauf serverseitig über den Bestand", () => {
    for (const { input: p } of planned()) {
      expect(p.status).toBe("DRAFT");
      for (const v of p.variants) {
        expect(v.inventoryItem.tracked).toBe(true);
        expect(v.inventoryPolicy).toBe("DENY");
      }
      expect(productInputViolations(p)).toEqual([]);
    }
  });

  it("schreibt interne Kalkulationswerte nur in Metafelder, keine Lieferzeiten", () => {
    const keys = input("demo-laptopstaender").metafields.map((m) => m.key);
    expect(keys).toEqual([
      "dashboard_product_id",
      "supplier_offer_id",
      "supplier_shipping_cost",
      "supplier_stock",
      "expected_margin_percent",
      "compliance_status",
      "approval_status",
    ]);
    expect(keys).not.toContain("delivery_days_min");
  });
});

describe("Shopify-Guards", () => {
  it("blockiert aktive Produkte, Überverkauf und Lieferzeit-Metafelder", () => {
    const p = input("demo-trinkflasche");
    const bad = {
      ...p,
      status: "ACTIVE" as const,
      variants: p.variants.map((v) => ({ ...v, inventoryPolicy: "CONTINUE" as const })),
      metafields: [...p.metafields, { namespace: "ai_commerce" as const, key: "delivery_days_min", type: "number_integer" as const, value: "3" }],
    };
    const reasons = productInputViolations(bad).join(" ");
    expect(reasons).toMatch(/DRAFT/);
    expect(reasons).toMatch(/Überverkauf/);
    expect(reasons).toMatch(/delivery_days_min/);
  });

  it("verbietet Veröffentlichen und Bestellungen in GraphQL-Operationen", () => {
    expect(() => assertOperationAllowed("mutation { publishablePublish(id: 1, input: []) { userErrors { message } } }")).toThrow(ShopifyGuardError);
    expect(() => assertOperationAllowed("mutation { productSet(input: { status: ACTIVE }) { product { id } } }")).toThrow(ShopifyGuardError);
    expect(() => assertOperationAllowed("mutation { orderCreate(order: {}) { order { id } } }")).toThrow(ShopifyGuardError);
  });
});

describe("Shopify-Abgleich", () => {
  it("sendet im Dry-Run nichts, protokolliert aber jeden Aufruf mit Handle als Schlüssel", async () => {
    const transport = new DryRunTransport();
    const results = await syncProducts(planned(), transport);
    expect(results).toHaveLength(5);
    expect(transport.calls[0].variables).toMatchObject({ identifier: { handle: "demo-led-lichtleiste" } });
  });

  it("verweigert echte Schreibzugriffe, solange der Sicherheitsschalter aus ist", async () => {
    let sent = 0;
    const live: ShopifyAdminTransport = { dryRun: false, execute: async () => ++sent };
    await expect(syncProducts(planned(), live)).rejects.toThrow(/deaktiviert/);
    expect(sent).toBe(0);
  });

  it("prüft Guards auch bei eingeschaltetem Schreibzugriff vor jedem Aufruf", async () => {
    let sent = 0;
    const live: ShopifyAdminTransport = { dryRun: false, execute: async () => ++sent };
    const [first] = planned();
    const active = { ...first, input: { ...first.input, status: "ACTIVE" as const } };
    await expect(syncProducts([active], live, { writeEnabled: true })).rejects.toThrow(ShopifyGuardError);
    expect(sent).toBe(0);
  });
});
