// Aufbereitung des Supplier-Scout-Ergebnisses für die Lieferanten-Seite. Reine Funktionen.
//
// Grundsatz: Eine Empfehlung ist KEINE Einkaufsfreigabe. Diese Aufbereitung enthält bewusst keine
// Bestell- oder Freigabefunktion; sie macht nur sichtbar, was vor einer Freigabe noch fehlt.

import { calculateMargin } from "@/lib/calc/pricing";
import { SAFETY_SWITCHES } from "@/lib/config/budget";
import type { Product } from "@/lib/types";
import type { QuoteEvaluation, RecommendationKind, SupplierComparison } from "./compare";
import type { FinancingStatus } from "./financing";
import { openRequiredDocuments, requiredDocumentLabels } from "./documents";
import { shipsFromEu } from "./eligibility";
import { assessFunding, type FundingAssessment } from "./funding";
import { factLevel, factValue, type Fact, type FactLevel, type FactStatus, type ProductQuery } from "./model";
import { toPurchaseGuardTerms } from "./purchase-bridge";
import type { AdapterRun } from "./scout";

export type FlagKind = "demo" | "missing_evidence" | "uncertain_financing" | "delivery_unconfirmed" | "dropshipping_unconfirmed";

export interface Flag {
  kind: FlagKind;
  label: string;
  /** Einzelheiten, z. B. welche Nachweise fehlen */
  details: string[];
}

export interface FactCell<T> {
  value: T | undefined;
  status: FactStatus;
  /** geprüft (Nachweis) · vom Lieferanten angegeben · unbestätigt · fehlt */
  level: FactLevel;
}

/** Herkunft eines Angebots für die Kennzeichnung. */
export type SourceStatus = "demo" | "real_unverified" | "real_verified";
export const SOURCE_LABELS: Record<SourceStatus, string> = {
  demo: "DEMO",
  real_unverified: "ECHTE QUELLE, UNGEPRÜFT",
  real_verified: "NACHWEISE GEPRÜFT",
};

export interface OfferView {
  quoteId: string;
  supplierName: string;
  demo: boolean;
  eligible: boolean;
  /** DEMO · ECHTE QUELLE, UNGEPRÜFT · NACHWEISE GEPRÜFT (zusätzlich „AUSGESCHLOSSEN“, wenn nicht geeignet) */
  source: SourceStatus;
  /** Herkunft, z. B. „Preisliste X: datei.csv, Zeile 4, Stand 2026-10-30“ */
  provenanceText: string | null;
  shipsFrom: string | undefined;
  unitPrice: FactCell<number>;
  shippingCost: FactCell<number>;
  /** Bei Versand aus der EU gelten fehlende Importkosten als 0 € (Status bleibt sichtbar) */
  importCost: FactCell<number>;
  /** Einkauf + Versand + Import je Stück; null = unvollständig */
  perUnit: number | null;
  deliveryDays: FactCell<{ min: number; max: number }>;
  stock: FactCell<number>;
  financing: { status: FinancingStatus; label: string; requiresPrefinancing: boolean };
  /** Beträge, Fälligkeit und Mittel für eine Kundenbestellung */
  funding: FundingAssessment;
  /** Zahlungsbedingung, wie sie die Einkaufssperre annehmen dürfte (Demo/ausgeschlossen = Vorkasse) */
  purchaseGuardTerms: ReturnType<typeof toPurchaseGuardTerms>;
  /** Deckungsbeitrag und Marge nach der bestehenden Kalkulation (calc/pricing.ts); null ohne Kosten */
  margin: { contribution: number; marginPercent: number } | null;
  score: number | null;
  /** Wichtige Angaben nach Status */
  facts: { verified: string[]; supplierStated: string[]; unconfirmed: string[]; missing: string[] };
  /** Pflichtunterlagen des Produkts, die dieses Angebot nicht belegt */
  openDocuments: string[];
  documents: string[];
  flags: Flag[];
  exclusions: string[];
  warnings: string[];
}

/** Eine Empfehlungskarte. Fallen mehrere Empfehlungen auf dasselbe Angebot, werden sie zusammengefasst. */
export interface RecommendationView {
  /** In fester Reihenfolge: günstigster, schnellster, bester */
  kinds: RecommendationKind[];
  /** z. B. „Schnellster & insgesamt bester geeigneter“ */
  title: string;
  offer: OfferView;
  /** Begründungen aller zusammengefassten Empfehlungen, ohne Wiederholungen */
  reasons: string[];
}

