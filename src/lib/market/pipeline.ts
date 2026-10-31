// Automatische Produktrecherche: Market Scan → Bewertung → Supplier Scout → Profit Check → Compliance → Shopify-Entwurf.
//
// Der Market Scout baut KEIN zweites System: Lieferanten vergleicht der bestehende Supplier Scout (compareQuotes) und
// wählt EINE Kalkulationsbasis (selectCalculationBasis, supplier-stage.ts), die Marge rechnet die bestehende Kalkulation
// (calc/pricing.ts) im Profit Controller (profit.ts: Stückrechnung, Retouren-Stress) zusammen mit der Liquidität derselben
// Basis (suppliers/liquidity.ts: fail-closed, Kapazität, geplante Menge), die Pflichtunterlagen prüft compliance.ts über feste Dokumenttypen, den Entwurf baut die bestehende
// Store Manager (store-manager.ts: buildDraftInput + Shopify-Guards, vollständiger Entwurf als lokales Artefakt, nur Dry-Run).
// Diese Datei verbindet nur und entscheidet über den Zustand.
//
// Der Agent setzt NIE „freigegeben“ oder „Entwurf erstellt“ – das bleibt Menschen bzw. dem gesperrten Schreibbefehl
// vorbehalten. Höchstens setzt er „bereit zur Prüfung“ (review_ready) – das ist keine Freigabe. Er kauft nichts, schaltet keine Werbung, veröffentlicht nichts und schreibt nicht nach Shopify.

import { SAFETY_SWITCHES } from "@/lib/config/budget";
import type { ProductListing } from "@/lib/shopify/listings";
import {
  DEFAULT_FUNDING_CONTEXT,
  DOC_TYPE_LABELS,
  LIQUIDITY_STATUS_LABELS,
  liquidityStageEffect,
  plannedAvailability,
  type DocType,
  type FinancingStatus,
  type FundingContext,
  type LiquidityAssessment,
  type LiquidityStatus,
  type MatchBasis,
} from "@/lib/suppliers";
import type { Product } from "@/lib/types";
import type { CatalogProduct } from "./catalog";
import { checkCompliance, requiredDocTypesFor } from "./compliance";
import { MARKET_SCAN, REVIEW_READY_RULES } from "./config";
import { identityKey, type MarketCandidate, type MarketSignal, type MarketSourceInfo } from "./model";
import { checkUnitEconomics, type PriceSource, type ProfitCheck, type SalePrice, type SingleUnitStatus } from "./profit";
import { hasDeferringCode, REASON_META, type ReasonCode } from "./reasons";
import { assessRisk, type RiskAssessment } from "./risk";
import { scoreOpportunity, type OpportunityScore } from "./score";
import { draftArtifactFile, draftStageOf, prepareDraft, type DraftArtifact } from "./store-manager";
import { BudgetExhaustedError, CATALOG_MARKET_SOURCE_INFO, RequestBudget, type DiscoveredTopic, type MarketSource } from "./sources";
import { runSupplierStage, type SupplierInput, type SupplierStageResult } from "./supplier-stage";

/**
 * Zustand eines Kandidaten:
 * - unreviewed    – ungeprüft (noch nicht vollständig bewertet, z. B. Abruflimit erreicht)
 * - deferred      – zurückgestellt (zu wenig Nachfrage, keine Produktidentität, kein Lieferant, zu geringe Marge)
 * - blocked       – gesperrt (Risiko, Demo-Daten, Compliance offen); ggf. mit vorbereitetem Dry-Run-Entwurf
 * - review_ready  – bereit zur Prüfung durch Menschen: echter Kandidat, alle Stufen durchlaufen, vollständiger Entwurf
 *                   ohne Guard-Verstoß (setzt der Agent; KEINE Freigabe, nie unter simulierter Uhr, nie Demo)
 * - approved      – freigegeben (nur durch einen Menschen; setzt der Agent nie)
 * - draft_created – Entwurf in Shopify angelegt (nur über den gesperrten Schreibbefehl; setzt der Agent nie)
 */
export type CandidateState = "unreviewed" | "deferred" | "blocked" | "review_ready" | "approved" | "draft_created";

export const CANDIDATE_STATE_LABELS: Record<CandidateState, string> = {
  unreviewed: "ungeprüft",
  deferred: "zurückgestellt",
  blocked: "gesperrt",
  review_ready: "bereit zur Prüfung",
  approved: "freigegeben",
  draft_created: "Entwurf erstellt",
};

export type StageKey = "market" | "supplier" | "profit" | "compliance" | "draft";
export type StageStatus = "ok" | "deferred" | "blocked" | "skipped";

export const STAGE_LABELS: Record<StageKey, string> = {
  market: "Marktbewertung",
  supplier: "Supplier Scout",
  profit: "Profit Controller (Stückrechnung + Liquidität)",
  compliance: "Compliance",
  draft: "Shopify-Entwurf (Dry-Run)",
};

export interface StageResult {
  key: StageKey;
  status: StageStatus;
  details: string[];
  /** Begründungs-Codes dieser Stufe (reasons.ts) */
  codes?: ReasonCode[];
}

/**
 * Kalkulationsbasis der Pipeline (selectCalculationBasis: ein Lieferant für alle Varianten, Liquidität vor Preis).
 * Kosten und Lieferzeit sind Worst-Case-Werte über die Varianten; die Finanzierung ist mit Worst-Case-Auszahlung bewertet.
 */
