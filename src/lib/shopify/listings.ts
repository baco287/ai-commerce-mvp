// DEMODATEN – Shop-Angaben je Dashboard-Produkt (Titel, Varianten, Beschreibung, Kategorie).
// Preise, Kosten und Lieferant kommen NICHT von hier, sondern aus der Dashboard-Kalkulation
// (src/lib/data.ts), damit Shop und Kontrollzentrale nie auseinanderlaufen.
//
// Später ersetzt der Store Manager Agent diese Datei durch generierte, freigegebene Inhalte.

export interface ListingVariant {
  /** Wert der Option, z. B. "Silber". Ohne Option: undefined (Shopify "Default Title"). */
  value?: string;
  sku: string;
}

export interface ProductListing {
  /** Dashboard-Produkt-ID (src/lib/demo/products.ts) */
  productId: string;
  handle: string;
  title: string;
  /** Kategorie-Tag, steuert die automatisierten Kollektionen im Shop */
  categoryTag: string;
  productType: string;
  descriptionHtml: string;
  option?: string;
  variants: ListingVariant[];
}

/** Kennzeichnung aller Demo-Produkte in Shopify (Tag, Titel-, Handle- und SKU-Präfix). */
export const DEMO_MARKERS = {
  tag: "ai-commerce-demo",
  titlePrefix: "[DEMO] ",
  handlePrefix: "demo-",
  skuPrefix: "DEMO-",
  vendor: "AI Commerce",
} as const;

export const DEMO_NOTICE_HTML = "<p><strong>Demo-Produkt – nicht zum Verkauf freigegeben.</strong></p>";

export const DEMO_LISTINGS: ProductListing[] = [
  {
    productId: "p-led",
    handle: "demo-led-lichtleiste",
    title: "[DEMO] LED-Lichtleiste mit App-Steuerung (5 m)",
    categoryTag: "wohnen-licht",
    productType: "Wohnen & Licht",
    descriptionHtml:
      "<p>Platzhalter-Beschreibung: LED-Lichtleiste mit App-Steuerung, 5 m. Technische Daten, Lieferumfang und Sicherheitshinweise werden vor der Veröffentlichung aus geprüften Lieferantenangaben ergänzt.</p>",
    variants: [{ sku: "DEMO-LED-001" }],
  },
  {
    productId: "p-stand",
    handle: "demo-laptopstaender",
    title: "[DEMO] Faltbarer Laptopständer aus Aluminium",
    categoryTag: "buero-homeoffice",
    productType: "Büro & Homeoffice",
    descriptionHtml:
      "<p>Platzhalter-Beschreibung: Faltbarer Laptopständer aus Aluminium. Maße, Gewicht, Belastbarkeit und Kompatibilität werden vor der Veröffentlichung aus geprüften Lieferantenangaben ergänzt.</p>",
    option: "Farbe",
    variants: [
      { value: "Silber", sku: "DEMO-STAND-SLV" },
      { value: "Space Grau", sku: "DEMO-STAND-GRY" },
    ],
  },
  {
    productId: "p-cable",
    handle: "demo-kabel-organizer",
    title: "[DEMO] Magnetische Kabel-Organizer (10er-Set)",
    categoryTag: "zubehoer",
    productType: "Zubehör",
    descriptionHtml:
      "<p>Platzhalter-Beschreibung: Set aus zehn magnetischen Kabelhaltern. Material, Maße und Warnhinweise (Magnete/Kleinteile) werden vor der Veröffentlichung ergänzt.</p>",
    variants: [{ sku: "DEMO-CABLE-001" }],
  },
  {
    productId: "p-bottle",
    handle: "demo-trinkflasche",
    title: "[DEMO] Isolierte Edelstahl-Trinkflasche 750 ml",
    categoryTag: "kueche-outdoor",
    productType: "Küche & Outdoor",
    descriptionHtml:
      "<p>Platzhalter-Beschreibung: Isolierte Trinkflasche aus Edelstahl, 750 ml. Angaben zu Material, Lebensmittelkontakt und Pflege werden vor der Veröffentlichung aus geprüften Nachweisen ergänzt.</p>",
    option: "Farbe",
    variants: [
      { value: "Schwarz", sku: "DEMO-BOTTLE-BLK" },
      { value: "Weiß", sku: "DEMO-BOTTLE-WHT" },
      { value: "Salbeigrün", sku: "DEMO-BOTTLE-GRN" },
    ],
  },
  {
    productId: "p-band",
    handle: "demo-uhrenarmband",
    title: "[DEMO] Silikon-Uhrenarmband (3er-Set)",
    categoryTag: "zubehoer",
    productType: "Zubehör",
    descriptionHtml:
      "<p>Platzhalter-Beschreibung: Set aus drei Silikon-Armbändern. Kompatibilitätsangaben werden vor der Veröffentlichung markenrechtlich geprüft.</p>",
    option: "Größe",
    variants: [
      { value: "S/M", sku: "DEMO-BAND-SM" },
      { value: "M/L", sku: "DEMO-BAND-ML" },
    ],
  },
];
