// Begründungs-Codes der Market-Pipeline: stabile, maschinenlesbare Gründe für jeden Zustand eines Kandidaten.
//
// Regeln: Codes werden nur ergänzt, nie umbenannt (sie stehen in gespeicherten Ständen und Protokollen).
// Jeder Code hat ein Label (ohne €-Beträge – darf in geschwärzten Ständen erscheinen) und eine Wirkung:
// - defer – stellt zurück (Endzustand höchstens „zurückgestellt“)
// - block – sperrt automatisierte Folgeschritte (z. B. Demo-Daten, simulierte Uhr, Freigabe nur durch Menschen)
// - hint  – nur Protokoll, ändert den Zustand nicht
//
// Codes, die erst spätere Pakete setzen (Entwurf, Journal), sind hier bereits festgelegt, damit die Liste stabil bleibt.
// Ihre Wirkung ist bis zur Umsetzung dieser Pakete vorläufig. Profit- und Liquiditätscodes sind mit Paket C festgelegt.

export const REASON_CODES = [
  "MARKET_PROHIBITED",
  "MARKET_NO_DEMAND",
  "MARKET_LOW_DEMAND",
  "MARKET_SIGNAL_CACHED",
  "UNCERTAINTY_HIGH",
  "CATALOG_INVALID",
  "CLOCK_OVERRIDDEN",
  "IDENTITY_MISSING",
  "IDENTITY_AMBIGUOUS",
  "IDENTITY_CONFLICT",
  "IDENTITY_GTIN_AVAILABLE",
  "IDENTITY_NO_OFFER",
  "IDENTITY_RESTRICTED_GTIN",
  "IDENTITY_TRADE_UNIT_GTIN",
  "SUPPLIER_NONE",
  "SUPPLIER_ALL_EXCLUDED",
  "SUPPLIER_VARIANTS_INCOMPLETE",
  "OFFER_DUPLICATE_ASSIGNMENT",
  "PRICE_MISSING",
  "MARGIN_LOW",
  "MARGIN_BELOW_MIN",
  "MARGIN_STRESS_NEGATIVE",
  "MARGIN_UNRELIABLE",
  "SINGLE_UNIT_UNPROVEN",
  "SINGLE_UNIT_STATED",
  "LIQ_UNKNOWN",
  "LIQ_PREFINANCING_UNFUNDED",
  "LIQ_PREFINANCING_EXCEEDS",
  "LIQ_CAPACITY_ZERO",
  "LIQ_PREFINANCING_REQUIRED",
  "LIQ_TERM_UNSECURED",
  "LIQ_CREDIT_UNKNOWN",
  "LIQ_REFUND_UNKNOWN",
  "AVAILABILITY_ZERO",
  "COMPLIANCE_DOCS_MISSING",
  "COMPLIANCE_RISK_UNKNOWN",
  "COMPLIANCE_HUMAN_REVIEW",
  "DRAFT_INCOMPLETE",
  "DRAFT_GPSR_MISSING",
  "DRAFT_BRAND_UNCONFIRMED",
  "DRAFT_GUARD_VIOLATION",
  "DRAFT_DUPLICATE_HANDLE",
  "DEMO_DATA",
  "TAX_UNCONFIRMED",
  "FUNDS_UNVERIFIED",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export type ReasonEffect = "defer" | "block" | "hint";

export const REASON_META: Record<ReasonCode, { label: string; effect: ReasonEffect }> = {
  MARKET_PROHIBITED: { label: "Warengruppe gesperrt", effect: "block" },
  MARKET_NO_DEMAND: { label: "Kein Nachfragesignal – einmal mit --live messen", effect: "defer" },
  MARKET_LOW_DEMAND: { label: "Nachfrage unter der Schwelle für eine Lieferantensuche", effect: "defer" },
  MARKET_SIGNAL_CACHED: { label: "Nachfrage aus zwischengespeichertem Signal (höhere Unsicherheit)", effect: "hint" },
  // Als Zurückstellungsgrund erst in Phase 2 (Frische und Unsicherheit)
  UNCERTAINTY_HIGH: { label: "Bewertung zu unsicher", effect: "hint" },
  CATALOG_INVALID: { label: "Katalogeintrag ungültig – wird nicht bewertet", effect: "defer" },
  CLOCK_OVERRIDDEN: { label: "Simulierte Uhr – nie bereit zur Prüfung", effect: "block" },
  IDENTITY_MISSING: { label: "Keine belastbare Produktidentität", effect: "defer" },
  IDENTITY_AMBIGUOUS: { label: "Zuordnung mehrdeutig (mehrere Artikel mit gleicher GTIN)", effect: "defer" },
  IDENTITY_CONFLICT: { label: "Widersprüchliche Produktidentität", effect: "defer" },
  IDENTITY_GTIN_AVAILABLE: { label: "Lieferant nennt GTIN – im Katalog nachtragen", effect: "defer" },
  IDENTITY_NO_OFFER: { label: "Kein Angebot zur Variante", effect: "defer" },
  IDENTITY_RESTRICTED_GTIN: { label: "GTIN aus eingeschränktem Nummernkreis – nicht global eindeutig", effect: "defer" },
  IDENTITY_TRADE_UNIT_GTIN: { label: "Umverpackungs-GTIN – Einzelstück-GTIN nachtragen (verdeckte Mindestabnahme)", effect: "defer" },
  SUPPLIER_NONE: { label: "Keine Lieferantenangebote", effect: "defer" },
  SUPPLIER_ALL_EXCLUDED: { label: "Alle Lieferantenangebote ausgeschlossen", effect: "defer" },
  SUPPLIER_VARIANTS_INCOMPLETE: { label: "Kein Lieferant deckt alle Varianten ab", effect: "defer" },
  OFFER_DUPLICATE_ASSIGNMENT: { label: "Dasselbe Lieferantenangebot ist mehreren Kandidaten zugeordnet", effect: "defer" },
  PRICE_MISSING: { label: "Kein belegter Verkaufspreis", effect: "defer" },
  MARGIN_LOW: { label: "Marge zu gering", effect: "defer" },
  MARGIN_BELOW_MIN: { label: "Deckungsbeitrag unter dem Mindestwert", effect: "defer" },
  MARGIN_STRESS_NEGATIVE: { label: "Deckungsbeitrag im Retouren-Stress nicht positiv", effect: "defer" },
  MARGIN_UNRELIABLE: { label: "Marge nicht verlässlich berechenbar", effect: "block" },
  SINGLE_UNIT_UNPROVEN: { label: "Einzelstückbezug nicht belegt (Mindestabnahme/Mindestbestellwert)", effect: "defer" },
  // Entscheidung 3 des Inhabers offen – Vorschlag: angegebene, unbestätigte Mindestabnahme nur protokollieren
  SINGLE_UNIT_STATED: { label: "Einzelstückbezug nur vom Lieferanten angegeben", effect: "hint" },
  LIQ_UNKNOWN: { label: "Liquidität nicht bewertbar", effect: "defer" },
  LIQ_PREFINANCING_UNFUNDED: { label: "Vorfinanzierung nötig – Mittel unbelegt", effect: "defer" },
  LIQ_PREFINANCING_EXCEEDS: { label: "Vorfinanzierung übersteigt die verfügbaren Mittel", effect: "defer" },
  LIQ_CAPACITY_ZERO: { label: "Keine offene Bestellung finanzierbar", effect: "defer" },
  // Ziel ist „keine Vorfinanzierung“: aus belegten Mitteln möglich, aber nie automatisierbar (ohne Kapazität zusätzlich
  // LIQ_CAPACITY_ZERO → zurückgestellt)
  LIQ_PREFINANCING_REQUIRED: { label: "Vorfinanzierung nötig – nie automatisierbar", effect: "block" },
  // Entscheidung 4 des Inhabers offen – Vorschlag: Prüfung durch Menschen möglich, nie automatisierbar
  LIQ_TERM_UNSECURED: { label: "Zahlungsziel deckt den Worst Case, aber Fristbeginn, Kreditrahmen oder Mittel unbelegt", effect: "block" },
  // Hinweis-Codes: Die Wirkung tragen die Status-Codes (LIQ_TERM_UNSECURED sperrt, Vorfinanzierung stellt zurück); ohne
  // belegten Kreditrahmen bzw. belegte Rücknahme sind Kapazität und Warenwert im Stress bereits im Worst Case gerechnet.
  LIQ_CREDIT_UNKNOWN: { label: "Kreditrahmen beim Lieferanten unbelegt", effect: "hint" },
  LIQ_REFUND_UNKNOWN: { label: "Rücknahme mit Gutschrift unbelegt – Warenwert bei Retouren als Verlust gerechnet", effect: "hint" },
  // In Phase 1 der Normalfall (Mittel für Wareneinkauf 0 €): Die Menge steht nur im Artefakt, Shopify erhält sie nie.
  AVAILABILITY_ZERO: { label: "Geplante verkaufbare Menge 0", effect: "hint" },
  COMPLIANCE_DOCS_MISSING: { label: "Pflichtunterlagen fehlen", effect: "defer" },
  COMPLIANCE_RISK_UNKNOWN: { label: "Risiko der Warengruppe unbekannt", effect: "defer" },
  COMPLIANCE_HUMAN_REVIEW: { label: "Compliance-Freigabe nur durch Menschen", effect: "block" },
  DRAFT_INCOMPLETE: { label: "Shopify-Entwurf unvollständig", effect: "defer" },
  DRAFT_GPSR_MISSING: { label: "GPSR-Angaben im Entwurf fehlen", effect: "defer" },
  DRAFT_BRAND_UNCONFIRMED: { label: "Marke nicht bestätigt", effect: "defer" },
  DRAFT_GUARD_VIOLATION: { label: "Entwurf verstößt gegen die Shopify-Guards", effect: "block" },
  DRAFT_DUPLICATE_HANDLE: { label: "Handle bereits von einem anderen Kandidaten belegt", effect: "defer" },
  DEMO_DATA: { label: "Demo-Daten – nie Grundlage für echte Entscheidungen", effect: "block" },
  TAX_UNCONFIRMED: { label: "Steuerstatus unbestätigt", effect: "block" },
  FUNDS_UNVERIFIED: { label: "Mittel ohne Kontonachweis", effect: "block" },
};

export interface Reason {
  code: ReasonCode;
  effect: ReasonEffect;
  /** Label des Codes, optional mit Detail (Details können Beträge enthalten – nur im Journal, nie geschwärzt gespeichert) */
  text: string;
}

export const isReasonCode = (v: unknown): v is ReasonCode => typeof v === "string" && (REASON_CODES as readonly string[]).includes(v);

export function reason(code: ReasonCode, detail?: string): Reason {
  const meta = REASON_META[code];
  return { code, effect: meta.effect, text: detail ? `${meta.label}: ${detail}` : meta.label };
}

/** Hat mindestens ein Code die Wirkung „zurückstellen“? */
export const hasDeferringCode = (codes: readonly ReasonCode[]) => codes.some((c) => REASON_META[c].effect === "defer");