export interface SupplierSummary {
  /** Angebot der teuersten Variante */
  quoteId: string;
  supplierName: string;
  demo: boolean;
  /** Höchste Kosten je Stück über die Varianten */
  perUnit: number;
  deliveryDays: { min: number; max: number };
  financingStatus: FinancingStatus;
  requiresPrefinancing: boolean;
  /** Lieferanten, die jede Variante abdecken (bei einer Variante: geeignete Angebote) */
  eligible: number;
  realEligible: number;
  /** Offene Punkte des Basisangebots der teuersten Variante */
  openPoints: string[];
  /** Liquiditätsstatus der Basis (Worst Case) – fehlt in älteren gespeicherten Ständen */
  liquidityStatus?: LiquidityStatus;
  /** Worüber die Varianten zugeordnet sind – fehlt in älteren gespeicherten Ständen */
  matchBasis?: MatchBasis;
  /**
   * Angebots-Schlüssel (`supplierId::supplierSku`) der Kalkulationsbasis aus importierten Preislisten – Grundlage der
   * Dubletten-Prüfung über Kandidaten. VERTRAULICH: für echte Kandidaten später nur im Journal (Schwärzung, Paket G).
   */
  offerKeys?: string[];
  /** Lieferanten-ID der Kalkulationsbasis – fehlt in älteren gespeicherten Ständen */
  supplierId?: string;
  /** Angebots-IDs der Basis je Variante (VERTRAULICH – nur Journal) */
  quoteIds?: string[];
  /** Geprüfte Lieferanten mit Liquiditätsstatus (Auswahl Liquidität vor Preis; VERTRAULICH – nur Journal) */
  considered?: { supplierId: string; status: LiquidityStatus }[];
}

export interface DraftSummary {
  status: "none" | "dry_run_prepared";
  title?: string;
  handle?: string;
  /** Verstöße gegen die Shopify-Guards (leer = Entwurf wäre zulässig) */
  violations: string[];
  /** Würde im Schreiblauf angelegt? Heute immer false (Compliance offen, kein zeitgesteuerter Schreibzugriff). */
  wouldCreate: false;
  note: string;
  /** Lokales Artefakt (relativ zu .data/market, inhaltsadressiert) – fehlt in älteren gespeicherten Ständen */
  artifact?: { file: string; fingerprint: string };
  /** Vollständigkeit des Entwurfs (Store Manager) – fehlt in älteren gespeicherten Ständen */
  complete?: boolean;
  missing?: ReasonCode[];
}

export interface CandidateResult {
  candidate: MarketCandidate;
  risk: RiskAssessment;
  score: OpportunityScore;
  state: CandidateState;
  /** Warum dieser Zustand – die wichtigsten Gründe zuerst */
  stateReasons: string[];
  /** Begründungs-Codes (ohne Dubletten, in Reihenfolge des Auftretens); fehlt in älteren gespeicherten Ständen */
  reasonCodes?: ReasonCode[];
  stages: StageResult[];
  supplier: SupplierSummary | null;
  /**
   * Profit Controller (Stückrechnung). Die mit Paket C ergänzten Felder fehlen in älteren gespeicherten Ständen.
   * Beträge sind für echte Kandidaten VERTRAULICH (später nur im Journal, Schwärzung Paket G).
   */
  profit:
    | (Omit<ProfitCheck, "margin"> & {
        priceGross: number | null;
        contribution: number | null;
        marginPercent: number | null;
        priceSource?: PriceSource;
        /** Höchste Stückkosten über die Varianten + Bearbeitungsgebühr */
        perUnitWorstCase?: number | null;
        /** Deckungsbeitrag im Retouren-Stress */
        stressContribution?: number | null;
        singleUnit?: { moq: number | null; mov: number | null; status: SingleUnitStatus };
        /** Codes der Stufe (Stückrechnung + Liquidität + geplante Menge) */
        codes?: ReasonCode[];
      })
    | null;
  /**
   * Liquidität der Kalkulationsbasis aus Stufe 2 (derselbe Aufruf, nicht neu gerechnet). `securedWithoutPrefinancing`
   * ist in Phase 1 immer false. Fehlt in älteren gespeicherten Ständen. Beträge VERTRAULICH (Schwärzung Paket G).
   */
  liquidity?: LiquidityAssessment;
  /** Geplante verkaufbare Menge je Variante (nur für das Entwurfs-Artefakt, nie für Shopify); fehlt in älteren Ständen */
  availability?: { shopSku: string; plannedAvailable: number }[];
  /**
   * Pflichtunterlagen als Anzeigenamen (requiredDocuments/missingDocuments) und als feste Dokumenttypen; die Typen
   * fehlen in älteren gespeicherten Ständen. `status` bleibt „offen“ – freigeben kann nur ein Mensch.
   */
  compliance: {
    requiredDocuments: string[];
    missingDocuments: string[];
    requiredDocTypes?: DocType[];
    missingDocTypes?: DocType[];
    missingSafetyFacts?: string[];
    status: "offen";
  } | null;
  draft: DraftSummary;
  /**
   * Vollständiges Entwurfs-Artefakt des Laufs (ohne Beträge). Wird nur lokal unter .data/market/drafts/ abgelegt
   * (`market:scan -- --save`) und NIE in state.json gespeichert (mergeRun lässt es weg).
   */
  draftArtifact?: DraftArtifact;
  evaluatedAt: string;
  /**
   * Geschwärzte Form (state.json, Oberfläche): Lieferant, Stückrechnung, Liquidität und Angebots-Schlüssel eines echten
   * Kandidaten stehen nur im Journal (.data/market/journal/). Gesetzt von `toStoredResult` (state.ts).
   */
  redacted?: true;
}

/** Shop-Angaben für den Entwurf: Demo-Kandidaten das Demo-Listing, echte Kandidaten das Katalogprodukt – nie gemischt. */
export interface DraftSource {
  catalog?: CatalogProduct;
  demoListing?: ProductListing;
}

/** Was der Pipeline von außen zur Verfügung gestellt wird (vorhandene Bausteine, keine Kopien). */
export interface EvaluationDeps {
  now: Date;
  /**
   * Suchanfrage(n) und Angebote für den Supplier Scout – auf Produktebene (Demo-Produkte) oder je Katalogvariante;
   * null = keine belastbare Produktidentität (GTIN bzw. Katalogvariante)
   */
  supplierInput(candidate: MarketCandidate): SupplierInput | null;
  /** Mittel für die Liquiditätsbewertung (Standard: FUNDING, ohne Kontonachweis) */
  funding?: FundingContext;
  /**
   * Verkaufspreis eines echten Kandidaten (Katalog: salePrice); null = keiner. Demo-Kandidaten nutzen immer den
   * Zielpreis des Demo-Produkts, echte Kandidaten nie einen Demo-Zielpreis.
   */
  salePrice?(candidate: MarketCandidate): SalePrice | null;
  product(productId: string): Product | undefined;
  /** Shop-Angaben für den Store Manager (Stufe 5); fehlt bzw. null = keine – Entwurf nicht möglich */
  draftSource?(candidate: MarketCandidate): DraftSource | null;
  /** Lauf-ID für das Artefakt (nicht im Fingerabdruck); runMarketScan übergibt sie */
  runId?: string;
  /** Simulierte Uhr (--now): nie „bereit zur Prüfung“ (CLOCK_OVERRIDDEN) */
  clockOverride?: boolean;
  /**
   * Zwischengespeicherte Nachfragesignale eines Kandidaten (Schlüssel = kanonischer Kandidaten-Schlüssel), höchstens
   * MARKET_SCAN.staleAfterDays alt – nur lesend aus state.json. Fehlt die Funktion, gibt es keine.
   */
  cachedSignal?(key: string): MarketSignal[];
}

