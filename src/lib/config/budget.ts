// Budget, Sicherheitsschalter und Freigaberegeln.
// Im MVP sind alle Echtgeld-Aktionen hart deaktiviert. Änderungen hier sind bewusst
// Code-Änderungen (Review über Git), keine Klicks in der Oberfläche.

// Object.freeze: auch zur Laufzeit nicht veränderbar (as const schützt nur beim Kompilieren).
export const SAFETY_SWITCHES = Object.freeze({
  /** Automatischer Lieferanteneinkauf nach Kundenbestellung */
  autoPurchaseEnabled: false,
  /** Echte Werbeanzeigen schalten */
  realAdsEnabled: false,
  /** Echte Aufrufe kostenpflichtiger APIs (OpenAI, Claude, Shopify Admin …) */
  paidApiCallsEnabled: false,
  /**
   * Schreibzugriff auf Shopify – freigegeben am 31.10.2026, eng begrenzt auf die Positivliste in
   * src/lib/shopify/write-operations.ts (Bestandsverfolgung, eigene Produktbilder, Demo-Bestand 0,
   * fehlende Produkte als Entwurf). Nie veröffentlichen, nie aktivieren, nie löschen, keine Bestellungen.
   * Läuft nur über den Befehl `npm run shopify:sync -- --apply`, nie aus dem Dashboard.
   */
  shopifyWriteEnabled: true,
} as const);

export const SAFETY_SWITCH_LABELS: Record<keyof typeof SAFETY_SWITCHES, string> = {
  autoPurchaseEnabled: "Automatischer Lieferanteneinkauf",
  realAdsEnabled: "Echte Werbeanzeigen",
  paidApiCallsEnabled: "Kostenpflichtige API-Aufrufe",
  shopifyWriteEnabled: "Shopify-Schreibzugriff",
};

export const BUDGET = {
  /** Gesamtes Startbudget in EUR */
  total: 500,
  /** Tatsächlich ausgegeben (echtes Geld). Im Demo-Modus immer 0. */
  spent: 0,
  /**
   * Vorschlag für die Aufteilung – noch NICHT freigegeben.
   * Echte Beträge werden erst nach Prüfung der Anbieterpreise festgelegt.
   */
  plannedAllocation: [
    { key: "shop", label: "Shop & Tools", amount: 150 },
    { key: "ads", label: "Werbetests", amount: 200 },
    { key: "samples", label: "Produktmuster", amount: 80 },
    { key: "reserve", label: "Reserve", amount: 70 },
  ],
} as const;

/** Grenzwerte für spätere automatisierte Aktionen (gelten erst, wenn die Schalter oben aktiv sind). */
export const LIMITS = {
  /** Maximaler Lieferanteneinkauf je Bestellung ohne manuelle Freigabe */
  maxAutoPurchasePerOrder: 40,
  /** Maximales Werbebudget pro Tag */
  maxAdSpendPerDay: 10,
  /** Preisänderungen über diesem Anteil brauchen eine Freigabe */
  maxPriceChangeWithoutApproval: 0.1,
} as const;

/** Lesbare Freigaberegeln für Dokumentation und Oberfläche. */
export const APPROVAL_RULES: { title: string; detail: string }[] = [
  {
    title: "Jede Ausgabe braucht eine Freigabe",
    detail: "In der MVP-Phase wird kein Euro ohne manuelle Bestätigung ausgegeben – auch nicht innerhalb des Budgets.",
  },
  {
    title: "Automatischer Einkauf erst mit gesicherter Finanzierung",
    detail:
      "Ein Lieferanteneinkauf ist nur zulässig, wenn die Kundenzahlung erfasst ist UND die Auszahlung vorliegt, ein Lieferanten-Zahlungsziel die Auszahlungsdauer abdeckt oder ein freigegebener Finanzierungsrahmen reicht.",
  },
  {
    title: "Werbeanzeigen nur mit Tageslimit",
    detail: `Echte Anzeigen sind deaktiviert. Später gilt ein hartes Tageslimit von ${LIMITS.maxAdSpendPerDay} € und eine Freigabe je Kampagne.`,
  },
  {
    title: "Neue Produkte nur nach Prüfung",
    detail: "Produkte gehen erst nach Compliance-Check (CE, GPSR, Elektro-/Verpackungsregistrierung) und manueller Freigabe in den Shop.",
  },
  {
    title: "Große Preisänderungen freigeben",
    detail: `Preisänderungen über ${Math.round(LIMITS.maxPriceChangeWithoutApproval * 100)} % müssen bestätigt werden.`,
  },
];
