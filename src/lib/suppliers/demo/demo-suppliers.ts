// DEMODATEN – fiktive Lieferanten und simulierte Angebote für den Supplier Scout.
// Namen, Preise, Konditionen und GTINs sind frei erfunden und entsprechen keinen realen Firmen.
// Die GTINs stammen aus dem Präfixbereich 200–299 (nur für interne Zwecke, nie im Handel vergeben).
//
// Eine Quelle für alle Zahlen: Preis, Versand, Import, Lieferzeit, Bewertung, Bestand und
// Zahlungsbedingungen kommen unverändert aus den Dashboard-Demodaten (src/lib/demo/suppliers.ts).
// Hier werden nur die Angaben ergänzt, die das alte Modell nicht kennt (Identität, Produktsicherheit,
// Dropshipping, Zuverlässigkeit, Gewerbeprüfung) – plus einige zusätzliche Angebote, die der Scout
// aus Sicherheitsgründen ausschließen muss.

import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { DEMO_OFFERS } from "@/lib/demo/suppliers";
import type { PaymentTerms, SupplierOffer } from "@/lib/types";
import type { SupplierAdapter } from "../adapter";
import { missing, unconfirmed, type PaymentConditions, type ProductQuery, type SupplierPaymentTerms, type SupplierQuote } from "../model";
import { buildQuote, ok, type QuoteOverrides } from "../quote-builder";

/** Fiktive GTINs (Präfix 200, Prüfziffer korrekt) je Demo-Produkt */
const DEMO_GTINS: Record<string, string> = {
  "p-led": "2000000000015",
  "p-stand": "2000000000022",
  "p-cable": "2000000000039",
  "p-bottle": "2000000000046",
  "p-band": "2000000000053",
};

/** Suchanfragen für alle Demo-Produkte aus src/lib/demo/products.ts */
export const DEMO_QUERIES: Record<string, ProductQuery> = Object.fromEntries(
  DEMO_PRODUCTS.map((p) => [
    p.id,
    {
      productId: p.id,
      title: p.name,
      category: p.category,
      gtin: DEMO_GTINS[p.id],
      quantity: 1,
      destinationCountry: "DE",
      // CE ist Pflicht, wenn die Compliance-Hinweise des Produkts sie nennen (z. B. Elektrogeräte)
      safety: { ceRequired: p.complianceNotes.some((n) => /\bCE\b/.test(n)) },
    } satisfies ProductQuery,
  ]),
);

const said = <T>(value: T) => unconfirmed(value, "Selbstauskunft Lieferant (Demo)");

const LEGACY_TERMS: Record<PaymentTerms, SupplierPaymentTerms> = {
  vorkasse: { kind: "prepayment" },
  netto14: { kind: "net_terms", days: 14 },
  netto30: { kind: "net_terms", days: 30 },
};

