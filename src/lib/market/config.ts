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
  /**
   * Ergebnisse älter als diese Tage gelten als veraltet. Zwischengespeicherte Nachfragesignale (state.json) werden nur
   * bis zu diesem Alter wiederverwendet.
   */
  staleAfterDays: 7,
  /**
   * Unsicherheitsaufschlag (0–1) für ein zwischengespeichertes statt live gemessenes Nachfragesignal.
   * Konfiguration – Entscheidung des Inhabers offen (Entscheidung 1); 0,1 ist die konservative Voreinstellung.
   */
  cachedSignalPenalty: 0.1,
});

/**
 * Regeln des Profit Controllers (Stückrechnung je Verkauf). Eingefroren. Konservative Platzhalter – ersetzen, sobald
 * Gebührenliste und echte Konditionen vorliegen. Konfiguration – Entscheidung des Inhabers offen (Entscheidung 1);
 * die Werte sind die empfohlenen Voreinstellungen. Retourenquote, Rücksendekosten und Auszahlung stehen in
 * LIQUIDITY_RULES (src/lib/suppliers/liquidity.ts).
 */
export const PROFIT_RULES = Object.freeze({
  /** Dropshipping-/Bearbeitungsgebühr je Bestellung (EUR) – wird auf die Worst-Case-Stückkosten aufgeschlagen */
  handlingFeeAssumption: 1.0,
  /** Mindest-Deckungsbeitrag je Verkauf (EUR) */
  minContributionEur: 3.0,
});
export type ProfitRules = { readonly [K in keyof typeof PROFIT_RULES]: number };

/**
 * Regeln des Store Managers (lokales Entwurfs-Artefakt, Paket E). Eingefroren.
 * Konfiguration – Entscheidung des Inhabers offen (Mindestlänge der Beschreibung ist ein konservativer Platzhalter).
 */
export const STORE_MANAGER_RULES = Object.freeze({
  /**
   * Mindestlänge der Produktbeschreibung (reiner Text ohne HTML und ohne GPSR-Block) für einen vollständigen echten
   * Entwurf. Demo-Entwürfe tragen gekennzeichnete Platzhaltertexte und sind ausgenommen (wie beim Bild).
   */
  minDescriptionChars: 200,
});

/**
 * Wann der Agent einen echten Kandidaten „bereit zur Prüfung“ (review_ready) setzen darf – das ist NIE eine Freigabe.
 * Konfiguration – Entscheidung des Inhabers offen (Entscheidung 4): Darf ein unbelegtes Zahlungsziel
 * (LIQ_TERM_UNSECURED: deckt den Worst Case, aber Fristbeginn, Kreditrahmen oder Mittel unbelegt) zur Prüfung durch
 * Menschen vorgelegt werden? Voreinstellung = Vorschlag des Plans: ja, mit Code, nie automatisierbar.
 */
export const REVIEW_READY_RULES = Object.freeze({
  allowUnsecuredTerms: true as boolean,
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