export interface ProductSupplierView {
  productId: string;
  productName: string;
  priceGross: number;
  /** Produktbezogene Compliance-Punkte aus der Produktanalyse */
  complianceNotes: string[];
  requiredDocuments: string[];
  recommendations: RecommendationView[];
  eligible: OfferView[];
  excluded: OfferView[];
  /** Kalkulationsbasis für Marge und Shopify „Kosten pro Artikel“: günstigster geeigneter Lieferant */
  calculationBasisId: string | null;
  /** Kein geeignetes Angebot → Produkt derzeit nicht lieferbar */
  noSupplier: boolean;
  /**
   * Vor einer Freigabe des insgesamt besten Angebots zu klären (ohne Demo-Hinweis): Warn-Kennzeichen und
   * offene Punkte der Eignungsprüfung, ohne Doppelungen. Produkt-Compliance steht in `complianceNotes`.
   */
  bestOpenPoints: string[];
  notes: string[];
  adapters: AdapterRun[];
  containsDemoData: boolean;
  /** Immer false: Eine Empfehlung gibt nie einen Einkauf frei */
  purchaseApproved: false;
  /** Stand der globalen Einkaufssperre (nur gelesen) */
  autoPurchaseEnabled: boolean;
}

export const RECOMMENDATION_TITLES: Record<RecommendationKind, string> = {
  cheapest: "Günstigster geeigneter",
  fastest: "Schnellster geeigneter",
  best: "Insgesamt bester",
};

const SHORT_TITLES: Record<RecommendationKind, string> = { cheapest: "Günstigster", fastest: "Schnellster", best: "insgesamt bester" };

/** „Günstigster geeigneter“ bzw. bei Zusammenfassung „Schnellster & insgesamt bester geeigneter“. */
export function recommendationTitle(kinds: RecommendationKind[]): string {
  if (kinds.length === 1) return RECOMMENDATION_TITLES[kinds[0]];
  const words = kinds.map((k, i) => (i === 0 ? SHORT_TITLES[k] : SHORT_TITLES[k].toLowerCase()));
  return `${words.slice(0, -1).join(", ")} & ${words[words.length - 1]} geeigneter`;
}

const cell = <T>(f: Fact<T>): FactCell<T> => ({ value: factValue(f), status: f.status, level: factLevel(f) });

function factLists(e: QuoteEvaluation) {
  const q = e.quote;
  const entries: [string, Fact<unknown>][] = [
    ["Produktidentität", q.identity.match],
    ["GTIN", q.identity.gtin],
    ["Einkaufspreis", q.pricing.unitPrice],
    ["Versandkosten", q.pricing.shippingCost],
    ["Importkosten", q.pricing.importCost],
    ["Mindestabnahme", q.pricing.minOrderQuantity],
    ["Mindestbestellwert", q.pricing.minOrderValue],
    ["Lieferung nach DE", q.fulfillment.deliversToDestination],
    ["Lieferzeit", q.fulfillment.deliveryDays],
    ["Lieferantenbestand", q.fulfillment.stock],
    ["Sendungsverfolgung", q.fulfillment.tracking],
    ["CE-Kennzeichnung", q.safety.ceMarking],
    ["Verantwortliche Person EU (GPSR)", q.safety.euResponsiblePerson],
    ["Sicherheitshinweise DE", q.safety.safetyInformationDe],
    ["Direktversand (Dropshipping)", q.dropshipping.supported],
    ["Neutraler Versand", q.dropshipping.blindShipping],
    ["Bestellweg", q.dropshipping.orderChannel],
    ["Zahlungsbedingungen", q.payment.terms],
    ["Bewertung", q.reliability.rating],
    ["Pünktlichkeit", q.reliability.onTimeRate],
    ["Reklamationsquote", q.reliability.defectRate],
    ["Geprüftes Muster", q.reliability.sampleTested],
  ];
  const pick = (l: FactLevel) => entries.filter(([, f]) => factLevel(f) === l).map(([label]) => label);
  return { verified: pick("verified"), supplierStated: pick("supplier_stated"), unconfirmed: pick("unconfirmed"), missing: pick("missing") };
}

const notConfirmed = (f: Fact<boolean>) => !(f.status === "confirmed" && f.value === true);