const NO_DRAFT = (note: string): DraftSummary => ({ status: "none", violations: [], wouldCreate: false, note });

const eur = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;

/** Verkaufspreis: Demo → Zielpreis des Demo-Produkts; echt → deps.salePrice (nie ein Demo-Zielpreis). */
function salePriceOf(candidate: MarketCandidate, deps: EvaluationDeps): SalePrice | null {
  if (candidate.demo) {
    const product = candidate.productId ? deps.product(candidate.productId) : undefined;
    return product ? { gross: product.targetPriceGross, basis: "demo_target", reference: "Demo-Zielpreis" } : null;
  }
  const price = deps.salePrice?.(candidate) ?? null;
  return price && price.basis !== "demo_target" ? price : null;
}

/**
 * Lieferanten-Fakten für die Bewertung: bei einer Variante wie bisher (geeignete Angebote, schnellste Höchstlieferzeit),
 * bei mehreren das Minimum der geeigneten Angebote bzw. die längste der schnellsten Lieferzeiten (Worst Case).
 */
function supplierFactsOf(stage: SupplierStageResult): { eligible: number; realEligible: number; bestMaxDeliveryDays: number | null } {
  const comparisons = stage.variants.flatMap((v) => (v.comparison ? [v.comparison] : []));
  if (comparisons.length === 0) return { eligible: 0, realEligible: 0, bestMaxDeliveryDays: null };
  const fastest = comparisons.map((c) => c.recommendations.fastest?.deliveryDays.max ?? null);
  return {
    eligible: Math.min(...comparisons.map((c) => c.eligible.length)),
    realEligible: Math.min(...comparisons.map((c) => c.eligible.filter((e) => !e.quote.demo).length)),
    bestMaxDeliveryDays: fastest.some((d) => d === null) ? null : Math.max(...(fastest as number[])),
  };
}

