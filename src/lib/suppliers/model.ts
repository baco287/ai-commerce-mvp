// Einheitliches Datenmodell des Supplier Scout Agents.
// Jeder Lieferanten-Adapter (Demo, später Feed oder API) liefert genau diese Struktur.
// Schnittstellenbeschreibung für echte Lieferanten: docs/SUPPLIER-AGENT.md
//
// Grundsatz: Jede geschäftsrelevante Angabe ist ein `Fact` und sagt ausdrücklich,
// ob sie bestätigt, nur behauptet (unbestätigt) oder gar nicht vorhanden ist.
// Fehlende Angaben werden nie stillschweigend durch Annahmen ersetzt.

/**
 * Status einer Angabe:
 * - confirmed   – durch einen UNABHÄNGIGEN Nachweis geprüft (Dokument, Testkauf, Vertrag), mit Quelle und Prüfdatum
 * - unconfirmed – nicht geprüft; `origin` sagt, ob der Lieferant sie angegeben hat oder ob sie geschätzt ist
 * - missing     – keine Angabe
 * Eine Lieferantenangabe (z. B. aus einer Preisliste) ist nie „confirmed“.
 */
export type FactStatus = "confirmed" | "unconfirmed" | "missing";

/** Herkunft einer unbestätigten Angabe: vom Lieferanten angegeben oder geschätzt/abgeleitet. */
export type FactOrigin = "supplier" | "estimate";

export type Fact<T> =
  | { status: "confirmed"; value: T; source: string; checkedAt: string }
  | { status: "unconfirmed"; value: T; source: string; origin?: FactOrigin }
  | { status: "missing" };

export const confirmed = <T>(value: T, source: string, checkedAt: string): Fact<T> => ({ status: "confirmed", value, source, checkedAt });
export const unconfirmed = <T>(value: T, source: string, origin?: FactOrigin): Fact<T> =>
  origin ? { status: "unconfirmed", value, source, origin } : { status: "unconfirmed", value, source };
/** Vom Lieferanten angegeben (Preisliste, Selbstauskunft) – nicht unabhängig geprüft. */
export const supplierStated = <T>(value: T, source: string): Fact<T> => unconfirmed(value, source, "supplier");
export const missing = <T>(): Fact<T> => ({ status: "missing" });

/** Vierstufige Einordnung für Anzeige und Prüfung. */
export type FactLevel = "verified" | "supplier_stated" | "unconfirmed" | "missing";
export function factLevel(f: Fact<unknown>): FactLevel {
  if (f.status === "confirmed") return "verified";
  if (f.status === "missing") return "missing";
  return f.origin === "supplier" ? "supplier_stated" : "unconfirmed";
}

/** Wert einer Angabe, falls vorhanden (bestätigt oder unbestätigt). */
export const factValue = <T>(f: Fact<T>): T | undefined => (f.status === "missing" ? undefined : f.value);
export const isConfirmed = <T>(f: Fact<T>, predicate: (v: T) => boolean = () => true): boolean =>
  f.status === "confirmed" && predicate(f.value);

/** ISO-3166-Ländercode, z. B. "DE", "PL", "CN". */
export type CountryCode = string;

export const EU_COUNTRIES: readonly CountryCode[] = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV",
  "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
];

/** Was der Scout für ein Produkt sucht. Bestellmenge ist immer eine Kundenbestellung – kein Vorratskauf. */
export interface ProductQuery {
  /** Produkt-ID der Kontrollzentrale (z. B. "p-led") */
  productId: string;
  title: string;
  /** EAN/GTIN – sicherste Zuordnung über Lieferanten hinweg */
  gtin?: string;
  /** Suchbegriffe für Quellen ohne GTIN-Suche (z. B. Marktplätze). Ersetzt nie die Identitätsprüfung. */
  keywords?: string;
  category?: string;
  /** Stück je Kundenbestellung (Standard 1) */
  quantity: number;
  destinationCountry: "DE";
  /** Produktsicherheit: Welche Nachweise für dieses Produkt zwingend sind */
  safety: {
    ceRequired: boolean;
    /**
     * Unterlagen, die vor einer Freigabe vorliegen müssen (z. B. „LFGB-Konformität“). Fehlende Unterlagen
     * schließen ein Angebot nicht aus, werden aber als offene Compliance-Nachweise ausgewiesen.
     */
    requiredDocuments?: string[];
  };
}

export type IdentityMatch = "exact" | "variant" | "different";

/** Produktidentität beim Lieferanten. Grundlage dafür, dass wirklich dasselbe Produkt verglichen wird. */
export interface ProductIdentity {
  supplierSku: string;
  title: string;
  gtin: Fact<string>;
  mpn: Fact<string>;
  brand: Fact<string>;
  /** Abgleich mit dem gesuchten Produkt (z. B. per GTIN, Datenblatt oder Muster) */
  match: Fact<IdentityMatch>;
}

