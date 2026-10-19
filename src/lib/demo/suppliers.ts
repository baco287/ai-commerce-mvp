// DEMODATEN – fiktive Lieferanten und simulierte Angebote.
// Namen, Preise und Konditionen sind frei erfunden und entsprechen keinen realen Firmen.

import type { SupplierOffer } from "@/lib/types";

type OfferInput = Omit<SupplierOffer, "id" | "productId">;

const offers = (productId: string, list: OfferInput[]): SupplierOffer[] =>
  list.map((o, i) => ({ ...o, productId, id: `${productId}-o${i + 1}` }));

export const DEMO_OFFERS: SupplierOffer[] = [
  ...offers("p-led", [
    { supplierName: "Brightline Demo Co.", region: "CN", warehouse: "Shenzhen", unitPrice: 6.2, shippingCost: 3.9, importCost: 1.1, deliveryDaysMin: 9, deliveryDaysMax: 16, rating: 4.6, stock: 2400, paymentTerms: "vorkasse" },
    { supplierName: "EuroLight Fulfillment (Demo)", region: "EU", warehouse: "Warschau, PL", unitPrice: 8.4, shippingCost: 3.2, importCost: 0, deliveryDaysMin: 4, deliveryDaysMax: 7, rating: 4.5, stock: 800, paymentTerms: "vorkasse" },
    { supplierName: "Lumio Großhandel (Demo)", region: "DE", warehouse: "Leipzig", unitPrice: 10.9, shippingCost: 2.9, importCost: 0, deliveryDaysMin: 2, deliveryDaysMax: 3, rating: 4.8, stock: 350, paymentTerms: "netto14" },
  ]),
  ...offers("p-stand", [
    { supplierName: "MetalWorks Demo Ltd.", region: "CN", warehouse: "Dongguan", unitPrice: 7.8, shippingCost: 5.4, importCost: 1.6, deliveryDaysMin: 10, deliveryDaysMax: 18, rating: 4.4, stock: 1500, paymentTerms: "vorkasse" },
    { supplierName: "Quickship Trading (Demo)", region: "EU", warehouse: "Prag, CZ", unitPrice: 10.4, shippingCost: 4.1, importCost: 0, deliveryDaysMin: 5, deliveryDaysMax: 8, rating: 4.0, stock: 900, paymentTerms: "vorkasse" },
    { supplierName: "DeskPro Supply (Demo)", region: "EU", warehouse: "Venlo, NL", unitPrice: 11.2, shippingCost: 3.9, importCost: 0, deliveryDaysMin: 3, deliveryDaysMax: 6, rating: 4.6, stock: 420, paymentTerms: "vorkasse" },
    { supplierName: "ErgoHandel (Demo)", region: "DE", warehouse: "Hamburg", unitPrice: 14.5, shippingCost: 3.2, importCost: 0, deliveryDaysMin: 1, deliveryDaysMax: 3, rating: 4.7, stock: 120, paymentTerms: "netto30" },
  ]),
  ...offers("p-cable", [
    { supplierName: "HomeGoods Demo Yiwu", region: "CN", warehouse: "Yiwu", unitPrice: 1.1, shippingCost: 2.4, importCost: 0.4, deliveryDaysMin: 8, deliveryDaysMax: 12, rating: 4.3, stock: 5000, paymentTerms: "vorkasse" },
    { supplierName: "OrdnungsWerk (Demo)", region: "EU", warehouse: "Brünn, CZ", unitPrice: 1.9, shippingCost: 2.9, importCost: 0, deliveryDaysMin: 3, deliveryDaysMax: 5, rating: 4.5, stock: 600, paymentTerms: "vorkasse" },
    { supplierName: "Kabelfix (Demo)", region: "DE", warehouse: "Nürnberg", unitPrice: 2.6, shippingCost: 2.7, importCost: 0, deliveryDaysMin: 1, deliveryDaysMax: 2, rating: 4.9, stock: 40, paymentTerms: "netto14" },
  ]),
  ...offers("p-bottle", [
    { supplierName: "Steelware Demo Ningbo", region: "CN", warehouse: "Ningbo", unitPrice: 3.9, shippingCost: 4.2, importCost: 0.9, deliveryDaysMin: 11, deliveryDaysMax: 20, rating: 4.5, stock: 3000, paymentTerms: "vorkasse" },
    { supplierName: "AquaTrade (Demo)", region: "EU", warehouse: "Lyon, FR", unitPrice: 5.4, shippingCost: 3.1, importCost: 0, deliveryDaysMin: 4, deliveryDaysMax: 7, rating: 4.4, stock: 1200, paymentTerms: "vorkasse" },
    { supplierName: "Trinkgut Versand (Demo)", region: "DE", warehouse: "Köln", unitPrice: 6.3, shippingCost: 2.8, importCost: 0, deliveryDaysMin: 1, deliveryDaysMax: 3, rating: 4.7, stock: 260, paymentTerms: "netto14" },
  ]),
  ...offers("p-band", [
    { supplierName: "StrapLine Demo Co.", region: "CN", warehouse: "Shenzhen", unitPrice: 0.9, shippingCost: 2.1, importCost: 0.3, deliveryDaysMin: 9, deliveryDaysMax: 14, rating: 4.2, stock: 8000, paymentTerms: "vorkasse" },
    { supplierName: "BandHub (Demo)", region: "EU", warehouse: "Bratislava, SK", unitPrice: 1.6, shippingCost: 2.8, importCost: 0, deliveryDaysMin: 4, deliveryDaysMax: 6, rating: 4.3, stock: 700, paymentTerms: "vorkasse" },
    { supplierName: "Armband-Direkt (Demo)", region: "DE", warehouse: "Dortmund", unitPrice: 2.2, shippingCost: 2.5, importCost: 0, deliveryDaysMin: 1, deliveryDaysMax: 3, rating: 4.6, stock: 180, paymentTerms: "netto14" },
  ]),
];
