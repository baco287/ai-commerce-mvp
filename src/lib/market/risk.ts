// Produktsicherheits- und Retourenrisiko eines Kandidaten nach Themen-Stichworten.
// Das ist eine dokumentierte Regel, keine Messung: Sie sortiert grob vor und ersetzt nie die Compliance-Prüfung.

export type RiskLevel = "prohibited" | "high" | "medium" | "low" | "unknown";

export interface RiskAssessment {
  level: RiskLevel;
  /** Warum diese Einstufung – mit dem Stichwort, das gegriffen hat */
  reasons: string[];
}

interface Rule {
  level: Exclude<RiskLevel, "unknown">;
  pattern: RegExp;
  reason: string;
}

// Reihenfolge: strengste Regel zuerst. Treffer mehrerer Regeln → die strengste Stufe gilt, alle Gründe werden genannt.
const RULES: Rule[] = [
  {
    level: "prohibited",
    pattern: /waffe|messer|munition|armbrust|pfeil|bogen\b|pistole|gewehr|schleuder|arznei|medikament|medizin|nahrungsergänz|tabak|e-zigarette|feuerwerk|pyrotechn/i,
    reason: "Erlaubnis- oder genehmigungspflichtige bzw. gefährliche Warengruppe",
  },
  { level: "prohibited", pattern: /kinder|baby|spielzeug|schnuller/i, reason: "Kinderprodukt (Spielzeugrichtlinie, erhöhte Haftung)" },
  { level: "high", pattern: /akku|batterie|lithium|ladeger|netzteil|heiz|föhn|elektr|strom|\bled\b|leuchte|lampe|gerät/i, reason: "Elektrisch/Batterie: CE, ElektroG/WEEE, BattG, Brandrisiko" },
  { level: "high", pattern: /kosmetik|creme|parfum|haut/i, reason: "Kosmetik: EU-Kosmetikverordnung" },
  { level: "medium", pattern: /trink|flasche|becher|tasse|küche|koch|besteck|geschirr|dose/i, reason: "Lebensmittelkontakt: LFGB/EU 1935/2004" },
  { level: "medium", pattern: /magnet/i, reason: "Magnete: Verschluckungsgefahr, Warnhinweise" },
  { level: "medium", pattern: /textil|kleid|schuh|armband|uhr/i, reason: "Größen/Passform: erhöhte Retourenquote" },
  { level: "low", pattern: /halter|ständer|organizer|kabel|ordner|büro|werkzeug|bügel|haken|box/i, reason: "Einfacher Gebrauchsgegenstand: GPSR-Herstellerangaben" },
];

const ORDER: RiskLevel[] = ["prohibited", "high", "medium", "low", "unknown"];

/**
 * Einstufung nach dem Titel; greift dort keine Regel, nach der Kategorie (z. B. „Leuchte“).
 * Kein Treffer → „unbekannt“ (erhöht die Unsicherheit, gilt nie als gering).
 */
export function assessRisk(title: string, category = ""): RiskAssessment {
  let hits = RULES.filter((r) => r.pattern.test(title));
  let viaCategory = false;
  if (hits.length === 0 && category) {
    hits = RULES.filter((r) => r.pattern.test(category));
    viaCategory = hits.length > 0;
  }
  if (hits.length === 0) return { level: "unknown", reasons: ["Keine Risikoregel greift – Einstufung unbekannt, manuelle Prüfung nötig"] };
  const level = hits.map((h) => h.level).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0];
  return { level, reasons: [...new Set(hits.map((h) => (viaCategory ? `${h.reason} (nach Kategorie „${category}“)` : h.reason)))] };
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  prohibited: "gesperrt",
  high: "hoch",
  medium: "mittel",
  low: "gering",
  unknown: "unbekannt",
};
