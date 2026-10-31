// Steuerung des Market Scout: Grenzen, Abbruchschalter, beobachtete Themen.
// Änderungen hier sind bewusste Code-Änderungen (Review über Git).

/** Grenzen je Lauf. Eingefroren: zur Laufzeit nicht veränderbar. */
export const MARKET_SCAN = Object.freeze({
  /** Abbruchschalter im Code: false = kein Lauf startet. Zusätzlich stoppt die Datei .data/market/STOP jeden Lauf. */
  enabled: true,
  /** Höchstzahl an Abrufen bei externen Quellen je Lauf (Kategorie- und Zeitreihenabrufe zusammen) */
  maxRequestsPerRun: 60,
  /** Pause zwischen zwei Abrufen (Anfragen laufen nacheinander, nie parallel) */
  requestDelayMs: 300,
  requestTimeoutMs: 15_000,
  /** Höchstzahl neu gemessener Kandidaten je Lauf */
  maxCandidatesPerRun: 25,
  /** Artikel je Kategorie, die bei der Entdeckung gelesen werden */
  membersPerCategory: 12,
  /** Kostenlimit je Lauf in EUR. Kostenpflichtige Quellen sind ohnehin gesperrt (SAFETY_SWITCHES.paidApiCallsEnabled). */
  maxCostEurPerRun: 0,
  /**
   * Ab diesem Nachfrage-Wert (Bestandteil des Opportunity Score, 0–100) prüft der Agent Lieferanten.
   * 35 entspricht etwa 10 Wikipedia-Aufrufen pro Tag bei gleichbleibendem Trend.
   */
  minDemandForSupplierCheck: 35,
  /** Ab dieser Unsicherheit (0–1) gilt eine Bewertung als nicht belastbar */
  maxUncertainty: 0.5,
  /** Ergebnisse älter als diese Tage gelten als veraltet */
  staleAfterDays: 7,
});

/** User-Agent nach Wikimedia-Richtlinie: Projekt und Kontaktmöglichkeit. */
export const MARKET_USER_AGENT = "ai-commerce-mvp/0.1 (https://github.com/baco287/ai-commerce-mvp; Marktrecherche-Prototyp)";

/**
 * Beobachtete Wikipedia-Kategorien (geprüft am 31.10.2026, existieren auf de.wikipedia).
 * Der Agent liest daraus automatisch Artikelthemen und misst deren Interessenverlauf.
 */
export const WATCHED_CATEGORIES = ["Haushaltsgerät", "Küchengerät", "Trinkgefäß", "Leuchte", "Sportgerät", "Büromaterial", "Werkzeug"] as const;

/**
 * Feste Themen, die einem bekannten Produkt der Kontrollzentrale entsprechen (geprüft am 31.10.2026).
 * Für „LED-Lichtleiste“ und „Laptopständer“ gibt es keinen passenden Artikel – sie erhalten kein reales Signal.
 */
export const LINKED_TOPICS: { title: string; productId: string }[] = [
  { title: "Trinkflasche", productId: "p-bottle" },
  { title: "Uhrenarmband", productId: "p-band" },
  { title: "Kabelmanagement", productId: "p-cable" },
];
