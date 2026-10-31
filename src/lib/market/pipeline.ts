// Automatische Produktrecherche: Market Scan → Bewertung → Supplier Scout → Profit Check → Compliance → Shopify-Entwurf.
//
// Der Market Scout baut KEIN zweites System: Lieferanten vergleicht der bestehende Supplier Scout (compareQuotes),
// die Marge rechnet die bestehende Kalkulation (calc/pricing.ts), den Entwurf baut die bestehende Shopify-Pipeline
// (shopify/pipeline.ts, nur Dry-Run, mit Guards). Diese Datei verbindet nur und entscheidet über den Zustand.
//
// Der Agent setzt NIE „freigegeben“ oder „Entwurf erstellt“ – das bleibt Menschen bzw. dem gesperrten Schreibbefehl
// vorbehalten. Er kauft nichts, schaltet keine Werbung, veröffentlicht nichts und schreibt nicht nach Shopify.

import { RECOMMENDATION_RULES } from "@/lib/config/assumptions";
import { SAFETY_SWITCHES } from "@/lib/config/budget";
import type { ProductAnalysis } from "@/lib/data";
import type { ProductListing } from "@/lib/shopify/listings";
import { evaluatePipeline } from "@/lib/shopify/pipeline";
import { compareQuotes, factValue, type FinancingStatus, type ProductQuery, type SupplierQuote } from "@/lib/suppliers";
import type { Product } from "@/lib/types";
import { MARKET_SCAN } from "./config";
import type { MarketCandidate, MarketSourceInfo } from "./model";
import { checkProfit, type ProfitCheck } from "./profit";
import { assessRisk, RISK_LABELS, type RiskAssessment } from "./risk";
import { scoreOpportunity, type OpportunityScore } from "./score";
import { BudgetExhaustedError, RequestBudget, type DiscoveredTopic, type MarketSource } from "./sources";

/**
 * Zustand eines Kandidaten:
 * - unreviewed    – ungeprüft (noch nicht vollständig bewertet, z. B. Abruflimit erreicht)
 * - deferred      – zurückgestellt (zu wenig Nachfrage, keine Produktidentität, kein Lieferant, zu geringe Marge)
 * - blocked       – gesperrt (Risiko, Marge nicht verlässlich, Compliance offen); ggf. mit vorbereitetem Dry-Run-Entwurf
 * - approved      – freigegeben (nur durch einen Menschen; setzt der Agent nie)
 * - draft_created – Entwurf in Shopify angelegt (nur über den gesperrten Schreibbefehl; setzt der Agent nie)
 */
export type CandidateState = "unreviewed" | "deferred" | "blocked" | "approved" | "draft_created";

export const CANDIDATE_STATE_LABELS: Record<CandidateState, string> = {
  unreviewed: "ungeprüft",
  deferred: "zurückgestellt",
  blocked: "gesperrt",
  approved: "freigegeben",
  draft_created: "Entwurf erstellt",
};

export type StageKey = "market" | "supplier" | "profit" | "compliance" | "draft";
export type StageStatus = "ok" | "deferred" | "blocked" | "skipped";

export const STAGE_LABELS: Record<StageKey, string> = {
  market: "Marktbewertung",
  supplier: "Supplier Scout",
  profit: "Profit Check",
  compliance: "Compliance",
  draft: "Shopify-Entwurf (Dry-Run)",
};

export interface StageResult {
  key: StageKey;
  status: StageStatus;
  details: string[];
}

export interface SupplierSummary {
  quoteId: string;
  supplierName: string;
  demo: boolean;
  perUnit: number;
  deliveryDays: { min: number; max: number };
  financingStatus: FinancingStatus;
  requiresPrefinancing: boolean;
  eligible: number;
  realEligible: number;
  /** Offene Punkte des günstigsten geeigneten Angebots */
  openPoints: string[];
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
}

export interface CandidateResult {
  candidate: MarketCandidate;
  risk: RiskAssessment;
  score: OpportunityScore;
  state: CandidateState;
  /** Warum dieser Zustand – die wichtigsten Gründe zuerst */
  stateReasons: string[];
  stages: StageResult[];
  supplier: SupplierSummary | null;
  profit: (Omit<ProfitCheck, "margin"> & { priceGross: number | null; contribution: number | null; marginPercent: number | null }) | null;
  compliance: { requiredDocuments: string[]; missingDocuments: string[]; status: "offen" } | null;
  draft: DraftSummary;
  evaluatedAt: string;
}

/** Was der Pipeline von außen zur Verfügung gestellt wird (vorhandene Bausteine, keine Kopien). */
export interface EvaluationDeps {
  now: Date;
  /** Suchanfrage und Angebote für den Supplier Scout; null = keine belastbare Produktidentität (GTIN) */
  supplierInput(candidate: MarketCandidate): { query: ProductQuery; quotes: SupplierQuote[] } | null;
  product(productId: string): Product | undefined;
  analysis(productId: string): ProductAnalysis | undefined;
  listing(productId: string): ProductListing | undefined;
}