function flagsFor(e: QuoteEvaluation, openDocuments: string[], funding: FundingAssessment): Flag[] {
  const q = e.quote;
  const flags: Flag[] = [];
  if (q.demo) {
    const synthetic = q.provenance?.synthetic;
    flags.push({ kind: "demo", label: synthetic ? "Testdaten" : "Demo-Daten", details: [synthetic ? "Synthetische Testdaten – keine echte Einkaufsgrundlage." : "Fiktiver Lieferant – keine echte Einkaufsgrundlage."] });
  }

  const evidence = [
    ...openDocuments.map((d) => `${d} fehlt`),
    ...(notConfirmed(q.reliability.sampleTested) ? ["Kein geprüftes Muster"] : []),
    ...(notConfirmed(q.safety.ceMarking) ? ["CE-Kennzeichnung nicht belegt"] : []),
    ...(q.safety.euResponsiblePerson.status !== "confirmed" ? ["Verantwortliche Person EU nicht belegt"] : []),
    ...(notConfirmed(q.safety.safetyInformationDe) ? ["Deutsche Sicherheitshinweise nicht belegt"] : []),
  ];
  if (evidence.length) flags.push({ kind: "missing_evidence", label: "Produktnachweise fehlen", details: evidence });

  if (e.financing.requiresPrefinancing || funding.status !== "no_prefinancing") {
    flags.push({ kind: "uncertain_financing", label: "Finanzierung nicht gesichert", details: [e.financing.label, funding.label] });
  }

  const delivery = [
    ...(q.fulfillment.deliversToDestination.status !== "confirmed" ? ["Lieferung nach DE nicht bestätigt"] : []),
    ...(q.fulfillment.stock.status !== "confirmed" ? ["Lieferantenbestand nicht bestätigt"] : []),
    ...(q.fulfillment.deliveryDays.status !== "confirmed" ? ["Lieferzeit nicht bestätigt"] : []),
    ...(notConfirmed(q.fulfillment.tracking) ? ["Sendungsverfolgung nicht bestätigt"] : []),
    ...e.eligibility.exclusions.filter((x) => ["not_deliverable", "insufficient_stock"].includes(x.code)).map((x) => x.message),
  ];
  if (delivery.length) flags.push({ kind: "delivery_unconfirmed", label: "Lieferfähigkeit nicht gesichert", details: delivery });

  const dropshipping = [
    ...(notConfirmed(q.dropshipping.supported) ? ["Direktversand an Kunden nicht bestätigt"] : []),
    ...(notConfirmed(q.dropshipping.blindShipping) ? ["Neutraler Versand nicht bestätigt"] : []),
    ...(q.dropshipping.orderChannel.status !== "confirmed" ? ["Bestellweg nicht bestätigt"] : []),
  ];
  if (dropshipping.length) {
    flags.push({ kind: "dropshipping_unconfirmed", label: "Dropshipping nicht vollständig bestätigt", details: dropshipping });
  }
  return flags;
}

/** Kritische Angaben, die für „NACHWEISE GEPRÜFT“ alle unabhängig geprüft sein müssen. */
function criticalFacts(e: QuoteEvaluation, query: ProductQuery): Fact<unknown>[] {
  const q = e.quote;
  return [
    q.identity.match,
    ...(query.safety.ceRequired ? [q.safety.ceMarking] : []),
    q.safety.euResponsiblePerson,
    q.safety.safetyInformationDe,
    q.dropshipping.supported,
    q.pricing.unitPrice,
    q.pricing.shippingCost,
    q.fulfillment.shipsFrom,
    ...(shipsFromEu(q) ? [] : [q.pricing.importCost]),
    q.fulfillment.deliversToDestination,
    q.fulfillment.deliveryDays,
    q.fulfillment.stock,
    q.payment.terms,
  ];
}

function sourceOf(e: QuoteEvaluation, query: ProductQuery, openDocuments: string[]): SourceStatus {
  if (e.quote.demo) return "demo";
  const allVerified = criticalFacts(e, query).every((f) => f.status === "confirmed") && openDocuments.length === 0;
  return allVerified ? "real_verified" : "real_unverified";
}

function provenanceText(e: QuoteEvaluation): string | null {
  const p = e.quote.provenance;
  if (!p || p.kind !== "price_list") return null;
  return [`Preisliste ${p.file ?? "?"}, Zeile ${p.row ?? "?"}`, p.supplierUpdatedAt && `Stand ${p.supplierUpdatedAt}`, p.importedAt && `importiert ${p.importedAt.slice(0, 10)}`, p.dataSource && `Quelle: ${p.dataSource}`]
    .filter(Boolean)
    .join(" · ");
}

