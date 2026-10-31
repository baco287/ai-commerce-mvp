// Unabhängige Nachweise für importierte Angebote (lokale Datei .data/suppliers/evidence.json, nicht in Git).
//
// Nur ein Nachweis macht eine Angabe „geprüft“ (confirmed) – nie die Preisliste selbst. Jeder Nachweis nennt
// das Dokument, wer geprüft hat und wann. Er gilt für genau ein Angebot UND genau ein Produkt (GTIN):
// CE-, GPSR- oder Sicherheitsnachweise sind produktspezifisch und werden für andere Produkte ignoriert.

import {
  confirmed,
  type DropshippingSupport,
  type Fact,
  type Fulfillment,
  type IdentityMatch,
  type OrderChannel,
  type SupplierPaymentTerms,
  type SupplierQuote,
} from "../model";
import { stableJson } from "./plan";

export const EVIDENCE_FIELDS = [
  "identity.match",
  "identity.gtin",
  "safety.ceMarking",
  "safety.euResponsiblePerson",
  "safety.safetyInformationDe",
  "safety.document",
  "pricing.unitPrice",
  "pricing.shippingCost",
  "pricing.minOrderValue",
  "pricing.importCost",
  "fulfillment.shipsFrom",
  "fulfillment.deliversToDestination",
  "fulfillment.deliveryDays",
  "fulfillment.stock",
  "fulfillment.tracking",
  "dropshipping.supported",
  "dropshipping.blindShipping",
  "dropshipping.orderChannel",
  "payment.terms",
  "payment.requiresBusinessVerification",
  "reliability.sampleTested",
] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

export interface EvidenceEntry {
  /** Angebot, für das der Nachweis gilt (`supplierId::supplierSku`) */
  offerKey: string;
  /** Produkt (GTIN), für das der Nachweis gilt */
  productGtin: string;
  field: EvidenceField;
  value: unknown;
  /** Bezeichnung des Nachweises, z. B. „Konformitätserklärung Nr. 123 vom 01.10.2026“ */
  document: string;
  checkedBy: string;
  /** YYYY-MM-DD */
  checkedAt: string;
  note?: string;
}

const isBool = (v: unknown) => typeof v === "boolean";
const isNonNegNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isText = (v: unknown) => typeof v === "string" && v.trim().length > 0 && v.length <= 300;
const isDays = (v: unknown) =>
  !!v && typeof v === "object" && Number.isInteger((v as { min: number }).min) && Number.isInteger((v as { max: number }).max) && (v as { min: number }).min >= 0 && (v as { min: number }).min <= (v as { max: number }).max;
const isTerms = (v: unknown) =>
  !!v &&
  typeof v === "object" &&
  ((v as SupplierPaymentTerms).kind === "prepayment" ||
    ((v as SupplierPaymentTerms).kind === "net_terms" && Number.isInteger((v as { days: number }).days) && (v as { days: number }).days >= 0));

const VALUE_CHECKS: Record<EvidenceField, (v: unknown) => boolean> = {
  "identity.match": (v) => v === "exact" || v === "variant" || v === "different",
  "identity.gtin": (v) => typeof v === "string" && /^\d{8,14}$/.test(v),
  "safety.ceMarking": isBool,
  "safety.euResponsiblePerson": isText,
  "safety.safetyInformationDe": isBool,
  "safety.document": isText,
  "pricing.unitPrice": (v) => isNonNegNumber(v) && (v as number) > 0,
  "pricing.shippingCost": isNonNegNumber,
  "pricing.minOrderValue": isNonNegNumber,
  "fulfillment.deliversToDestination": isBool,
  "fulfillment.deliveryDays": isDays,
  "fulfillment.stock": (v) => Number.isInteger(v) && (v as number) >= 0,
  "fulfillment.tracking": isBool,
  "dropshipping.supported": isBool,
  "dropshipping.blindShipping": isBool,
  "dropshipping.orderChannel": (v) => v === "api" || v === "portal" || v === "email",
  "payment.terms": isTerms,
  "payment.requiresBusinessVerification": isBool,
  "reliability.sampleTested": isBool,
  "pricing.importCost": isNonNegNumber,
  "fulfillment.shipsFrom": (v) => typeof v === "string" && /^[A-Z]{2}$/.test(v),
};

/** Prüfdatum: echtes Kalenderdatum (kein 31.02.) und nicht in der Zukunft (1 Tag Toleranz für Zeitzonen). */
function isValidCheckDate(value: unknown, today: Date): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return date.getTime() <= today.getTime() + 24 * 60 * 60 * 1000;
}

