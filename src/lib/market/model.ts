// Datenmodell des Market Scout Agents. Dokumentation: docs/MARKET-SCOUT.md
//
// Grundsatz: Arten von Marktsignalen werden STRIKT getrennt. Öffentliches Interesse (z. B. Wikipedia-Aufrufe)
// ist kein Suchvolumen, ein Suchvolumen ist keine Schätzung, und nichts davon ist ein belegter Verkauf.
// Nicht vorhandene Signale bleiben „fehlend“ – sie werden nie durch angenommene Werte ersetzt.

/**
 * Art eines Marktsignals:
 * - public_interest – öffentliches Interesse, z. B. Aufrufe eines Wikipedia-Artikels (real, aber kein Kaufsignal)
 * - search_interest – Suchinteresse aus einer Suchmaschine (heute keine rechtmäßig nutzbare kostenlose Quelle angebunden)
 * - estimate        – Schätzung (Modell, Annahme)
 * - verified_sales  – belegte Verkäufe (nur eigene Shop-Daten; heute keine)
 * - simulated       – Demo-Werte zum Testen der Abläufe, nie Grundlage für echte Entscheidungen
 */
export type SignalKind = "public_interest" | "search_interest" | "estimate" | "verified_sales" | "simulated";

export const SIGNAL_KIND_LABELS: Record<SignalKind, string> = {
  public_interest: "Öffentliches Interesse (Wikipedia-Aufrufe) – keine Suchanfragen, keine Verkäufe",
  search_interest: "Suchinteresse",
  estimate: "Schätzung",
  verified_sales: "Belegte Verkäufe",
  simulated: "Simulierte Demo-Werte",
};

export interface MarketSourceInfo {
  id: string;
  name: string;
  /** api = externe Schnittstelle; demo = simulierte Daten; manual = von Hand gepflegte lokale Datei (Katalog) */
  kind: "api" | "demo" | "manual";
  signalKind: SignalKind;
  /** Verursacht der Abruf Kosten? Dann nur mit SAFETY_SWITCHES.paidApiCallsEnabled (heute aus). */
  paid: boolean;
  network: boolean;
  /** Dokumentation der Schnittstelle bzw. Herkunft */
  docsUrl?: string;
  /** Nutzungsbedingungen der Daten */
  license?: string;
}

/** Tageswert einer Interessen-Zeitreihe (fehlende Tage sind bereits mit 0 aufgefüllt). */
export interface DailyValue {
  date: string;
  value: number;
}

/** Kennzahlen aus einer Interessen-Zeitreihe. null = nicht berechenbar (zu wenig Daten). */
export interface InterestMetrics {
  /** Ø Aufrufe pro Tag in den letzten 7 bzw. 30 Tagen */
  avg7: number;
  avg30: number;
  /** Veränderung der letzten 7 Tage gegenüber den 28 Tagen davor (0,25 = +25 %) */
  trend7: number | null;
  /** Veränderung der letzten 30 Tage gegenüber den 30 Tagen davor */
  trend30: number | null;
  /** Kommende 30 Tage im Vorjahr im Verhältnis zum Jahresdurchschnitt (1 = durchschnittlich, >1 = Saison beginnt) */
  seasonalIndex: number | null;
  /** Anzahl Tage in der Zeitreihe */
  days: number;
  /** Letzter Tag mit Daten (ISO-Datum) */
  lastDate: string | null;
}

/** Simulierte Signale der Demo-Produkte (0–100), nur für Demo-Kandidaten. */
export interface SimulatedSignals {
  searchTrend: number;
  socialBuzz: number;
  competition: number;
  seasonality: number;
}

export interface MarketSignal {
  sourceId: string;
  sourceName: string;
  kind: SignalKind;
  demo: boolean;
  /** Abrufzeitpunkt (ISO) */
  retrievedAt: string;
  /** Nachvollziehbare Fundstelle, z. B. API-Adresse oder Artikel-Link */
  reference: string;
  interest?: InterestMetrics;
  simulated?: SimulatedSignals;
  /**
   * Signal stammt nicht aus diesem Lauf, sondern aus dem gespeicherten Stand (state.json, höchstens
   * MARKET_SCAN.staleAfterDays alt). `retrievedAt` bleibt der Zeitpunkt der ursprünglichen Messung.
   * Erhöht die Unsicherheit um MARKET_SCAN.cachedSignalPenalty.
   */
  cached?: boolean;
}

/** Ein Produktkandidat aus der Marktrecherche. */
export interface MarketCandidate {
  /** Stabiler Schlüssel – verhindert Dubletten über mehrere Läufe, z. B. "wiki:de:Trinkflasche" */
  key: string;
  title: string;
  category?: string;
  /** Verknüpftes Produkt der Kontrollzentrale, falls das Thema einem bekannten Produkt entspricht */
  productId?: string;
  /** Produkt des lokalen Zielproduktkatalogs (.data/catalog/products.json) – echte Produktidentität mit Varianten */
  catalogId?: string;
  /** EAN/GTIN – nötig, damit der Supplier Scout Angebote sicher zuordnen kann */
  gtin?: string;
  /** Wie der Kandidat gefunden wurde, z. B. „Kategorie: Haushaltsgerät“ */
  discoveredVia: string;
  /** Kandidat stammt aus Demo-Daten (dann sind alle Folgeschritte Demo) */
  demo: boolean;
  signals: MarketSignal[];
}

/**
 * Identität eines Themas über Quellen hinweg (Dubletten-Vermeidung im Lauf): Katalogprodukt vor bekanntem Produkt vor
 * Quellen-Schlüssel. Demo und echt werden NIE zusammengeführt – der Präfix trennt sie.
 */
export function identityKey(t: { key: string; demo: boolean; catalogId?: string; productId?: string }): string {
  return (t.demo ? "demo|" : "real|") + (t.catalogId ? `c:${t.catalogId}` : t.productId ? `p:${t.productId}` : t.key);
}