/** Bewertet einen gemessenen Kandidaten durch alle Stufen. Rein und deterministisch. */
export function evaluateCandidate(candidate: MarketCandidate, deps: EvaluationDeps): CandidateResult {
  const risk = assessRisk(candidate.title, candidate.category);
  const stages: StageResult[] = [];
  const reasons: string[] = [];
  const codes: ReasonCode[] = [];
  const evaluatedAt = deps.now.toISOString();
  /** Katalogkandidaten haben eine echte Produktidentität: Sie laufen auch ohne Nachfragesignal durch alle Stufen. */
  const isCatalog = !!candidate.catalogId && !candidate.demo;
  const skip = (from: StageKey[]) => from.forEach((key) => stages.push({ key, status: "skipped", details: ["Übersprungen – vorherige Stufe nicht bestanden."] }));
  // Ein Code mit Wirkung „zurückstellen“ stellt zurück, egal wie weit die Kette kam (stuft nur herab, nie hinauf).
  const finalState = (state: CandidateState): CandidateState =>
    state === "blocked" && !codes.includes("MARKET_PROHIBITED") && hasDeferringCode(codes) ? "deferred" : state;
  const finish = (state: CandidateState, extra: Partial<CandidateResult>, score: OpportunityScore): CandidateResult => ({
    candidate,
    risk,
    score,
    state: finalState(state),
    stateReasons: reasons,
    reasonCodes: [...new Set(codes)],
    stages,
    supplier: null,
    profit: null,
    compliance: null,
    draft: NO_DRAFT("Kein Entwurf – die Pipeline endete vor der Entwurfsstufe."),
    evaluatedAt,
    ...extra,
  });

  // 1. Marktbewertung (vorläufig, ohne Lieferant und Marge)
  const prelim = scoreOpportunity({ candidate, risk: risk.level, supplier: null, profit: null, now: deps.now });
  const demand = prelim.components.find((c) => c.key === "demand")!;
  if (risk.level === "prohibited") {
    codes.push("MARKET_PROHIBITED");
    reasons.push(`Warengruppe gesperrt: ${risk.reasons.join("; ")}.`);
    stages.push({ key: "market", status: "blocked", details: reasons.slice(), codes: ["MARKET_PROHIBITED"] });
    skip(["supplier", "profit", "compliance", "draft"]);
    return finish("blocked", {}, prelim);
  }
  const cachedSignal = candidate.signals.find((s) => s.cached && !s.demo);
  const marketCodes: ReasonCode[] = cachedSignal ? ["MARKET_SIGNAL_CACHED"] : [];
  const cachedNote = cachedSignal ? [`Nachfrage aus zwischengespeichertem Signal vom ${cachedSignal.retrievedAt.slice(0, 10)} (Unsicherheit erhöht).`] : [];
  codes.push(...marketCodes);
  if (demand.value === null) {
    codes.push("MARKET_NO_DEMAND");
    if (isCatalog) {
      // Katalogkandidat: Nachfrage fehlt → zurückgestellt, aber vollständig weiterbewertet (Lieferant, Marge, Unterlagen).
      reasons.push("Kein Nachfragesignal – einmal mit --live messen (Wikipedia-Artikel im Katalog: wikiTitle).");
      stages.push({ key: "market", status: "blocked", details: reasons.slice(), codes: [...marketCodes, "MARKET_NO_DEMAND"] });
    } else {
      reasons.push("Keine Nachfragedaten – Kandidat kann nicht bewertet werden.");
      stages.push({ key: "market", status: "deferred", details: reasons.slice(), codes: [...marketCodes, "MARKET_NO_DEMAND"] });
      skip(["supplier", "profit", "compliance", "draft"]);
      return finish("deferred", {}, prelim);
    }
  } else if (demand.value < MARKET_SCAN.minDemandForSupplierCheck) {
    codes.push("MARKET_LOW_DEMAND");
    const low = `Nachfrage ${String(demand.value).replace(".", ",")}/100 unter ${MARKET_SCAN.minDemandForSupplierCheck} – zu wenig belegtes Interesse`;
    if (isCatalog) {
      reasons.push(`${low} – zurückgestellt, Bewertung läuft weiter.`);
      stages.push({ key: "market", status: "blocked", details: [...reasons, demand.detail, ...cachedNote], codes: [...marketCodes, "MARKET_LOW_DEMAND"] });
    } else {
      reasons.push(`${low} für eine Lieferantensuche.`);
      stages.push({ key: "market", status: "deferred", details: [...reasons, demand.detail, ...cachedNote], codes: [...marketCodes, "MARKET_LOW_DEMAND"] });
      skip(["supplier", "profit", "compliance", "draft"]);
      return finish("deferred", {}, prelim);
    }
  } else {
    stages.push({
      key: "market",
      status: "ok",
      details: [`Vorläufige Bewertung ${prelim.score}/100.`, demand.detail, ...cachedNote, `Risiko: ${risk.reasons.join("; ")}`],
      ...(marketCodes.length > 0 && { codes: marketCodes }),
    });
  }

  // 2. Supplier Scout – Varianten-Identität, Angebote, EINE Kalkulationsbasis; echte Kandidaten nie mit Demo-Lieferanten
  const input = deps.supplierInput(candidate);
  if (!input) {
    codes.push("IDENTITY_MISSING");
    const text = isCatalog
      ? "Keine belastbare Lieferantenzuordnung für die Katalogvarianten (GTIN bzw. Artikelnummer + MPN/Kennung) – der Supplier Scout kann keine Angebote sicher zuordnen."
      : !candidate.demo && candidate.productId
        ? "Keine belastbare Produktidentität (GTIN) – mit Demo-Produkt verknüpft; nur Katalogprodukte haben eine echte Identität."
        : "Keine belastbare Produktidentität (GTIN) – der Supplier Scout kann keine Angebote sicher zuordnen.";
    reasons.push(text);
    stages.push({ key: "supplier", status: "deferred", details: [text], codes: ["IDENTITY_MISSING"] });
    skip(["profit", "compliance", "draft"]);
    return finish("deferred", {}, prelim);
  }
  // Der Verkaufspreis beziffert in der Liquiditätsbewertung das Erstattungsrisiko (Stufe 3 rechnet sie nicht neu)
  const price = salePriceOf(candidate, deps);
  const stage = runSupplierStage(input, candidate, deps.funding ?? DEFAULT_FUNDING_CONTEXT, price?.gross ?? null);
  const supplierFacts = supplierFactsOf(stage);
  if (stage.status === "deferred" || !stage.basis || !stage.liquidity) {
    codes.push(...stage.codes);
    reasons.push(...stage.reasons);
    stages.push({ key: "supplier", status: "deferred", details: stage.details, codes: stage.codes });
    skip(["profit", "compliance", "draft"]);
    // Ohne Zuordnung bleibt es bei der vorläufigen Bewertung; mit Angeboten fließen sie in die Bewertung ein
    const identityFailed = stage.variants.some((v) => v.comparison === null);
    const score = identityFailed ? prelim : scoreOpportunity({ candidate, risk: risk.level, supplier: supplierFacts, profit: null, now: deps.now });
    return finish("deferred", {}, score);
  }
  const { basis, liquidity } = stage;
  const worst = basis.perVariant.reduce((a, b) => ((b.evaluation.cost?.perUnit ?? 0) > (a.evaluation.cost?.perUnit ?? 0) ? b : a));
  const offerKeys = [...new Set(basis.perVariant.flatMap((v) => (v.offerKey ? [v.offerKey] : [])))].sort();
  const days = basis.perVariant.map((v) => v.evaluation.deliveryDays ?? { min: 0, max: 0 });
  const supplier: SupplierSummary = {
    quoteId: worst.evaluation.quote.id,
    supplierName: basis.supplierName,
    demo: basis.demo,
    perUnit: Math.max(...basis.perVariant.map((v) => v.evaluation.cost?.perUnit ?? 0)),
    deliveryDays: { min: Math.max(...days.map((d) => d.min)), max: Math.max(...days.map((d) => d.max)) },
    financingStatus: liquidity.financing.status,
    requiresPrefinancing: liquidity.financing.requiresPrefinancing,
    eligible: supplierFacts.eligible,
    realEligible: supplierFacts.realEligible,
    openPoints: worst.evaluation.eligibility.warnings.map((w) => w.message),
    liquidityStatus: liquidity.status,
    ...(stage.variants[0].match.status === "matched" && { matchBasis: stage.variants[0].match.basis }),
    ...(offerKeys.length > 0 && { offerKeys }),
    supplierId: basis.supplierId,
    quoteIds: [...new Set(basis.perVariant.map((v) => v.evaluation.quote.id))].sort(),
    considered: stage.considered,
  };
  stages.push({
    key: "supplier",
    status: "ok",
    details: [
      `${supplierFacts.eligible} geeignete${stage.variants.length > 1 ? " Lieferanten für alle Varianten" : " Angebote"}${supplierFacts.realEligible === 0 ? " (nur Demo)" : ""}; Kalkulationsbasis: ${supplier.supplierName} (Liquidität vor Preis).`,
      `Liquidität (Details im Profit Controller): ${LIQUIDITY_STATUS_LABELS[liquidity.status]}.`,
      ...stage.details,
      ...supplier.openPoints.slice(0, 4),
    ],
  });

  // 3. Profit Controller – Stückrechnung (Worst Case über die Varianten, Retouren-Stress, Einzelstück) und Liquidität
  //    derselben Basis aus Stufe 2 (nicht neu gerechnet): fail-closed, Kapazität offener Bestellungen, geplante Menge.
  const econ = checkUnitEconomics({ price, basis, demo: candidate.demo || supplier.demo, now: deps.now });
  const liqEffect = liquidityStageEffect(liquidity);
  const availability = plannedAvailability(basis, liquidity);
  const profitCodes: ReasonCode[] = [
    ...new Set<ReasonCode>([...econ.codes, ...liqEffect.codes, ...(availability.some((a) => a.plannedAvailable === 0) ? (["AVAILABILITY_ZERO"] as const) : [])]),
  ];
  codes.push(...profitCodes);
  const profitSummary: NonNullable<CandidateResult["profit"]> = {
    taxStatus: econ.taxStatus,
    reliable: econ.reliable,
    reasons: econ.reasons,
    priceGross: econ.priceGross,
    contribution: econ.margin?.contribution ?? null,
    marginPercent: econ.margin?.marginPercent ?? null,
    priceSource: econ.priceSource,
    perUnitWorstCase: econ.perUnitWorstCase,
    stressContribution: econ.stressContribution,
    singleUnit: econ.singleUnit,
    codes: profitCodes,
  };
  const scoreFinal = scoreOpportunity({
    candidate,
    risk: risk.level,
    supplier: supplierFacts,
    profit: econ.margin ? { marginPercent: econ.margin.marginPercent, reliable: econ.reliable } : null,
    now: deps.now,
  });
  const profitStatus: StageStatus = hasDeferringCode(profitCodes) ? "deferred" : profitCodes.some((c) => REASON_META[c].effect === "block") ? "blocked" : "ok";
  const profitDetails = [
    econ.margin
      ? `Deckungsbeitrag ${eur(econ.margin.contribution)} (${Math.round(econ.margin.marginPercent * 100)} %)${econ.stressContribution !== null ? `, im Retouren-Stress ${eur(econ.stressContribution)}` : ""}.`
      : "Marge nicht berechenbar.",
    ...econ.reasons,
    ...liquidity.details,
    `Geplante verkaufbare Menge: ${availability.map((a) => `${availability.length > 1 ? `${a.shopSku} ` : ""}${a.plannedAvailable}`).join(", ")} (nur Artefakt, nie Shopify).`,
  ];
  stages.push({ key: "profit", status: profitStatus, details: profitDetails, codes: profitCodes });
  const extra = { supplier, profit: profitSummary, liquidity, availability };
  if (profitStatus === "deferred") {
    if (!econ.margin) reasons.push("Marge nicht berechenbar.");
    reasons.push(`Profit Controller zurückgestellt: ${profitCodes.filter((c) => REASON_META[c].effect === "defer").map((c) => REASON_META[c].label).join("; ")}.`);
    skip(["compliance", "draft"]);
    return finish("deferred", extra, scoreFinal);
  }
  if (!econ.reliable) reasons.push("Marge nicht verlässlich berechenbar – keine automatische Freigabe.");
  if (liqEffect.status === "blocked") {
    const liqBlocks = profitCodes.filter((c) => c.startsWith("LIQ_") && REASON_META[c].effect === "block").map((c) => REASON_META[c].label);
    reasons.push(`Liquidität: ${liqBlocks.join("; ")} – nie automatisierbar.`);
  }

  // 4. Compliance – Pflicht-Dokumenttypen (Risikoregeln + Katalog/Abfrage) über ALLE Basisangebote; Freigabe nur durch Menschen
  const extraDocTypes = stage.variants.flatMap((v) => v.query.requiredDocTypes ?? []);
  const check = checkCompliance({
    risk,
    required: requiredDocTypesFor(risk, extraDocTypes),
    quotes: basis.perVariant.map((v) => v.evaluation.quote),
    demo: candidate.demo,
  });
  const compliance: NonNullable<CandidateResult["compliance"]> = {
    requiredDocuments: check.requiredDocTypes.map((t) => DOC_TYPE_LABELS[t]),
    missingDocuments: check.missingDocTypes.map((t) => DOC_TYPE_LABELS[t]),
    requiredDocTypes: check.requiredDocTypes,
    missingDocTypes: check.missingDocTypes,
    missingSafetyFacts: check.missingSafetyFacts,
    status: "offen",
  };
  codes.push(...check.codes);
  if (check.status === "deferred") {
    const missing = check.missingDocTypes.length + (check.missingSafetyFacts.length > 0 ? 1 : 0);
    reasons.push(
      check.codes.includes("COMPLIANCE_RISK_UNKNOWN") && missing === 0
        ? "Compliance zurückgestellt – Risiko der Warengruppe unbekannt."
        : `Compliance zurückgestellt – ${check.missingDocTypes.length === 1 ? "1 Pflichtunterlage fehlt" : `${check.missingDocTypes.length} Pflichtunterlagen fehlen`}${check.missingSafetyFacts.length ? ", Sicherheitsangaben unbestätigt" : ""}.`,
    );
    stages.push({ key: "compliance", status: "deferred", details: check.details, codes: check.codes });
    skip(["draft"]);
    return finish("deferred", { ...extra, compliance }, scoreFinal);
  }
  stages.push({ key: "compliance", status: "blocked", details: check.details, codes: check.codes });
  reasons.push("Compliance-Freigabe durch Menschen ausstehend.");

  // 5. Store Manager – vollständiger Entwurf als lokales Artefakt (nur Dry-Run; nie Shopify, nie eine Freigabe)
  const clockOverride = deps.clockOverride === true;
  const source = deps.draftSource?.(candidate) ?? null;
  const hasSource = candidate.demo ? !!source?.demoListing : !!source?.catalog;
  let draft: DraftSummary;
  let draftArtifact: DraftArtifact | undefined;
  let draftStatus: StageStatus;
  if (!price || !hasSource) {
    draft = NO_DRAFT("Keine Shop-Angaben (Texte, Varianten, Bilder mit Nutzungsrechten) – Entwurf nicht möglich.");
    draftStatus = "deferred";
    codes.push("DRAFT_INCOMPLETE");
    reasons.push(draft.note);
    stages.push({ key: "draft", status: draftStatus, details: [draft.note], codes: ["DRAFT_INCOMPLETE"] });
  } else {
    draftArtifact = prepareDraft({
      candidate,
      ...(candidate.demo ? { demoListing: source!.demoListing } : { catalog: source!.catalog }),
      price,
      basis,
      supplierVariants: stage.variants,
      liquidity,
      compliance: check,
      runId: deps.runId ?? "einzelbewertung",
      now: deps.now,
      demo: candidate.demo,
      clockOverride,
    });
    const effect = draftStageOf(draftArtifact);
    draftStatus = effect.status;
    draft = {
      status: "dry_run_prepared",
      title: draftArtifact.shopifyInput.title,
      handle: draftArtifact.shopifyInput.handle,
      violations: draftArtifact.violations,
      wouldCreate: false,
      note: `Dry-Run-Entwurf als lokales Artefakt vorbereitet (Status DRAFT${draftArtifact.demo ? ", Demo" : ""}) – nicht in Shopify angelegt, keine Freigabe.${SAFETY_SWITCHES.shopifyWriteEnabled ? "" : " Shopify-Schreibzugriff ist gesperrt."}`,
      artifact: { file: draftArtifactFile(draftArtifact), fingerprint: draftArtifact.fingerprint },
      complete: draftArtifact.completeness.complete,
      missing: draftArtifact.completeness.missing,
    };
    codes.push(...effect.codes);
    if (effect.status === "blocked") reasons.push(`Shopify-Entwurf verstößt gegen die Guards: ${draftArtifact.violations.join(" ")}`);
    else if (effect.status === "deferred") reasons.push(`Shopify-Entwurf unvollständig: ${draftArtifact.completeness.notes.join(" ")}`);
    stages.push({
      key: "draft",
      status: draftStatus,
      details: [draft.note, ...draftArtifact.completeness.notes, ...draftArtifact.violations],
      ...(effect.codes.length > 0 && { codes: effect.codes }),
    });
  }

  // Endzustand: „bereit zur Prüfung“ nur für echte, vollständig bewertete Kandidaten – sonst zurückgestellt bzw. gesperrt.
  // Erlaubte Sperr-Codes: Compliance-Freigabe durch Menschen, unverlässliche Marge (Steuerstatus, Planpreis) und – nach
  // Entscheidung 4 (REVIEW_READY_RULES) – ein unbelegtes Zahlungsziel. Alles andere bleibt gesperrt.
  if (clockOverride) codes.push("CLOCK_OVERRIDDEN");
  const uncertain = scoreFinal.uncertainty > MARKET_SCAN.maxUncertainty;
  if (uncertain && !candidate.demo) codes.push("UNCERTAINTY_HIGH");
  const allowedBlocks = new Set<ReasonCode>(["COMPLIANCE_HUMAN_REVIEW", "MARGIN_UNRELIABLE", ...(REVIEW_READY_RULES.allowUnsecuredTerms ? (["LIQ_TERM_UNSECURED"] as const) : [])]);
  const statusOf = (key: StageKey) => stages.find((s) => s.key === key)?.status;
  const ready =
    !candidate.demo &&
    !clockOverride &&
    !uncertain &&
    statusOf("market") === "ok" &&
    statusOf("supplier") === "ok" &&
    (profitStatus === "ok" || profitStatus === "blocked") &&
    check.status === "human_review" &&
    draftStatus === "ok" &&
    !hasDeferringCode(codes) &&
    codes.every((c) => REASON_META[c].effect !== "block" || allowedBlocks.has(c));
  if (clockOverride && !candidate.demo) reasons.push("Simulierte Uhr (--now) – nie bereit zur Prüfung.");
  if (ready) reasons.push("Bereit zur Prüfung durch Menschen – keine Freigabe; Anlage in Shopify erst mit Freigabe-Akte (Phase 2).");

  return finish(ready ? "review_ready" : "blocked", { ...extra, compliance, draft, ...(draftArtifact && { draftArtifact }) }, scoreFinal);
}

