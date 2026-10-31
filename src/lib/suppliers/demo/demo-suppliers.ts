// DEMODATEN – fiktive Lieferanten und simulierte Angebote für den Supplier Scout.
// Namen, Preise, Konditionen und GTINs sind frei erfunden und entsprechen keinen realen Firmen.
// Die GTINs stammen aus dem Präfixbereich 200–299 (nur für interne Zwecke, nie im Handel vergeben).
//
// Die Angebote decken bewusst typische Fälle ab: günstig mit Vorkasse, schnell und teuer,
// ausgewogen mit Zahlungsziel – und Angebote, die ausgeschlossen werden müssen.

import type { SupplierAdapter } from "../adapter";
import { missing, unconfirmed, type PaymentConditions, type ProductQuery, type SupplierQuote } from "../model";
import { buildQuote, ok, type QuoteOverrides } from "../quote-builder";

/** Suchanfragen für die Demo-Produkte aus src/lib/demo/products.ts */
export const DEMO_QUERIES = {
  "p-led": {
    productId: "p-led",
    title: "LED-Lichtleiste mit App-Steuerung (5 m)",
    gtin: "2000000000015",
    quantity: 1,
    destinationCountry: "DE",
    safety: { ceRequired: true },
  },
  "p-stand": {
    productId: "p-stand",
    title: "Faltbarer Laptopständer aus Aluminium",
    gtin: "2000000000022",
    quantity: 1,
    destinationCountry: "DE",
    safety: { ceRequired: false },
  },
} satisfies Record<string, ProductQuery>;

const said = <T>(value: T) => unconfirmed(value, "Selbstauskunft Lieferant (Demo)");

const PREPAYMENT: Partial<PaymentConditions> = {
  terms: ok({ kind: "prepayment" }),
  methods: ok(["prepayment", "paypal"]),
  creditLimit: missing(),
};

function forProduct(productId: keyof typeof DEMO_QUERIES) {
  const q = DEMO_QUERIES[productId];
  return (o: QuoteOverrides): SupplierQuote =>
    buildQuote({ ...o, productId, identity: { title: q.title, gtin: ok(q.gtin), ...o.identity } });
}
const led = forProduct("p-led");
const stand = forProduct("p-stand");

/** Fiktiver Großhändler-Verbund mit Lagern in Deutschland und der EU. */
const EU_WHOLESALE: SupplierQuote[] = [
  led({
    id: "demo-eu:eurolight:p-led",
    supplierId: "eurolight",
    supplierName: "EuroLight Fulfillment (Demo)",
    pricing: { unitPrice: ok(8.4), shippingCost: ok(3.2), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("PL"), deliveryDays: ok({ min: 3, max: 5 }), stock: ok(800) },
    payment: { terms: ok({ kind: "net_terms", days: 14 }), creditLimit: ok(300) },
    reliability: { rating: ok(4.5), onTimeRate: ok(0.96), defectRate: ok(0.01) },
  }),
  led({
    id: "demo-eu:lumio:p-led",
    supplierId: "lumio",
    supplierName: "Lumio Großhandel (Demo)",
    pricing: { unitPrice: ok(14.9), shippingCost: ok(2.9), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("DE"), deliveryDays: ok({ min: 1, max: 2 }), stock: ok(350) },
    payment: { terms: ok({ kind: "net_terms", days: 30 }), creditLimit: ok(1000) },
    reliability: { rating: ok(4.6), onTimeRate: ok(0.95), defectRate: ok(0.01) },
  }),
  // Ausschluss: CE-Kennzeichnung fehlt (Restposten ohne Unterlagen)
  led({
    id: "demo-eu:voltmarkt:p-led",
    supplierId: "voltmarkt",
    supplierName: "Voltmarkt Restposten (Demo)",
    safety: { ceMarking: missing(), safetyInformationDe: said(true), documents: [] },
    pricing: { unitPrice: ok(7.5), shippingCost: ok(2.9), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("DE"), deliveryDays: ok({ min: 2, max: 4 }), stock: ok(140) },
    payment: PREPAYMENT,
  }),
  // Ausschluss: derzeit kein Bestand
  led({
    id: "demo-eu:stripeco:p-led",
    supplierId: "stripeco",
    supplierName: "Stripe & Co. Lager (Demo)",
    pricing: { unitPrice: ok(9.1), shippingCost: ok(3.4), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("CZ"), deliveryDays: ok({ min: 3, max: 6 }), stock: ok(0) },
  }),
  stand({
    id: "demo-eu:deskpro:p-stand",
    supplierId: "deskpro",
    supplierName: "DeskPro Supply (Demo)",
    pricing: { unitPrice: ok(11.2), shippingCost: ok(3.9), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("NL"), deliveryDays: ok({ min: 3, max: 6 }), stock: ok(420) },
    // Zahlungsziel nur behauptet → gilt bis zur Bestätigung als Vorfinanzierung
    payment: { terms: said({ kind: "net_terms", days: 30 }), creditLimit: missing(), requiresBusinessVerification: missing() },
  }),
  stand({
    id: "demo-eu:ergohandel:p-stand",
    supplierId: "ergohandel",
    supplierName: "ErgoHandel (Demo)",
    pricing: { unitPrice: ok(14.5), shippingCost: ok(3.2), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("DE"), deliveryDays: ok({ min: 1, max: 3 }), stock: ok(120) },
    reliability: { rating: ok(4.7), onTimeRate: missing(), defectRate: ok(0.01) },
  }),
];

