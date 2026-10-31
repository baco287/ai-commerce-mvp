// DEMODATEN – simulierte Systemaktivitäten, Warnungen und Freigabeanfragen.

import type { ActivityEvent, ApprovalRequest, SystemAlert } from "@/lib/types";

export const DEMO_ACTIVITIES: ActivityEvent[] = [
  { id: "a1", at: "2026-10-19T08:30:00Z", agentId: "order-fulfillment", kind: "blocked", message: "Einkauf für neue Demo-Bestellungen blockiert – Sicherheitsschalter aus." },
  { id: "a2", at: "2026-10-19T08:12:00Z", agentId: "profit-calculator", kind: "calculation", message: "Margen für 5 Produkte neu berechnet (Werbekosten-Annahme 6 € je Verkauf)." },
  { id: "a3", at: "2026-10-19T08:10:00Z", agentId: "supplier-scout", kind: "analysis", message: "20 Demo-Angebote bewertet, 10 erfüllen die Mindestanforderungen nicht." },
  { id: "a4", at: "2026-10-19T07:45:00Z", agentId: "market-research", kind: "analysis", message: "Trendsignale aktualisiert: Trinkflasche und LED-Lichtleiste mit hoher Nachfrage." },
  { id: "a5", at: "2026-10-19T07:00:00Z", agentId: "system", kind: "system", message: "Tagesstart: Demo-Modus aktiv, alle Echtgeld-Aktionen deaktiviert." },
  { id: "a6", at: "2026-10-18T16:05:00Z", agentId: "ads-manager", kind: "blocked", message: "Kampagnenentwurf erstellt, Start blockiert – echte Anzeigen deaktiviert." },
  { id: "a7", at: "2026-10-18T16:00:00Z", agentId: "store-manager", kind: "system", message: "Pausiert: keine Shopify-Verbindung konfiguriert." },
  { id: "a8", at: "2026-10-18T14:20:00Z", agentId: "supplier-scout", kind: "analysis", message: "Laptopständer: günstigeres Angebot wegen Bewertung 4,0 ausgeschlossen." },
];

export const DEMO_ALERTS: SystemAlert[] = [
  {
    id: "w-payout",
    severity: "warning",
    title: "Auszahlungen verzögert",
    detail: "Kundenzahlungen stehen erst nach ca. 7 Tagen zur Verfügung. Die meisten Demo-Lieferanten verlangen Vorkasse.",
  },
  {
    id: "w-band",
    severity: "critical",
    title: "Negativer Deckungsbeitrag",
    detail: "Silikon-Uhrenarmband: Nach Werbekosten bleibt kein Gewinn. Empfehlung: nicht listen.",
  },
  {
    id: "w-compliance",
    severity: "warning",
    title: "Compliance offen",
    detail: "Für kein Produkt liegen bisher CE/GPSR-Nachweise oder Registrierungen vor.",
  },
  {
    id: "i-demo",
    severity: "info",
    title: "Demo-Modus aktiv",
    detail: "Alle Zahlen sind simuliert. Keine echten APIs, Bestellungen oder Anzeigen.",
  },
];

export const DEMO_APPROVALS: ApprovalRequest[] = [
  {
    id: "ap-listing-led",
    kind: "product_listing",
    title: "LED-Lichtleiste in den Shop übernehmen",
    detail: "Empfehlung „Kandidat“: Nachfrage hoch, Marge über 20 %. Compliance-Prüfung steht noch aus.",
    requestedBy: "market-research",
  },
  {
    id: "ap-supplier-stand",
    kind: "supplier_change",
    title: "Laptopständer: Lieferant DeskPro Supply (Demo) festlegen",
    detail: "Günstigster geeigneter Lieferant mit 3–6 Tagen Lieferzeit.",
    requestedBy: "supplier-scout",
  },
  {
    id: "ap-ads-test",
    kind: "ad_budget",
    title: "Werbetest LED-Lichtleiste – 10 € pro Tag",
    detail: "Testkampagne über 7 Tage.",
    requestedBy: "ads-manager",
    amount: 70,
    lockedReason: "Echte Werbeanzeigen sind im MVP deaktiviert.",
  },
  {
    id: "ap-purchase",
    kind: "purchase",
    title: "Lieferanteneinkauf für offene Demo-Bestellungen",
    detail: "Sammeleinkauf für bezahlte Demo-Bestellungen.",
    requestedBy: "order-fulfillment",
    lockedReason: "Automatischer Einkauf ist deaktiviert, Finanzierung nicht gesichert.",
  },
];