export function toOfferView(e: QuoteEvaluation, query: ProductQuery, priceGross: number): OfferView {
  const q = e.quote;
  const funding = assessFunding({ quote: q, financing: e.financing, cost: e.cost });
  const documents = q.safety.documents;
  // Abgleich ausschließlich über Dokumenttypen (documents.ts) – Freitext erfüllt nie eine Pflicht.
  const openDocuments = openRequiredDocuments(q, query);
  const margin = e.cost ? calculateMargin(priceGross, e.cost.perUnit) : null;
  const importCost = cell(q.pricing.importCost);
  return {
    quoteId: q.id,
    supplierName: q.supplierName,
    demo: q.demo,
    eligible: e.eligibility.eligible && e.score !== null,
    source: sourceOf(e, query, openDocuments),
    provenanceText: provenanceText(e),
    shipsFrom: factValue(q.fulfillment.shipsFrom),
    unitPrice: cell(q.pricing.unitPrice),
    shippingCost: cell(q.pricing.shippingCost),
    importCost: importCost.value === undefined && e.cost ? { ...importCost, value: e.cost.importCost } : importCost,
    perUnit: e.cost?.perUnit ?? null,
    deliveryDays: cell(q.fulfillment.deliveryDays),
    stock: cell(q.fulfillment.stock),
    financing: { status: e.financing.status, label: e.financing.label, requiresPrefinancing: e.financing.requiresPrefinancing },
    funding,
    purchaseGuardTerms: toPurchaseGuardTerms(e),
    margin: margin ? { contribution: margin.contribution, marginPercent: margin.marginPercent } : null,
    score: e.score?.total ?? null,
    facts: factLists(e),
    openDocuments,
    documents,
    flags: flagsFor(e, openDocuments, funding),
    exclusions: e.eligibility.exclusions.map((x) => x.message),
    // Nachweise, die der aktuellen Preisliste widersprechen, werden nicht angewendet – aber offen angezeigt.
    warnings: [...e.eligibility.warnings.map((w) => w.message), ...(q.provenance?.evidenceConflicts ?? [])],
  };
}

/** Offene Punkte eines Angebots ohne Demo-Hinweis und ohne Doppelungen (Kennzeichen + Eignungs-Hinweise). */
function openPointsOf(offer: OfferView | undefined): string[] {
  if (!offer) return [];
  const points = [...offer.flags.filter((f) => f.kind !== "demo").flatMap((f) => f.details), ...offer.warnings];
  const normalized = (p: string) => p.replace(/\.$/, "").toLowerCase();
  const seen = new Set<string>();
  return points.filter((p) => {
    const key = normalized(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildSupplierView(
  product: Product,
  comparison: SupplierComparison,
  extra: { adapters?: AdapterRun[]; containsDemoData?: boolean } = {},
): ProductSupplierView {
  const query = comparison.query;
  const view = (e: QuoteEvaluation) => toOfferView(e, query, product.targetPriceGross);
  const eligible = comparison.eligible.map(view);
  const excluded = comparison.excluded.map(view);
  const byId = new Map(eligible.map((o) => [o.quoteId, o]));

  // Je Angebot eine Karte; die Reihenfolge folgt der ersten Empfehlung (günstigster, schnellster, bester).
  const order: RecommendationKind[] = ["cheapest", "fastest", "best"];
  const groups = new Map<string, RecommendationView>();
  for (const kind of order) {
    const r = comparison.recommendations[kind];
    const offer = r && byId.get(r.quoteId);
    if (!r || !offer) continue;
    const group = groups.get(r.quoteId) ?? { kinds: [], title: "", offer, reasons: [] };
    group.kinds.push(kind);
    for (const reason of r.reasons) if (!group.reasons.includes(reason)) group.reasons.push(reason);
    groups.set(r.quoteId, group);
  }
  const recommendations = [...groups.values()].map((g) => ({ ...g, title: recommendationTitle(g.kinds) }));

  return {
    productId: product.id,
    productName: product.name,
    priceGross: product.targetPriceGross,
    complianceNotes: product.complianceNotes,
    requiredDocuments: requiredDocumentLabels(query),
    recommendations,
    eligible,
    excluded,
    calculationBasisId: comparison.recommendations.cheapest?.quoteId ?? null,
    noSupplier: eligible.length === 0,
    bestOpenPoints: openPointsOf(recommendations.find((r) => r.kinds.includes("best"))?.offer),
    notes: comparison.notes,
    adapters: extra.adapters ?? [],
    containsDemoData: extra.containsDemoData ?? [...comparison.eligible, ...comparison.excluded].some((e) => e.quote.demo),
    purchaseApproved: false,
    autoPurchaseEnabled: SAFETY_SWITCHES.autoPurchaseEnabled,
  };
}