/** Fiktiver Marktplatz mit Lieferanten in Fernost. */
const ASIA_MARKETPLACE: SupplierQuote[] = [
  led({
    id: "demo-asia:brightline:p-led",
    supplierId: "brightline",
    supplierName: "Brightline Demo Co.",
    pricing: { unitPrice: ok(6.2), shippingCost: ok(3.9), importCost: said(1.1) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 8, max: 12 }), stock: ok(2400) },
    dropshipping: { blindShipping: said(true) },
    payment: PREPAYMENT,
    reliability: { rating: ok(4.5), onTimeRate: ok(0.86), defectRate: ok(0.03), sampleTested: missing() },
  }),
  // Ausschluss: nur ähnliche Variante, Identität nicht bestätigt
  led({
    id: "demo-asia:shinelight:p-led",
    supplierId: "shinelight",
    supplierName: "Shinelight Wholesale (Demo)",
    identity: { gtin: missing(), match: said("variant") },
    pricing: { unitPrice: ok(4.9), shippingCost: ok(2.5), importCost: said(0.8) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 9, max: 12 }), stock: ok(5000) },
    payment: PREPAYMENT,
  }),
  // Ausschluss: Mindestabnahme 100 Stück – das wäre ein Vorratskauf
  led({
    id: "demo-asia:bulkware:p-led",
    supplierId: "bulkware",
    supplierName: "Bulkware Demo Trading",
    pricing: { unitPrice: ok(3.8), shippingCost: ok(1.2), importCost: ok(0.6), minOrderQuantity: ok(100) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 10, max: 12 }), stock: ok(20000) },
    payment: PREPAYMENT,
  }),
  // Ausschluss: Lieferzeit zu lang
  stand({
    id: "demo-asia:metalworks:p-stand",
    supplierId: "metalworks",
    supplierName: "MetalWorks Demo Ltd.",
    pricing: { unitPrice: ok(7.8), shippingCost: ok(5.4), importCost: ok(1.6) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 10, max: 18 }), stock: ok(1500) },
    payment: PREPAYMENT,
  }),
];

/** Adapter über statische Demo-Angebote. Kein Netzwerk, keine Kosten, keine Bestellungen. */
export function createDemoAdapter(id: string, name: string, quotes: SupplierQuote[]): SupplierAdapter {
  const own = quotes.map((q) => ({ ...q, adapterId: id, demo: true }));
  return {
    info: { id, name, kind: "demo", paid: false, network: false },
    findQuotes: async (query) => own.filter((q) => q.productId === query.productId),
  };
}

export const DEMO_ADAPTERS: SupplierAdapter[] = [
  createDemoAdapter("demo-eu-wholesale", "EU-Großhandel (Demo)", EU_WHOLESALE),
  createDemoAdapter("demo-asia-marketplace", "Fernost-Marktplatz (Demo)", ASIA_MARKETPLACE),
];