/** Produktsicherheit nach EU-Recht (CE, GPSR). */
export interface ProductSafety {
  ceMarking: Fact<boolean>;
  /** Hersteller bzw. verantwortliche Person in der EU (GPSR) */
  euResponsiblePerson: Fact<string>;
  /** Sicherheits- und Gebrauchshinweise auf Deutsch vorhanden */
  safetyInformationDe: Fact<boolean>;
  /** Bekannte Probleme, z. B. Rückruf, Behördenwarnung. Jeder Eintrag schließt das Angebot aus. */
  openIssues: string[];
  /** Vorliegende Unterlagen, z. B. Konformitätserklärung, Prüfbericht – für die Compliance-Prüfung */
  documents: string[];
}

/** Alle Beträge netto in EUR je Stück. */
export interface Pricing {
  unitPrice: Fact<number>;
  /** Versand bis zum Kunden nach DE je Stück */
  shippingCost: Fact<number>;
  /** Zoll-/Importnebenkosten; bei Versand aus der EU 0 */
  importCost: Fact<number>;
  /** Mindestabnahme je Bestellung. Größer als die Bestellmenge = Vorratskauf → ausgeschlossen. */
  minOrderQuantity: Fact<number>;
  /** Mindestbestellwert netto in EUR (0 = keiner). Höher als eine Kundenbestellung = Vorratskauf → ausgeschlossen. */
  minOrderValue: Fact<number>;
}

export interface Fulfillment {
  shipsFrom: Fact<CountryCode>;
  /** Lieferung an Endkunden in DE möglich */
  deliversToDestination: Fact<boolean>;
  /** Lieferzeit in Werktagen bis zum Kunden */
  deliveryDays: Fact<{ min: number; max: number }>;
  /** Bestand im Lager des LIEFERANTEN (nicht unser Shopify-Bestand) */
  stock: Fact<number>;
  tracking: Fact<boolean>;
}

export type OrderChannel = "api" | "portal" | "email";

export interface DropshippingSupport {
  /** Versand direkt an unseren Kunden */
  supported: Fact<boolean>;
  /** Neutraler Versand ohne Werbung/Rechnung des Lieferanten im Paket */
  blindShipping: Fact<boolean>;
  orderChannel: Fact<OrderChannel>;
  returnsHandledBy: Fact<"supplier" | "shop">;
}

/**
 * Zahlungsbedingungen beim Lieferanten.
 * prepayment = Zahlung vor Versand (Vorkasse), net_terms = Rechnung mit Zahlungsziel.
 */
export type SupplierPaymentTerms = { kind: "prepayment" } | { kind: "net_terms"; days: number };

export type PaymentMethod = "prepayment" | "invoice" | "credit_card" | "paypal" | "direct_debit";

export interface PaymentConditions {
  terms: Fact<SupplierPaymentTerms>;
  /** Angebotene Zahlungsarten */
  methods: Fact<PaymentMethod[]>;
  /** Kreditrahmen beim Lieferanten in EUR, falls eingeräumt */
  creditLimit: Fact<number>;
  /** Zahlungsziel erst nach Gewerbe-/USt-Prüfung – bis dahin gilt es nicht */
  requiresBusinessVerification: Fact<boolean>;
}

export interface Reliability {
  /** Bewertung 1–5 */
  rating: Fact<number>;
  /** Anteil pünktlicher Lieferungen 0–1 */
  onTimeRate: Fact<number>;
  /** Anteil reklamierter/defekter Sendungen 0–1 */
  defectRate: Fact<number>;
  /** Muster bestellt und geprüft (Qualität, Kennzeichnung, Verpackung) */
  sampleTested: Fact<boolean>;
}

/** Woher ein Angebot stammt – für importierte Angebote vollständig nachvollziehbar. */
export interface QuoteProvenance {
  kind: "demo" | "price_list";
  /** Datenquelle laut Lieferant bzw. Spalte „Quelle“ */
  dataSource?: string;
  /** Dateiname der importierten Preisliste */
  file?: string;
  /** SHA-256 der importierten Datei */
  fileSha256?: string;
  /** Zeile in der Datei (1 = Kopfzeile) */
  row?: number;
  /** Kennung und Zeitpunkt des Imports */
  importId?: string;
  importedAt?: string;
  /** Aktualisierungsdatum laut Lieferant */
  supplierUpdatedAt?: string;
  /** Nachweise, die der aktuellen Preisliste widersprechen und deshalb NICHT angewendet wurden */
  evidenceConflicts?: string[];
  /** Synthetische Testdaten – werden wie Demo-Daten behandelt */
  synthetic?: boolean;
}

/** Ein normalisiertes Lieferantenangebot für genau ein Produkt. */
export interface SupplierQuote {
  /** Eindeutig je Adapter, z. B. "demo:brightline:p-led" */
  id: string;
  adapterId: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  /** true = fiktive Demo-Daten. Darf nie in echte Einkaufsentscheidungen einfließen. */
  demo: boolean;
  identity: ProductIdentity;
  safety: ProductSafety;
  pricing: Pricing;
  fulfillment: Fulfillment;
  dropshipping: DropshippingSupport;
  payment: PaymentConditions;
  reliability: Reliability;
  /** Zeitpunkt, zu dem der Adapter die Daten geliefert hat (ISO) */
  retrievedAt: string;
  /** Herkunft (fehlt bei älteren Adaptern) */
  provenance?: QuoteProvenance;
}