/** Prüft den Inhalt der Nachweisdatei; ungültige Einträge werden mit Grund verworfen. */
export function validateEvidence(raw: unknown, today: Date = new Date()): { entries: EvidenceEntry[]; errors: string[] } {
  const errors: string[] = [];
  const list = Array.isArray(raw) ? raw : (raw as { entries?: unknown })?.entries;
  if (!Array.isArray(list)) return { entries: [], errors: raw === undefined ? [] : ["Nachweisdatei: erwartet eine Liste „entries“."] };
  const entries: EvidenceEntry[] = [];
  list.forEach((e: Partial<EvidenceEntry>, i) => {
    const where = `Nachweis ${i + 1}`;
    const problems: string[] = [];
    if (!isText(e?.offerKey) || !String(e.offerKey).includes("::")) problems.push("offerKey fehlt oder ungültig");
    if (typeof e?.productGtin !== "string" || !/^\d{8,14}$/.test(e.productGtin)) problems.push("productGtin fehlt oder ungültig");
    if (!EVIDENCE_FIELDS.includes(e?.field as EvidenceField)) problems.push(`Feld „${String(e?.field)}“ ist nicht nachweisbar`);
    else if (!VALUE_CHECKS[e.field as EvidenceField](e.value)) problems.push(`Wert passt nicht zu ${e.field}`);
    if (!isText(e?.document)) problems.push("document (Bezeichnung des Nachweises) fehlt");
    if (!isText(e?.checkedBy)) problems.push("checkedBy fehlt");
    if (!isValidCheckDate(e?.checkedAt, today)) problems.push("checkedAt fehlt, ist kein gültiges Datum (YYYY-MM-DD) oder liegt in der Zukunft");
    if (problems.length) errors.push(`${where}: ${problems.join("; ")}.`);
    else entries.push(e as EvidenceEntry);
  });
  return { entries, errors };
}

const EVIDENCE_LABELS: Partial<Record<EvidenceField, string>> = {
  "identity.gtin": "GTIN",
  "pricing.unitPrice": "Einkaufspreis",
  "pricing.shippingCost": "Versandkosten",
  "pricing.minOrderValue": "Mindestbestellwert",
  "pricing.importCost": "Importkosten",
  "fulfillment.shipsFrom": "Versandland",
  "fulfillment.deliversToDestination": "Lieferung nach DE",
  "fulfillment.deliveryDays": "Lieferzeit",
  "fulfillment.stock": "Lieferantenbestand",
  "dropshipping.supported": "Direktversand",
  "dropshipping.blindShipping": "Neutraler Versand",
  "payment.terms": "Zahlungsbedingungen",
  "identity.match": "Produktidentität",
  "safety.ceMarking": "CE-Kennzeichnung",
  "safety.euResponsiblePerson": "Verantwortliche Person EU",
  "safety.safetyInformationDe": "Sicherheitshinweise DE",
  "reliability.sampleTested": "Geprüftes Muster",
};

/** Nachweise, die an den geprüften Artikel gebunden sind: Ändert der Lieferant ihn, verlieren sie ihre Gültigkeit. */
const ARTICLE_BOUND = (field: EvidenceField) => field.startsWith("identity.") || field.startsWith("safety.") || field === "reliability.sampleTested";

/** Angabe der Preisliste, mit der ein Nachweis übereinstimmen muss (nur Felder, die eine Preisliste liefert). */
function statedFact(q: SupplierQuote, field: EvidenceField): Fact<unknown> | undefined {
  switch (field) {
    case "identity.gtin":
      return q.identity.gtin;
    case "pricing.unitPrice":
      return q.pricing.unitPrice;
    case "pricing.shippingCost":
      return q.pricing.shippingCost;
    case "pricing.minOrderValue":
      return q.pricing.minOrderValue;
    case "fulfillment.shipsFrom":
      return q.fulfillment.shipsFrom;
    case "fulfillment.deliversToDestination":
      return q.fulfillment.deliversToDestination;
    case "fulfillment.deliveryDays":
      return q.fulfillment.deliveryDays;
    case "fulfillment.stock":
      return q.fulfillment.stock;
    case "dropshipping.supported":
      return q.dropshipping.supported;
    case "dropshipping.blindShipping":
      return q.dropshipping.blindShipping;
    case "payment.terms":
      return q.payment.terms;
    default:
      return undefined;
  }
}

/**
 * Wendet die Nachweise auf ein importiertes Angebot an. Nur Nachweise für genau dieses Angebot und genau
 * dieses Produkt (GTIN) zählen; alles andere bleibt unverändert.
 *
 * Nicht angewendet (Angabe bleibt „vom Lieferanten angegeben“ bzw. „fehlt“, der Grund wird gemeldet) wird ein Nachweis,
 * - der der aktuellen Preisliste widerspricht (z. B. Preis, Bestand, Zahlungsbedingung seit der Prüfung geändert),
 * - der einem anderen Nachweis zum selben Feld widerspricht (keiner der beiden gilt),
 * - der Identität, Sicherheit oder Muster betrifft und älter ist als die letzte Änderung des Artikels laut Preisliste
 *   (Bezeichnung, Marke, Herstellernummer oder GTIN) – geprüft wurde dann womöglich ein anderer Artikel.
 * Ein alter Nachweis kann so nie eine neuere Lieferantenangabe überdecken.
 */