// ---------------------------------------------------------------------------------------------------------------
// Lauf über alle Quellen
// ---------------------------------------------------------------------------------------------------------------

export interface SourceRun {
  id: string;
  name: string;
  kind: MarketSourceInfo["kind"];
  status: "ok" | "blocked" | "error" | "partial";
  message?: string;
  candidates: number;
}

export interface MarketRun {
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** live = mit realen Quellen; demo = nur Demo-Quelle */
  mode: "live" | "demo";
  sources: SourceRun[];
  requests: { used: number; limit: number };
  /** Kosten des Laufs in EUR – kostenpflichtige Quellen sind gesperrt */
  costEur: 0;
  /** Gesetzt, wenn der Lauf vorzeitig endete (Abbruchschalter, Limit, Fehler) */
  aborted?: string;
  errors: string[];
  results: CandidateResult[];
}

export interface RunOptions extends EvaluationDeps {
  runId: string;
  sources: MarketSource[];
  /** Netzwerk-Quellen erlauben (nur im Befehl `market:scan -- --live`, nie im Dashboard) */
  allowNetwork: boolean;
  /** Abbruchschalter zur Laufzeit, z. B. Datei .data/market/STOP */
  shouldStop(): boolean;
  /** Bereits bekannte Kandidaten: Schlüssel → letzter Bewertungszeitpunkt (für die Reihenfolge) */
  lastEvaluated?: Map<string, string>;
  maxRequests?: number;
  maxCandidates?: number;
  /**
   * Uhr für das Laufende. Standard: `now` (deterministisch – Zeit kommt nur aus den Abhängigkeiten). Der Befehl
   * `market:scan` übergibt die echte Uhr, mit `--now` die feste Uhr; das Dashboard eine feste Zeit (vorrenderbar).
   */
  clock?: () => Date;
}

