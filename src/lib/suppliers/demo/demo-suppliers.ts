// DEMODATEN – fiktive Lieferanten und simulierte Angebote für den Supplier Scout.
// Namen, Preise, Konditionen und GTINs sind frei erfunden und entsprechen keinen realen Firmen.
// Die GTINs stammen aus dem Präfixbereich 200–299 (nur für interne Zwecke, nie im Handel vergeben).
//
// EINZIGE Quelle für Lieferantenangebote der Kontrollzentrale (ersetzt src/lib/demo/suppliers.ts).
// Preise, Versand, Lieferzeiten, Bestände und Bewertungen entsprechen den bisherigen Demo-Angeboten,
// damit die Kalkulationsbasis (günstigster geeigneter Lieferant) und damit die „Kosten pro Artikel“
// in Shopify unverändert bleiben (11,60 / 15,10 / 3,90 / 8,50 / 4,40 €).
//
// Die Angebote decken bewusst typische Fälle ab: günstig mit Vorkasse, schnell und teuer,
// ausgewogen mit Zahlungsziel, unbestätigte Angaben – und Angebote, die ausgeschlossen werden müssen.

import type { SupplierAdapter } from "../adapter";
import { missing, unconfirmed, type PaymentConditions, type ProductQuery, type SupplierQuote } from "../model";
import { buildQuote, ok, type QuoteOverrides } from "../quote-builder";

/** Pflichtunterlagen je Produkt – Namen müssen mit den Dokumentbezeichnungen der Angebote beginnen. */
export const DEMO_REQUIRED_DOCUMENTS = {
  ce: "Konformitätserklärung",
  red: "Prüfbericht Funk/EMV (RED)",
  weee: "WEEE-Registrierungsnummer",
  gpsr: "Herstellerangaben (GPSR)",
  magnets: "Warnhinweis Magnete/Kleinteile",
  foodContact: "Konformität Lebensmittelkontakt (LFGB/EU 1935/2004)",
  trademark: "Kompatibilitätsangaben ohne Markenverletzung",
} as const;
const D = DEMO_REQUIRED_DOCUMENTS;

const query = (
  productId: string,
  title: string,
  gtin: string,
  ceRequired: boolean,
  requiredDocuments: string[],
): ProductQuery & { gtin: string } => ({
  productId,
  title,
  gtin,
  quantity: 1,
  destinationCountry: "DE",
  safety: { ceRequired, requiredDocuments },
});

/** Suchanfragen für die Demo-Produkte aus src/lib/demo/products.ts */
export const DEMO_QUERIES = {
  "p-led": query("p-led", "LED-Lichtleiste mit App-Steuerung (5 m)", "2000000000015", true, [D.ce, D.red, D.weee]),
  "p-stand": query("p-stand", "Faltbarer Laptopständer aus Aluminium", "2000000000022", false, [D.gpsr]),
  "p-cable": query("p-cable", "Magnetische Kabel-Organizer (10er-Set)", "2000000000039", false, [D.gpsr, D.magnets]),
  "p-bottle": query("p-bottle", "Isolierte Edelstahl-Trinkflasche 750 ml", "2000000000046", false, [D.gpsr, D.foodContact]),
  "p-band": query("p-band", "Silikon-Uhrenarmband (3er-Set)", "2000000000053", false, [D.gpsr, D.trademark]),
} satisfies Record<string, ProductQuery>;

export type DemoProductId = keyof typeof DEMO_QUERIES;

const said = <T>(value: T) => unconfirmed(value, "Selbstauskunft Lieferant (Demo)");
const docs = (...names: string[]) => names.map((n) => `${n} (Demo)`);

const PREPAYMENT: Partial<PaymentConditions> = {
  terms: ok({ kind: "prepayment" }),
  methods: ok(["prepayment", "paypal"]),
  creditLimit: missing(),
};