const PREPAYMENT: Partial<PaymentConditions> = {
  terms: ok({ kind: "prepayment" }),
  methods: ok(["prepayment", "paypal"]),
  creditLimit: missing(),
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(demo\)|\bdemo\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Versandland aus der Lagerangabe („Warschau, PL“) bzw. der Region (CN, DE). */
const countryOf = (o: SupplierOffer) => /,\s*([A-Z]{2})$/.exec(o.warehouse)?.[1] ?? o.region;

function forProduct(productId: string, o: Omit<QuoteOverrides, "productId">): SupplierQuote {
  const q = DEMO_QUERIES[productId];
  const gtin = q.gtin ? ok(q.gtin) : missing<string>();
  return buildQuote({ ...o, productId, identity: { title: q.title, gtin, ...o.identity } });
}

/** Typische Zusatzangaben je Herkunft – bewusst unterschiedlich vollständig. */
function profileFor(o: SupplierOffer): Partial<QuoteOverrides> {
  if (o.region === "CN") {
    return {
      // Importkosten sind beim Fernost-Marktplatz nur geschätzt
      pricing: { importCost: said(o.importCost) },
      dropshipping: { blindShipping: said(true) },
      payment: PREPAYMENT,
      reliability: { onTimeRate: ok(0.86), defectRate: ok(0.03), sampleTested: missing() },
    };
  }
  if (o.paymentTerms === "vorkasse") {
    return { payment: PREPAYMENT, reliability: { onTimeRate: ok(0.94), defectRate: ok(0.015) } };
  }
  return {
    payment: { methods: ok(["invoice", "paypal"]), creditLimit: ok(500), requiresBusinessVerification: ok(false) },
    reliability: { onTimeRate: ok(0.97), defectRate: ok(0.01) },
  };
}

/** Einzelne Abweichungen, damit die Demo offene Punkte zeigt. */
const TWEAKS: Record<string, Partial<QuoteOverrides>> = {
  // Pünktlichkeit unbekannt → offener Punkt, zählt in der Zuverlässigkeit 0
  "ErgoHandel (Demo)": { reliability: { onTimeRate: missing() } },
  // Unklar, ob das Zahlungsziel eine Gewerbeprüfung voraussetzt → Vorfinanzierung bis zur Klärung
  "Trinkgut Versand (Demo)": { payment: { requiresBusinessVerification: missing() } },
  // Neutraler Versand nicht bestätigt
  "DeskPro Supply (Demo)": { dropshipping: { blindShipping: missing() } },
};

const merge = (a: Partial<QuoteOverrides>, b: Partial<QuoteOverrides> = {}): Partial<QuoteOverrides> => ({
  ...a,
  ...b,
  pricing: { ...a.pricing, ...b.pricing },
  dropshipping: { ...a.dropshipping, ...b.dropshipping },
  payment: { ...a.payment, ...b.payment },
  reliability: { ...a.reliability, ...b.reliability },
});

/** Scout-Angebot aus einem Dashboard-Demoangebot. Alle Kernzahlen werden 1:1 übernommen. */
function fromDashboardOffer(o: SupplierOffer): SupplierQuote {
  const id = slug(o.supplierName);
  const extra = merge(profileFor(o), TWEAKS[o.supplierName]);
  return forProduct(o.productId, {
    ...extra,
    id: `demo:${id}:${o.productId}`,
    supplierId: id,
    supplierName: o.supplierName,
    pricing: { unitPrice: ok(o.unitPrice), shippingCost: ok(o.shippingCost), importCost: ok(o.importCost), ...extra.pricing },
    fulfillment: {
      shipsFrom: ok(countryOf(o)),
      deliveryDays: ok({ min: o.deliveryDaysMin, max: o.deliveryDaysMax }),
      stock: ok(o.stock),
    },
    payment: { terms: ok(LEGACY_TERMS[o.paymentTerms]), ...extra.payment },
    reliability: { rating: ok(o.rating), ...extra.reliability },
  });
}

/**
 * Zusätzliche Angebote nur im Scout. Sie zeigen, warum ein Angebot trotz gutem Preis ausgeschlossen wird.
 * Sie erscheinen nicht in der alten Vergleichstabelle.
 */
const SCOUT_ONLY: SupplierQuote[] = [
  // Ausschluss: nur ähnliche Variante, Identität nicht bestätigt
  forProduct("p-led", {
    id: "demo:shinelight:p-led",
    supplierId: "shinelight",
    supplierName: "Shinelight Wholesale (Demo)",
    identity: { gtin: missing(), match: said("variant") },
    pricing: { unitPrice: ok(4.9), shippingCost: ok(2.5), importCost: said(0.8) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 9, max: 12 }), stock: ok(5000) },
    payment: PREPAYMENT,
  }),
  // Ausschluss: CE-Kennzeichnung fehlt (Restposten ohne Unterlagen)
  forProduct("p-led", {
    id: "demo:voltmarkt:p-led",
    supplierId: "voltmarkt",
    supplierName: "Voltmarkt Restposten (Demo)",
    safety: { ceMarking: missing(), safetyInformationDe: said(true), documents: [] },
    pricing: { unitPrice: ok(7.5), shippingCost: ok(2.9), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("DE"), deliveryDays: ok({ min: 2, max: 4 }), stock: ok(140) },
    payment: PREPAYMENT,
  }),
  // Ausschluss: Mindestabnahme 100 Stück – das wäre ein Vorratskauf
  forProduct("p-led", {
    id: "demo:bulkware:p-led",
    supplierId: "bulkware",
    supplierName: "Bulkware Demo Trading",
    pricing: { unitPrice: ok(3.8), shippingCost: ok(1.2), importCost: ok(0.6), minOrderQuantity: ok(100) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 10, max: 12 }), stock: ok(20000) },
    payment: PREPAYMENT,
  }),
  // Ausschluss: bekannte Behördenwarnung (Verschluckungsgefahr durch lose Magnete)
  forProduct("p-cable", {
    id: "demo:magnetmax:p-cable",
    supplierId: "magnetmax",
    supplierName: "MagnetMax Trading (Demo)",
    safety: { openIssues: ["Behördenwarnung: lose Magnete, Verschluckungsgefahr (fiktiv)"] },
    pricing: { unitPrice: ok(0.9), shippingCost: ok(2.2), importCost: ok(0.3) },
    fulfillment: { shipsFrom: ok("CN"), deliveryDays: ok({ min: 7, max: 11 }), stock: ok(9000) },
    payment: PREPAYMENT,
  }),
  // Ausschluss: derzeit kein Bestand
  forProduct("p-band", {
    id: "demo:stripe-co:p-band",
    supplierId: "stripe-co",
    supplierName: "Stripe & Co. Lager (Demo)",
    pricing: { unitPrice: ok(1.4), shippingCost: ok(2.6), importCost: ok(0) },
    fulfillment: { shipsFrom: ok("CZ"), deliveryDays: ok({ min: 3, max: 6 }), stock: ok(0) },
  }),
];

const ALL_QUOTES: SupplierQuote[] = [...DEMO_OFFERS.map(fromDashboardOffer), ...SCOUT_ONLY];
const fromAsia = (q: SupplierQuote) => q.fulfillment.shipsFrom.status !== "missing" && q.fulfillment.shipsFrom.value === "CN";

/** Adapter über statische Demo-Angebote. Kein Netzwerk, keine Kosten, keine Bestellungen. */
export function createDemoAdapter(id: string, name: string, quotes: SupplierQuote[]): SupplierAdapter {
  const own = quotes.map((q) => ({ ...q, adapterId: id, demo: true }));
  return {
    info: { id, name, kind: "demo", paid: false, network: false },
    findQuotes: async (query) => own.filter((q) => q.productId === query.productId),
  };
}

export const DEMO_ADAPTERS: SupplierAdapter[] = [
  createDemoAdapter("demo-eu-wholesale", "EU-Großhandel (Demo)", ALL_QUOTES.filter((q) => !fromAsia(q))),
  createDemoAdapter("demo-asia-marketplace", "Fernost-Marktplatz (Demo)", ALL_QUOTES.filter(fromAsia)),
];