/** Ein vollständiger, wiederholbarer Lauf. Fehler einzelner Quellen oder Kandidaten brechen den Lauf nicht ab. */
export async function runMarketScan(o: RunOptions): Promise<MarketRun> {
  const startedAt = o.now.toISOString();
  const budget = new RequestBudget(o.maxRequests ?? MARKET_SCAN.maxRequestsPerRun);
  const maxCandidates = o.maxCandidates ?? MARKET_SCAN.maxCandidatesPerRun;
  const run: MarketRun = {
    runId: o.runId,
    startedAt,
    finishedAt: startedAt,
    mode: o.allowNetwork && o.sources.some((s) => s.info.network) ? "live" : "demo",
    sources: [],
    requests: { used: 0, limit: budget.limit },
    costEur: 0,
    errors: [],
    results: [],
  };
  const clock = o.clock ?? (() => o.now);
  const done = () => ({ ...run, finishedAt: clock().toISOString(), requests: { used: budget.used, limit: budget.limit } });
  const candidateOf = (topic: DiscoveredTopic): MarketCandidate => ({
    key: topic.key,
    title: topic.title,
    category: topic.category,
    productId: topic.productId,
    ...(topic.catalogId !== undefined && { catalogId: topic.catalogId }),
    discoveredVia: topic.discoveredVia,
    demo: topic.demo,
    signals: [],
  });
  /** Nicht gemessene Themen bleiben sichtbar – als „ungeprüft“, mit Grund. */
  const unreviewed = (topic: DiscoveredTopic, why: string): CandidateResult => {
    const candidate = candidateOf(topic);
    const risk = assessRisk(candidate.title, candidate.category);
    return {
      candidate,
      risk,
      score: scoreOpportunity({ candidate, risk: risk.level, supplier: null, profit: null, now: o.now }),
      state: "unreviewed",
      stateReasons: [why],
      stages: [],
      supplier: null,
      profit: null,
      compliance: null,
      draft: NO_DRAFT("Noch nicht bewertet."),
      evaluatedAt: o.now.toISOString(),
    };
  };
  /** Ungültiger Katalogeintrag: wird weder gemessen noch bewertet, sondern mit Grund zurückgestellt. */
  const invalidCatalogEntry = (topic: DiscoveredTopic, invalid: NonNullable<DiscoveredTopic["invalid"]>): CandidateResult => {
    const base = unreviewed(topic, "");
    const codes = [...new Set(invalid.codes)];
    return {
      ...base,
      state: "deferred",
      stateReasons: invalid.messages.map((m) => `Katalogeintrag ungültig: ${m}`),
      reasonCodes: codes,
      stages: [
        { key: "market", status: "deferred", details: invalid.messages.slice(), codes },
        ...(["supplier", "profit", "compliance", "draft"] as const).map((key): StageResult => ({ key, status: "skipped", details: ["Übersprungen – Katalogeintrag ungültig."] })),
      ],
      draft: NO_DRAFT("Kein Entwurf – Katalogeintrag ungültig."),
    };
  };

  if (!MARKET_SCAN.enabled) return { ...done(), aborted: "Market Scout ist im Code deaktiviert (MARKET_SCAN.enabled)." };
  if (o.shouldStop()) return { ...done(), aborted: "Abbruchschalter aktiv (.data/market/STOP)." };

  // Entdecken – Dubletten über Quellen hinweg nach identityKey zusammenführen (Demo und echt nie gemeinsam)
  const groups = new Map<string, Discovered[]>();
  for (const source of o.sources) {
    const entry: SourceRun = { id: source.info.id, name: source.info.name, kind: source.info.kind, status: "ok", candidates: 0 };
    run.sources.push(entry);
    if (source.info.paid && !SAFETY_SWITCHES.paidApiCallsEnabled) {
      entry.status = "blocked";
      entry.message = "Kostenpflichtige Quelle – gesperrt (SAFETY_SWITCHES.paidApiCallsEnabled).";
      continue;
    }
    if (source.info.network && !o.allowNetwork) {
      entry.status = "blocked";
      entry.message = "Netzwerk-Quelle – nur im Befehl `npm run market:scan -- --live`.";
      continue;
    }
    try {
      for (const topic of await source.discover(budget)) {
        const id = identityKey(topic);
        const group = groups.get(id) ?? [];
        // Dasselbe Thema derselben Quelle nur einmal
        if (!group.some((g) => g.source === source && g.topic.key === topic.key)) group.push({ topic, source });
        groups.set(id, group);
      }
    } catch (e) {
      entry.status = e instanceof BudgetExhaustedError ? "partial" : "error";
      entry.message = e instanceof Error ? e.message : String(e);
      run.errors.push(`${source.info.name}: ${entry.message}`);
    }
  }
  const found = [...groups.values()].map(mergeDiscovered);
  const byKey = new Map(found.map((f) => [f.topic.key, f]));

  // Reihenfolge: bekannte Produkte (Katalog, Kontrollzentrale) zuerst, dann nie bewertete, dann am längsten nicht bewertete
  const queue = found.sort((a, b) => {
    const pa = (a.topic.catalogId ?? a.topic.productId) ? 0 : 1;
    const pb = (b.topic.catalogId ?? b.topic.productId) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const la = o.lastEvaluated?.get(a.topic.key) ?? "";
    const lb = o.lastEvaluated?.get(b.topic.key) ?? "";
    return la < lb ? -1 : la > lb ? 1 : a.topic.key < b.topic.key ? -1 : a.topic.key > b.topic.key ? 1 : 0;
  });

  // Messen und bewerten
  let stopAt = queue.length;
  let stopReason = "";
  let measured = 0; // Kandidatenlimit gilt nur für Abrufe aus dem Netz (Demo- und Katalogkandidaten kosten nichts)
  for (const [index, { topic, measure }] of queue.entries()) {
    if (topic.invalid) {
      run.results.push(invalidCatalogEntry(topic, topic.invalid));
      continue;
    }
    if (measure.source.info.network && measured >= maxCandidates) {
      [stopAt, stopReason] = [index, `Kandidatenlimit von ${maxCandidates} je Lauf erreicht – folgt im nächsten Lauf.`];
      run.errors.push(`Kandidatenlimit von ${maxCandidates} je Lauf erreicht – ${queue.length - index} Themen folgen im nächsten Lauf.`);
      break;
    }
    if (measure.source.info.network) measured++;
    if (o.shouldStop()) {
      run.aborted = "Abbruchschalter während des Laufs aktiviert.";
      [stopAt, stopReason] = [index, run.aborted];
      break;
    }
    const candidate = candidateOf(topic);
    // Vorab prüfen, ob die Warengruppe gesperrt ist – spart Abrufe
    if (assessRisk(candidate.title, candidate.category).level !== "prohibited") {
      try {
        const signal = await measure.source.measure(measure.topic, budget);
        if (signal) candidate.signals.push(signal);
      } catch (e) {
        if (e instanceof BudgetExhaustedError) {
          run.aborted = e.message;
          [stopAt, stopReason] = [index, `${e.message} Folgt im nächsten Lauf.`];
          break;
        }
        const message = e instanceof Error ? e.message : String(e);
        run.errors.push(`${candidate.title}: ${message}`);
        run.results.push(unreviewed(topic, `Messung fehlgeschlagen: ${message}`));
        continue;
      }
      // Ohne Live-Signal: zwischengespeichertes Signal (≤ staleAfterDays) – ein Live-Signal im selben Lauf hat Vorrang.
      if (!candidate.demo && candidate.signals.length === 0 && o.cachedSignal) {
        for (const s of o.cachedSignal(candidate.key)) if (!s.demo) candidate.signals.push({ ...s, cached: true });
      }
    }
    try {
      run.results.push(evaluateCandidate(candidate, o));
    } catch (e) {
      run.errors.push(`${candidate.title}: Bewertung fehlgeschlagen – ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const { topic } of queue.slice(stopAt)) run.results.push(unreviewed(topic, stopReason));
  for (const s of run.sources) s.candidates = run.results.filter((r) => byKey.get(r.candidate.key)?.all.some((d) => d.source.info.id === s.id)).length;

  // Nachlauf über alle Kandidaten: nur herabstufend
  run.results = resolveHandleConflicts(resolveOfferConflicts(run.results));
  return { ...done(), aborted: run.aborted };
}

interface Discovered {
  topic: DiscoveredTopic;
  source: MarketSource;
}

/** Rang des kanonischen Schlüssels: Katalog vor Demo-Produkt vor Quellen-Thema (z. B. wiki:…). */
const canonicalRank = (key: string) => (key.startsWith("catalog:") ? 0 : key.startsWith("demo:") ? 1 : 2);

/**
 * Führt die Fundstellen eines Themas zusammen: kanonischer Schlüssel `catalog:<id>` vor `demo:<id>` vor `wiki:…`,
 * `discoveredVia` zusammengefasst. Gemessen wird über die Quelle mit Katalogverknüpfung (Wikimedia über `wikiTitle`),
 * sonst wie bisher über die Fundstelle selbst. Eine allgemeine Mehrquellen-Messung gibt es nicht.
 */
function mergeDiscovered(all: Discovered[]): { topic: DiscoveredTopic; measure: Discovered; all: Discovered[] } {
  const canonical = all.reduce((best, d) => (canonicalRank(d.topic.key) < canonicalRank(best.topic.key) ? d : best), all[0]);
  const measure = all.find((d) => d.topic.catalogId && d.source.info.id !== CATALOG_MARKET_SOURCE_INFO.id && !d.topic.invalid) ?? canonical;
  const via = [...new Set(all.map((d) => d.topic.discoveredVia))];
  const invalid = all.find((d) => d.topic.invalid)?.topic.invalid;
  return {
    topic: {
      ...canonical.topic,
      category: canonical.topic.category ?? all.find((d) => d.topic.category)?.topic.category,
      discoveredVia: via.join(" + "),
      ...(invalid && { invalid }),
    },
    measure,
    all,
  };
}

/** Stuft einen Kandidaten mit Grund auf „zurückgestellt“ herab (nie hinauf; gesperrte Warengruppen bleiben gesperrt). */
function downgrade(r: CandidateResult, code: ReasonCode, text: string): CandidateResult {
  if (r.state === "unreviewed") return r;
  const keep = r.state === "deferred" || r.reasonCodes?.includes("MARKET_PROHIBITED");
  return {
    ...r,
    state: keep ? r.state : "deferred",
    stateReasons: [...r.stateReasons, text],
    reasonCodes: [...new Set([...(r.reasonCodes ?? []), code])],
  };
}

/**
 * Nachlauf: Beansprucht dasselbe Lieferantenangebot (offerKey) die Kalkulationsbasis mehrerer ECHTER Kandidaten,
 * werden alle betroffenen zurückgestellt (OFFER_DUPLICATE_ASSIGNMENT) – sonst würde eine Bestellung womöglich zweimal
 * eingeplant. Demo-Kandidaten zählen nicht. Stuft nur herab.
 */
export function resolveOfferConflicts(results: CandidateResult[]): CandidateResult[] {
  const claims = new Map<string, Set<string>>();
  for (const r of results) {
    if (r.candidate.demo || r.state === "unreviewed") continue;
    for (const k of r.supplier?.offerKeys ?? []) claims.set(k, (claims.get(k) ?? new Set()).add(r.candidate.key));
  }
  const conflicted = new Set([...claims.values()].filter((keys) => keys.size > 1).flatMap((keys) => [...keys]));
  if (conflicted.size === 0) return results;
  return results.map((r) =>
    !r.candidate.demo && conflicted.has(r.candidate.key)
      ? downgrade(r, "OFFER_DUPLICATE_ASSIGNMENT", "Dasselbe Lieferantenangebot ist mehreren Kandidaten als Kalkulationsbasis zugeordnet – Zuordnung klären.")
      : r,
  );
}

/**
 * Nachlauf: Hat ein anderer echter Kandidat im selben Lauf einen Entwurf mit gleichem Handle, werden alle betroffenen
 * zurückgestellt (DRAFT_DUPLICATE_HANDLE). Demo-Kandidaten zählen nicht. Stuft nur herab.
 */
export function resolveHandleConflicts(results: CandidateResult[]): CandidateResult[] {
  const byHandle = new Map<string, Set<string>>();
  for (const r of results) {
    if (r.candidate.demo || r.draft.status !== "dry_run_prepared" || !r.draft.handle) continue;
    byHandle.set(r.draft.handle, (byHandle.get(r.draft.handle) ?? new Set()).add(r.candidate.key));
  }
  const conflicted = new Set([...byHandle.values()].filter((keys) => keys.size > 1).flatMap((keys) => [...keys]));
  if (conflicted.size === 0) return results;
  return results.map((r) =>
    !r.candidate.demo && conflicted.has(r.candidate.key)
      ? downgrade(r, "DRAFT_DUPLICATE_HANDLE", `Handle „${r.draft.handle}“ ist im selben Lauf von einem anderen Kandidaten belegt.`)
      : r,
  );
}