const NO_DRAFT = (note: string): DraftSummary => ({ status: "none", violations: [], wouldCreate: false, note });

/** Bewertet einen gemessenen Kandidaten durch alle Stufen. Rein und deterministisch. */
export function evaluateCandidate(candidate: MarketCandidate, deps: EvaluationDeps): CandidateResult {
  const risk = assessRisk(candidate.title, candidate.category);
  const stages: StageResult[] = [];
  const reasons: string[] = [];
  const evaluatedAt = deps.now.toISOString();
  const skip = (from: StageKey[]) => from.forEach((key) => stages.push({ key, status: "skipped", details: ["Übersprungen – vorherige Stufe nicht bestanden."] }));
  const finish = (state: CandidateState, extra: Partial<CandidateResult>, score: OpportunityScore): CandidateResult => ({
    candidate,
    risk,
    score,
    state,
    stateReasons: reasons,
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
    reasons.push(`Warengruppe gesperrt: ${risk.reasons.join("; ")}.`);
    stages.push({ key: "market", status: "blocked", details: reasons.slice() });
    skip(["supplier", "profit", "compliance", "draft"]);
    return finish("blocked", {}, prelim);
  }
  if (demand.value === null) {
    reasons.push("Keine Nachfragedaten – Kandidat kann nicht bewertet werden.");
    stages.push({ key: "market", status: "deferred", details: reasons.slice() });
    skip(["supplier", "profit", "compliance", "draft"]);
    return finish("deferred", {}, prelim);
  }
  if (demand.value < MARKET_SCAN.minDemandForSupplierCheck) {
    reasons.push(`Nachfrage ${String(demand.value).replace(".", ",")}/100 unter ${MARKET_SCAN.minDemandForSupplierCheck} – zu wenig belegtes Interesse für eine Lieferantensuche.`);
    stages.push({ key: "market", status: "deferred", details: [...reasons, demand.detail] });
    skip(["supplier", "profit", "compliance", "draft"]);
    return finish("deferred", {}, prelim);
  }
  stages.push({ key: "market", status: "ok", details: [`Vorläufige Bewertung ${prelim.score}/100.`, demand.detail, `Risiko: ${risk.reasons.join("; ")}`] });

  // 2. Supplier Scout – echte Kandidaten nie mit Demo-Lieferanten
  const input = deps.supplierInput(candidate);
  if (!input) {
    reasons.push("Keine belastbare Produktidentität (GTIN) – der Supplier Scout kann keine Angebote sicher zuordnen.");
    stages.push({ key: "supplier", status: "deferred", details: reasons.slice() });
    skip(["profit", "compliance", "draft"]);
    return finish("deferred", {}, prelim);
  }
  const quotes = candidate.demo ? input.quotes : input.quotes.filter((q) => !q.demo);
  const ignoredDemo = input.quotes.length - quotes.length;
  const comparison = compareQuotes(input.query, quotes);
  const cheapest = comparison.recommendations.cheapest;
  const realEligible = comparison.eligible.filter((e) => !e.quote.demo).length;
  const supplierFacts = {
    eligible: comparison.eligible.length,
    realEligible,
    bestMaxDeliveryDays: comparison.recommendations.fastest?.deliveryDays.max ?? null,
  };
  if (!cheapest) {
    reasons.push(quotes.length === 0 ? "Keine Lieferantenangebote zu dieser Produktidentität." : `Kein geeigneter Lieferant (${quotes.length} Angebote geprüft, alle ausgeschlossen).`);
    if (ignoredDemo) reasons.push(`${ignoredDemo} Demo-Angebote nicht berücksichtigt – fiktive Lieferanten zählen nie für echte Kandidaten.`);
    const exclusions = [...new Set(comparison.excluded.flatMap((e) => e.eligibility.exclusions.map((x) => x.message)))].slice(0, 5);
    stages.push({ key: "supplier", status: "deferred", details: [...reasons, ...exclusions] });
    skip(["profit", "compliance", "draft"]);
    const score = scoreOpportunity({ candidate, risk: risk.level, supplier: supplierFacts, profit: null, now: deps.now });
    return finish("deferred", {}, score);
  }
  const best = comparison.eligible.find((e) => e.quote.id === cheapest.quoteId)!;
  const supplier: SupplierSummary = {
    quoteId: cheapest.quoteId,
    supplierName: cheapest.supplierName,
    demo: cheapest.demo,
    perUnit: cheapest.perUnit,
    deliveryDays: cheapest.deliveryDays,
    financingStatus: cheapest.financingStatus,
    requiresPrefinancing: cheapest.requiresPrefinancing,
    eligible: comparison.eligible.length,
    realEligible,
    openPoints: cheapest.openPoints.map((p) => p.message),
  };
  stages.push({
    key: "supplier",
    status: "ok",
    details: [
      `${comparison.eligible.length} geeignete Angebote${realEligible === 0 ? " (nur Demo)" : ""}; günstigster: ${supplier.supplierName}.`,
      supplier.requiresPrefinancing ? "Vorfinanzierung nötig." : "Bestätigtes Zahlungsziel – keine Vorfinanzierung.",
      ...supplier.openPoints.slice(0, 4),
    ],
  });

  // 3. Profit Check mit der bestehenden Kalkulation
  const product = candidate.productId ? deps.product(candidate.productId) : undefined;
  const priceGross = candidate.demo && product ? product.targetPriceGross : null;
  const costVerified = best.quote.provenance?.kind === "price_list" && factValue(best.quote.pricing.unitPrice) !== undefined && best.quote.pricing.unitPrice.status === "confirmed";
  const profit = checkProfit({
    priceGross,
    priceSource: priceGross === null ? "none" : "demo_target",
    landedCostNet: supplier.perUnit,
    costVerified,
    demo: candidate.demo || supplier.demo,
  });
  const profitSummary = {
    taxStatus: profit.taxStatus,
    reliable: profit.reliable,
    reasons: profit.reasons,
    priceGross,
    contribution: profit.margin?.contribution ?? null,
    marginPercent: profit.margin?.marginPercent ?? null,
  };
  const scoreFinal = scoreOpportunity({
    candidate,
    risk: risk.level,
    supplier: supplierFacts,
    profit: profit.margin ? { marginPercent: profit.margin.marginPercent, reliable: profit.reliable } : null,
    now: deps.now,
  });
  if (!profit.margin) {
    reasons.push("Marge nicht berechenbar.", ...profit.reasons);
    stages.push({ key: "profit", status: "deferred", details: profit.reasons });
    skip(["compliance", "draft"]);
    return finish("deferred", { supplier, profit: profitSummary }, scoreFinal);
  }
  if (profit.margin.marginPercent < RECOMMENDATION_RULES.watchMinMargin) {
    reasons.push(`Marge ${Math.round(profit.margin.marginPercent * 100)} % unter ${Math.round(RECOMMENDATION_RULES.watchMinMargin * 100)} %.`);
    stages.push({ key: "profit", status: "deferred", details: [...reasons, ...profit.reasons] });
    skip(["compliance", "draft"]);
    return finish("deferred", { supplier, profit: profitSummary }, scoreFinal);
  }
  stages.push({
    key: "profit",
    status: profit.reliable ? "ok" : "blocked",
    details: [`Deckungsbeitrag ${profit.margin.contribution.toFixed(2).replace(".", ",")} € (${Math.round(profit.margin.marginPercent * 100)} %).`, ...profit.reasons],
  });
  if (!profit.reliable) reasons.push("Marge nicht verlässlich berechenbar – keine automatische Freigabe.");

  // 4. Compliance – Pflichtunterlagen des Produkts gegen die Unterlagen des Angebots; Freigabe nur durch Menschen
  const required = input.query.safety.requiredDocuments ?? [];
  const documents = best.quote.safety.documents;
  const missingDocuments = required.filter((r) => !documents.some((d) => d.startsWith(r)));
  const compliance = { requiredDocuments: required, missingDocuments, status: "offen" as const };
  stages.push({
    key: "compliance",
    status: "blocked",
    details: [
      missingDocuments.length ? `Fehlende Unterlagen: ${missingDocuments.join(", ")}.` : "Unterlagen laut Angebot vorhanden – Prüfung durch Menschen ausstehend.",
      `Risiko ${RISK_LABELS[risk.level]}: ${risk.reasons.join("; ")}.`,
      "Compliance-Freigabe erteilt nur ein Mensch.",
    ],
  });
  reasons.push(
    missingDocuments.length === 0
      ? "Compliance-Freigabe durch Menschen ausstehend."
      : `Compliance offen – ${missingDocuments.length === 1 ? "1 Unterlage fehlt" : `${missingDocuments.length} Unterlagen fehlen`}.`,
  );

  // 5. Shopify-Entwurf – nur Dry-Run über die bestehende Pipeline und Guards
  const analysis = candidate.productId ? deps.analysis(candidate.productId) : undefined;
  const listing = candidate.productId ? deps.listing(candidate.productId) : undefined;
  let draft: DraftSummary;
  if (!analysis || !listing) {
    draft = NO_DRAFT("Keine Shop-Angaben (Texte, Varianten, Bilder mit Nutzungsrechten) – Entwurf nicht möglich.");
    stages.push({ key: "draft", status: "blocked", details: [draft.note] });
  } else {
    const result = evaluatePipeline(analysis, listing, "offen");
    const violations = result.steps.find((s) => s.key === "draft")?.state === "blocked" ? [result.steps.find((s) => s.key === "draft")!.detail] : [];
    draft = {
      status: result.input ? "dry_run_prepared" : "none",
      title: result.input?.title,
      handle: result.input?.handle,
      violations,
      wouldCreate: false,
      note: SAFETY_SWITCHES.shopifyWriteEnabled
        ? "Dry-Run-Entwurf vorbereitet (Status DRAFT). Anlage erst nach Compliance-Freigabe – kein zeitgesteuerter Schreibzugriff."
        : "Dry-Run-Entwurf vorbereitet (Status DRAFT). Shopify-Schreibzugriff ist gesperrt.",
    };
    stages.push({ key: "draft", status: draft.status === "dry_run_prepared" ? "ok" : "blocked", details: [draft.note, ...violations] });
  }

  return finish("blocked", { supplier, profit: profitSummary, compliance, draft }, scoreFinal);
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
  /** Uhr für das Laufende (Standard: echte Zeit). Das Dashboard übergibt eine feste Zeit – deterministisch vorrenderbar. */
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
  const clock = o.clock ?? (() => new Date());
  const done = () => ({ ...run, finishedAt: clock().toISOString(), requests: { used: budget.used, limit: budget.limit } });
  /** Nicht gemessene Themen bleiben sichtbar – als „ungeprüft“, mit Grund. */
  const unreviewed = (topic: DiscoveredTopic, why: string): CandidateResult => {
    const candidate: MarketCandidate = { key: topic.key, title: topic.title, category: topic.category, productId: topic.productId, discoveredVia: topic.discoveredVia, demo: topic.demo, signals: [] };
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

  if (!MARKET_SCAN.enabled) return { ...done(), aborted: "Market Scout ist im Code deaktiviert (MARKET_SCAN.enabled)." };
  if (o.shouldStop()) return { ...done(), aborted: "Abbruchschalter aktiv (.data/market/STOP)." };

  // Entdecken
  const found = new Map<string, { topic: DiscoveredTopic; source: MarketSource }>();
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
        if (!found.has(topic.key)) found.set(topic.key, { topic, source });
      }
    } catch (e) {
      entry.status = e instanceof BudgetExhaustedError ? "partial" : "error";
      entry.message = e instanceof Error ? e.message : String(e);
      run.errors.push(`${source.info.name}: ${entry.message}`);
    }
  }

  // Reihenfolge: bekannte Produkte zuerst, dann nie bewertete, dann am längsten nicht bewertete
  const queue = [...found.values()].sort((a, b) => {
    const pa = a.topic.productId ? 0 : 1;
    const pb = b.topic.productId ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const la = o.lastEvaluated?.get(a.topic.key) ?? "";
    const lb = o.lastEvaluated?.get(b.topic.key) ?? "";
    return la < lb ? -1 : la > lb ? 1 : a.topic.key < b.topic.key ? -1 : 1;
  });

  // Messen und bewerten
  let stopAt = queue.length;
  let stopReason = "";
  let measured = 0; // Kandidatenlimit gilt nur für Abrufe aus dem Netz (Demo-Kandidaten kosten nichts)
  for (const [index, { topic, source }] of queue.entries()) {
    if (source.info.network && measured >= maxCandidates) {
      [stopAt, stopReason] = [index, `Kandidatenlimit von ${maxCandidates} je Lauf erreicht – folgt im nächsten Lauf.`];
      run.errors.push(`Kandidatenlimit von ${maxCandidates} je Lauf erreicht – ${queue.length - index} Themen folgen im nächsten Lauf.`);
      break;
    }
    if (source.info.network) measured++;
    if (o.shouldStop()) {
      run.aborted = "Abbruchschalter während des Laufs aktiviert.";
      [stopAt, stopReason] = [index, run.aborted];
      break;
    }
    const candidate: MarketCandidate = {
      key: topic.key,
      title: topic.title,
      category: topic.category,
      productId: topic.productId,
      discoveredVia: topic.discoveredVia,
      demo: topic.demo,
      signals: [],
    };
    // Vorab prüfen, ob die Warengruppe gesperrt ist – spart Abrufe
    if (assessRisk(candidate.title, candidate.category).level !== "prohibited") {
      try {
        const signal = await source.measure(topic, budget);
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
    }
    try {
      run.results.push(evaluateCandidate(candidate, o));
    } catch (e) {
      run.errors.push(`${candidate.title}: Bewertung fehlgeschlagen – ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const { topic } of queue.slice(stopAt)) run.results.push(unreviewed(topic, stopReason));
  for (const s of run.sources) s.candidates = run.results.filter((r) => found.get(r.candidate.key)?.source.info.id === s.id).length;

  return { ...done(), aborted: run.aborted };
}