function forProduct(productId: DemoProductId) {
  const q = DEMO_QUERIES[productId];
  return (o: QuoteOverrides): SupplierQuote =>
    buildQuote({ ...o, productId, identity: { title: q.title, gtin: ok(q.gtin), ...o.identity } });
}
const led = forProduct("p-led");
const stand = forProduct("p-stand");
const cable = forProduct("p-cable");
const bottle = forProduct("p-bottle");
const band = forProduct("p-band");

/** Fiktiver Großhändler-Verbund mit Lagern in Deutschland und der EU. */
const EU_WHOLESALE: SupplierQuote[] = [
  // --- LED-Lichtleiste --------------------------------------------------------
  led({
    id: "demo-eu:eurolight:p-led",
    supplierId: "eurolight",
    supplierName: "EuroLight Fulfillment (Demo)",
    safety: { documents: docs(D.ce, D.red) }, // WEEE-Nummer fehlt noch
    pricing: { unitPrice: ok(8.4), shippingCost: ok(3.2), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("PL"), deliveryDays: ok({ min: 4, max: 7 }), stock: ok(800) },
    payment: { terms: ok({ kind: "net_terms", days: 14 }), creditLimit: ok(300) },
    reliability: { rating: ok(4.5), onTimeRate: ok(0.96), defectRate: ok(0.01), sampleTested: missing() },
  }),
  led({
    id: "demo-eu:lumio:p-led",
    supplierId: "lumio",
    supplierName: "Lumio Großhandel (Demo)",
    safety: { documents: docs(D.ce, D.red, D.weee) },
    pricing: { unitPrice: ok(10.9), shippingCost: ok(2.9), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("DE"), deliveryDays: ok({ min: 2, max: 3 }), stock: ok(350) },
    payment: { terms: ok({ kind: "net_terms", days: 30 }), creditLimit: ok(1000) },
    reliability: { rating: ok(4.8), onTimeRate: ok(0.95), defectRate: ok(0.01) },
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

  // --- Laptopständer ----------------------------------------------------------
  stand({
    id: "demo-eu:deskpro:p-stand",
    supplierId: "deskpro",
    supplierName: "DeskPro Supply (Demo)",
    safety: { documents: docs(D.gpsr) },
    pricing: { unitPrice: ok(11.2), shippingCost: ok(3.9), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("NL"), deliveryDays: ok({ min: 3, max: 6 }), stock: ok(420) },
    // Zahlungsziel nur behauptet → gilt bis zur Bestätigung als Vorfinanzierung
    payment: { terms: said({ kind: "net_terms", days: 30 }), creditLimit: missing(), requiresBusinessVerification: missing() },
    reliability: { rating: ok(4.6), onTimeRate: ok(0.93), defectRate: ok(0.02) },
  }),
  stand({
    id: "demo-eu:ergohandel:p-stand",
    supplierId: "ergohandel",
    supplierName: "ErgoHandel (Demo)",
    safety: { documents: docs(D.gpsr) },
    pricing: { unitPrice: ok(14.5), shippingCost: ok(3.2), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("DE"), deliveryDays: ok({ min: 1, max: 3 }), stock: ok(120) },
    reliability: { rating: ok(4.7), onTimeRate: missing(), defectRate: ok(0.01) },
  }),
  // Ausschluss: Bewertung unter Minimum
  stand({
    id: "demo-eu:quickship:p-stand",
    supplierId: "quickship",
    supplierName: "Quickship Trading (Demo)",
    pricing: { unitPrice: ok(10.4), shippingCost: ok(4.1), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("CZ"), deliveryDays: ok({ min: 5, max: 8 }), stock: ok(900) },
    payment: PREPAYMENT,
    reliability: { rating: ok(4.0), onTimeRate: ok(0.88), defectRate: ok(0.04) },
  }),

  // --- Kabel-Organizer --------------------------------------------------------
  cable({
    id: "demo-eu:ordnungswerk:p-cable",
    supplierId: "ordnungswerk",
    supplierName: "OrdnungsWerk (Demo)",
    safety: { documents: docs(D.gpsr, D.magnets) },
    pricing: { unitPrice: ok(1.9), shippingCost: ok(2.9), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("CZ"), deliveryDays: ok({ min: 3, max: 5 }), stock: ok(600) },
    payment: PREPAYMENT,
    reliability: { rating: ok(4.5), onTimeRate: ok(0.94), defectRate: ok(0.02) },
  }),
  // Ausschluss: Bestand unter Mindestbestand
  cable({
    id: "demo-eu:kabelfix:p-cable",
    supplierId: "kabelfix",
    supplierName: "Kabelfix (Demo)",
    safety: { documents: docs(D.gpsr, D.magnets) },
    pricing: { unitPrice: ok(2.6), shippingCost: ok(2.7), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("DE"), deliveryDays: ok({ min: 1, max: 2 }), stock: ok(40) },
    payment: { terms: ok({ kind: "net_terms", days: 14 }) },
    reliability: { rating: ok(4.9), onTimeRate: ok(0.98), defectRate: ok(0.005) },
  }),

  // --- Trinkflasche -----------------------------------------------------------
  bottle({
    id: "demo-eu:aquatrade:p-bottle",
    supplierId: "aquatrade",
    supplierName: "AquaTrade (Demo)",
    safety: { documents: docs(D.gpsr) }, // Nachweis Lebensmittelkontakt fehlt
    pricing: { unitPrice: ok(5.4), shippingCost: ok(3.1), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("FR"), deliveryDays: ok({ min: 4, max: 7 }), stock: ok(1200) },
    payment: PREPAYMENT,
    reliability: { rating: ok(4.4), onTimeRate: ok(0.92), defectRate: ok(0.02), sampleTested: missing() },
  }),
  bottle({
    id: "demo-eu:trinkgut:p-bottle",
    supplierId: "trinkgut",
    supplierName: "Trinkgut Versand (Demo)",
    safety: { documents: docs(D.gpsr, D.foodContact) },
    pricing: { unitPrice: ok(6.3), shippingCost: ok(2.8), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("DE"), deliveryDays: ok({ min: 1, max: 3 }), stock: ok(260) },
    // Zahlungsziel erst nach Gewerbeprüfung nutzbar
    payment: { terms: ok({ kind: "net_terms", days: 14 }), requiresBusinessVerification: ok(true) },
    reliability: { rating: ok(4.7), onTimeRate: ok(0.97), defectRate: ok(0.01) },
  }),

  // --- Uhrenarmband -----------------------------------------------------------
  band({
    id: "demo-eu:bandhub:p-band",
    supplierId: "bandhub",
    supplierName: "BandHub (Demo)",
    safety: { documents: docs(D.gpsr) }, // Markenrechts-/Kompatibilitätsprüfung fehlt
    pricing: { unitPrice: ok(1.6), shippingCost: ok(2.8), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("SK"), deliveryDays: ok({ min: 4, max: 6 }), stock: ok(700) },
    // Direktversand bestätigt, neutraler Versand und Bestellweg aber offen
    dropshipping: { blindShipping: missing(), orderChannel: said("email") },
    payment: PREPAYMENT,
    reliability: { rating: ok(4.3), onTimeRate: ok(0.9), defectRate: ok(0.03) },
  }),
  band({
    id: "demo-eu:armbanddirekt:p-band",
    supplierId: "armbanddirekt",
    supplierName: "Armband-Direkt (Demo)",
    safety: { documents: docs(D.gpsr, D.trademark) },
    pricing: { unitPrice: ok(2.2), shippingCost: ok(2.5), importCost: ok(0) },
    // Bestand nur Selbstauskunft
    fulfillment: { shipsFrom: ok("DE"), deliveryDays: ok({ min: 1, max: 3 }), stock: said(180) },
    payment: { terms: ok({ kind: "net_terms", days: 14 }) },
    reliability: { rating: ok(4.6), onTimeRate: ok(0.95), defectRate: ok(0.01) },
  }),
];

/** Fiktiver Marktplatz mit Lieferanten in Fernost. */
const ASIA_MARKETPLACE: SupplierQuote[] = [
  // Ausschluss: Lieferzeit zu lang (bis 16 Tage)
  led({
    id: "demo-asia:brightline:p-led",
    supplierId: "brightline",
    supplierName: "Brightline Demo Co.",
    safety: { documents: docs(D.ce) },
    pricing: { unitPrice: ok(6.2), shippingCost: ok(3.9), importCost: said(1.1) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 9, max: 16 }), stock: ok(2400) },
    dropshipping: { blindShipping: said(true) },
    payment: PREPAYMENT,
    reliability: { rating: ok(4.6), onTimeRate: ok(0.86), defectRate: ok(0.03), sampleTested: missing() },
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
    reliability: { rating: ok(4.4), onTimeRate: ok(0.85), defectRate: ok(0.03) },
  }),
  // Günstigster geeigneter Kabel-Organizer – Importkosten geschätzt, Muster noch nicht geprüft
  cable({
    id: "demo-asia:homegoods:p-cable",
    supplierId: "homegoods",
    supplierName: "HomeGoods Demo Yiwu",
    safety: { documents: docs(D.gpsr) }, // Warnhinweis Magnete fehlt
    pricing: { unitPrice: ok(1.1), shippingCost: ok(2.4), importCost: said(0.4) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 8, max: 12 }), stock: ok(5000), tracking: said(true) },
    dropshipping: { blindShipping: said(true) },
    payment: PREPAYMENT,
    reliability: { rating: ok(4.3), onTimeRate: ok(0.87), defectRate: ok(0.03), sampleTested: missing() },
  }),
  // Ausschluss: Lieferzeit zu lang
  bottle({
    id: "demo-asia:steelware:p-bottle",
    supplierId: "steelware",
    supplierName: "Steelware Demo Ningbo",
    pricing: { unitPrice: ok(3.9), shippingCost: ok(4.2), importCost: said(0.9) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 11, max: 20 }), stock: ok(3000) },
    payment: PREPAYMENT,
    reliability: { rating: ok(4.5), onTimeRate: ok(0.84), defectRate: ok(0.03) },
  }),
  // Ausschluss: Lieferzeit zu lang
  band({
    id: "demo-asia:strapline:p-band",
    supplierId: "strapline",
    supplierName: "StrapLine Demo Co.",
    pricing: { unitPrice: ok(0.9), shippingCost: ok(2.1), importCost: said(0.3) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 9, max: 14 }), stock: ok(8000) },
    payment: PREPAYMENT,
    reliability: { rating: ok(4.2), onTimeRate: ok(0.85), defectRate: ok(0.04) },
  }),
];

/** Alle Demo-Angebote (für synchrone Auswertungen, z. B. Produktanalyse). */
export const DEMO_SUPPLIER_QUOTES: readonly SupplierQuote[] = [...EU_WHOLESALE, ...ASIA_MARKETPLACE].map((q) => ({ ...q, demo: true }));

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

/** Adapter-ID je Angebot, wie sie der Scout setzt (für synchrone Auswertungen ohne Adapterlauf). */
const ADAPTER_OF = new Map([
  ...EU_WHOLESALE.map((q) => [q.id, "demo-eu-wholesale"] as const),
  ...ASIA_MARKETPLACE.map((q) => [q.id, "demo-asia-marketplace"] as const),
]);

/** Demo-Angebote eines Produkts – identisch zu dem, was die Demo-Adapter liefern. */
export function demoQuotesFor(productId: string): SupplierQuote[] {
  return DEMO_SUPPLIER_QUOTES.filter((q) => q.productId === productId).map((q) => ({ ...q, adapterId: ADAPTER_OF.get(q.id) ?? q.adapterId }));
}