export function applyEvidence(
  quote: SupplierQuote,
  offerKey: string,
  productGtin: string | undefined,
  entries: EvidenceEntry[],
  options: { articleChangedAt?: string } = {},
): SupplierQuote {
  const relevant = entries.filter((e) => e.offerKey === offerKey && productGtin !== undefined && e.productGtin === productGtin);
  if (!relevant.length) return quote;
  const q: SupplierQuote = structuredClone(quote);
  const conflicts: string[] = [];
  const label = (field: EvidenceField) => EVIDENCE_LABELS[field] ?? field;

  // Widersprüchliche Nachweise zum selben Feld heben sich auf (Unterlagen werden gesammelt, nicht verglichen).
  const valuesByField = new Map<EvidenceField, Set<string>>();
  for (const e of relevant) {
    if (e.field === "safety.document") continue;
    valuesByField.set(e.field, (valuesByField.get(e.field) ?? new Set()).add(stableJson(e.value)));
  }
  const contradictory = new Set([...valuesByField].filter(([, values]) => values.size > 1).map(([field]) => field));
  for (const field of contradictory) conflicts.push(`Nachweise zu ${label(field)} widersprechen sich – keiner angewendet, bitte klären.`);
  // Prüfdaten sind Kalendertage (Berlin). Ein Nachweis vom Tag der Änderung ist nicht eindeutig „danach“ – er gilt nicht.
  const changedOn = options.articleChangedAt
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(options.articleChangedAt))
    : undefined;

  for (const e of relevant) {
    if (contradictory.has(e.field)) continue;
    if (changedOn && ARTICLE_BOUND(e.field) && e.checkedAt <= changedOn) {
      conflicts.push(`Nachweis „${e.document}“ (${e.checkedAt}) zu ${label(e.field)} wurde nicht nach der Artikeländerung vom ${changedOn} geprüft – nicht angewendet, bitte neu prüfen.`);
      continue;
    }
    const stated = statedFact(quote, e.field);
    if (stated && stated.status !== "missing" && stableJson(stated.value) !== stableJson(e.value)) {
      conflicts.push(
        `Nachweis „${e.document}“ (${e.checkedAt}) zu ${label(e.field)} widerspricht der aktuellen Preisliste – nicht angewendet, bitte neu prüfen.`,
      );
      continue;
    }
    const fact = <T>(value: T): Fact<T> => confirmed(value, `Nachweis: ${e.document} (geprüft von ${e.checkedBy})`, e.checkedAt);
    switch (e.field) {
      case "identity.match":
        q.identity.match = fact(e.value as IdentityMatch);
        break;
      case "identity.gtin":
        q.identity.gtin = fact(e.value as string);
        break;
      case "safety.ceMarking":
        q.safety.ceMarking = fact(e.value as boolean);
        break;
      case "safety.euResponsiblePerson":
        q.safety.euResponsiblePerson = fact(e.value as string);
        break;
      case "safety.safetyInformationDe":
        q.safety.safetyInformationDe = fact(e.value as boolean);
        break;
      case "safety.document":
        q.safety.documents = [...q.safety.documents, `${e.value as string} (geprüft ${e.checkedAt})`];
        break;
      case "pricing.unitPrice":
        q.pricing.unitPrice = fact(e.value as number);
        break;
      case "pricing.shippingCost":
        q.pricing.shippingCost = fact(e.value as number);
        break;
      case "pricing.minOrderValue":
        q.pricing.minOrderValue = fact(e.value as number);
        break;
      case "pricing.importCost":
        q.pricing.importCost = fact(e.value as number);
        break;
      case "fulfillment.shipsFrom":
        q.fulfillment.shipsFrom = fact(e.value as string);
        break;
      case "fulfillment.deliversToDestination":
        q.fulfillment.deliversToDestination = fact(e.value as boolean);
        break;
      case "fulfillment.deliveryDays":
        q.fulfillment.deliveryDays = fact(e.value as Fulfillment["deliveryDays"] extends Fact<infer T> ? T : never);
        break;
      case "fulfillment.stock":
        q.fulfillment.stock = fact(e.value as number);
        break;
      case "fulfillment.tracking":
        q.fulfillment.tracking = fact(e.value as boolean);
        break;
      case "dropshipping.supported":
        q.dropshipping.supported = fact(e.value as boolean);
        break;
      case "dropshipping.blindShipping":
        q.dropshipping.blindShipping = fact(e.value as boolean);
        break;
      case "dropshipping.orderChannel":
        q.dropshipping.orderChannel = fact(e.value as OrderChannel) as DropshippingSupport["orderChannel"];
        break;
      case "payment.terms":
        q.payment.terms = fact(e.value as SupplierPaymentTerms);
        break;
      case "payment.requiresBusinessVerification":
        q.payment.requiresBusinessVerification = fact(e.value as boolean);
        break;
      case "reliability.sampleTested":
        q.reliability.sampleTested = fact(e.value as boolean);
        break;
    }
  }
  if (conflicts.length) q.provenance = { kind: "price_list", ...q.provenance, evidenceConflicts: conflicts };
  return q;
}
