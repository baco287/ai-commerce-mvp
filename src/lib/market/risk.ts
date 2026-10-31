// Produktsicherheits- und Retourenrisiko eines Kandidaten nach Themen-Stichworten.
// Das ist eine dokumentierte Regel, keine Messung: Sie sortiert grob vor und ersetzt nie die Compliance-Prüfung.
//
// Jede Regel nennt die Pflichtunterlagen als feste Dokumenttypen (`documents`), die die Compliance-Stufe verlangt
// (compliance.ts). VORLÄUFIG: Der Dokumenttyp-Katalog je Warengruppe ist fachlich bzw. rechtlich abzunehmen –
// Konfiguration, Entscheidung des Inhabers offen (Entscheidung 2).

import { sortDocTypes, type DocType } from "@/lib/suppliers";

export type RiskLevel = "prohibited" | "high" | "medium" | "low" | "unknown";

export interface RiskAssessment {
  level: RiskLevel;
  /** Warum diese Einstufung – mit dem Stichwort, das gegriffen hat */
  reasons: string[];
  /**
   * Pflicht-Dokumenttypen nach den Regeln, die gegriffen haben (sortiert, ohne Dubletten), immer inkl. GPSR.
   * VORLÄUFIG (Entscheidung 2 des Inhabers offen). Fehlt in älteren gespeicherten Ständen.
   */
  documents?: DocType[];
}

interface Rule {
  level: Exclude<RiskLevel, "unknown">;
  pattern: RegExp;
  reason: string;
  /** Pflicht-Dokumenttypen dieser Warengruppe (vorläufig, Entscheidung 2) */
  documents: DocType[];
}

// Reihenfolge: strengste Regel zuerst. Treffer mehrerer Regeln → die strengste Stufe gilt, alle Gründe werden genannt.
const RULES: Rule[] = [
  {
    level: "prohibited",
    pattern: /waffe|messer|munition|armbrust|pfeil|bogen\b|pistole|gewehr|schleuder|arznei|medikament|medizin|nahrungsergänz|tabak|e-zigarette|feuerwerk|pyrotechn/i,
    reason: "Erlaubnis- oder genehmigungspflichtige bzw. gefährliche Warengruppe",
    documents: [],
  },
  { level: "prohibited", pattern: /kinder|baby|spielzeug|schnuller/i, reason: "Kinderprodukt (Spielzeugrichtlinie, erhöhte Haftung)", documents: [] },
  {
    level: "high",
    pattern: /akku|batterie|lithium|ladeger|netzteil|heiz|föhn|elektr|strom|\bled\b|leuchte|lampe|gerät/i,
    reason: "Elektrisch/Batterie: CE, ElektroG/WEEE, BattG, Brandrisiko",
    documents: ["eu_doc", "weee"],
  },
  { level: "high", pattern: /kosmetik|creme|parfum|haut/i, reason: "Kosmetik: EU-Kosmetikverordnung", documents: ["cpnp", "safety_assessment"] },
  { level: "medium", pattern: /trink|flasche|becher|tasse|küche|koch|besteck|geschirr|dose/i, reason: "Lebensmittelkontakt: LFGB/EU 1935/2004", documents: ["food_contact"] },
  { level: "medium", pattern: /magnet/i, reason: "Magnete: Verschluckungsgefahr, Warnhinweise", documents: ["magnet_warning"] },
  { level: "medium", pattern: /textil|kleid|schuh|armband|uhr/i, reason: "Größen/Passform: erhöhte Retourenquote", documents: [] },
  { level: "low", pattern: /halter|ständer|organizer|kabel|ordner|büro|werkzeug|bügel|haken|box/i, reason: "Einfacher Gebrauchsgegenstand: GPSR-Herstellerangaben", documents: [] },
];

/** Gilt für jedes Produkt: Herstellerangaben nach GPSR (vorläufig, Entscheidung 2). */
export const ALWAYS_REQUIRED_DOCUMENTS: readonly DocType[] = ["gpsr"];

/** Zusätze für elektrische Produkte (nur wenn die Elektro-Regel greift): Funk → RED, Batterie → BattG. */
const ELECTRIC_ADDENDA: { pattern: RegExp; documents: DocType[] }[] = [
  { pattern: /funk|bluetooth|wlan|wi-?fi|zigbee|\bapp\b/i, documents: ["red_doc"] },
  { pattern: /akku|batterie|lithium|knopfzelle/i, documents: ["battg"] },
];

function documentsFor(hits: Rule[], text: string): DocType[] {
  const docs = new Set<DocType>([...ALWAYS_REQUIRED_DOCUMENTS, ...hits.flatMap((h) => h.documents)]);
  if (hits.some((h) => h.documents.includes("weee"))) {
    for (const a of ELECTRIC_ADDENDA) if (a.pattern.test(text)) a.documents.forEach((d) => docs.add(d));
  }
  return sortDocTypes([...docs]);
}

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
  if (hits.length === 0) {
    return { level: "unknown", reasons: ["Keine Risikoregel greift – Einstufung unbekannt, manuelle Prüfung nötig"], documents: [...ALWAYS_REQUIRED_DOCUMENTS] };
  }
  const level = hits.map((h) => h.level).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0];
  return {
    level,
    reasons: [...new Set(hits.map((h) => (viaCategory ? `${h.reason} (nach Kategorie „${category}“)` : h.reason)))],
    documents: documentsFor(hits, `${title} ${category}`),
  };
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  prohibited: "gesperrt",
  high: "hoch",
  medium: "mittel",
  low: "gering",
  unknown: "unbekannt",
};
