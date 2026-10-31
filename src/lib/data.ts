// Datenzugriff der Oberfläche. Heute: Demodaten + Berechnungen.
// Später werden hier PostgreSQL, Shopify und die Agenten-Ergebnisse angebunden –
// die Seiten selbst müssen dafür nicht geändert werden.

import { RECOMMENDATION_RULES } from "@/lib/config/assumptions";
import { demandScore } from "@/lib/calc/demand";
import { calculateMargin, variableCosts, type MarginBreakdown } from "@/lib/calc/pricing";
import type { OfferEvaluation } from "@/lib/calc/suppliers";
import { evaluateAutoPurchase, type PurchaseDecision } from "@/lib/guards/purchase";
import { DEMO_AGENTS } from "@/lib/demo/agents";
import { DEMO_ACTIVITIES, DEMO_ALERTS, DEMO_APPROVALS } from "@/lib/demo/events";
import { DEMO_DAYS, DEMO_ORDERS, DEMO_TODAY } from "@/lib/demo/orders";
import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { DEMO_LISTINGS } from "@/lib/shopify/listings";
import {
  buildSupplierLinks,
  compareQuotes,
  DEMO_ADAPTERS,
  DEMO_QUERIES,
  demoQuotesFor,
  scoutSuppliers,
  toOfferEvaluations,
  type DemoProductId,
  type ProductQuery,
  type ScoutReport,
  type SupplierComparison,
  type SupplierProductLink,
} from "@/lib/suppliers";
import { createPriceListAdapter, priceListQuotesFor, type ImportLogEntry } from "@/lib/suppliers/import";
import { loadEvidence, loadOfferStore } from "@/lib/suppliers/server/offer-store";
import {
  assessRisk,
  createDemoMarketSource,
  emptyMarketState,
  MARKET_SCAN,
  mergeRun,
  runMarketScan,
  type CandidateState,
  type EvaluationDeps,
  type RunLogEntry,
  type StoredCandidate,
} from "@/lib/market";
import { isStopRequested, loadMarketState } from "@/lib/market/server/market-store";
import type { DemoOrder, Product } from "@/lib/types";

export type Recommendation = "kandidat" | "beobachten" | "verwerfen";

export interface ProductAnalysis {
  product: Product;
  demand: number;
  /** Ergebnis des Supplier Scouts – einzige Quelle für Lieferantenangebote und deren Eignung */
  scout: SupplierComparison;
  /** Dieselben Angebote im flachen Modell (aus `scout` abgeleitet), aufsteigend nach Gesamtkosten */
  offers: OfferEvaluation[];
  /** Kalkulationsbasis: günstigster geeigneter Lieferant laut Scout */
  best?: OfferEvaluation;
  minCost: number;
  maxCost: number;
  margin?: MarginBreakdown;
  recommendation: Recommendation;
}

export function recommend(demand: number, margin?: MarginBreakdown): Recommendation {
  if (!margin) return "verwerfen";
  if (margin.marginPercent >= RECOMMENDATION_RULES.candidateMinMargin && demand >= RECOMMENDATION_RULES.candidateMinDemand) {
    return "kandidat";
  }
  if (margin.marginPercent >= RECOMMENDATION_RULES.watchMinMargin) return "beobachten";
  return "verwerfen";
}

/** Scout-Suchanfrage eines Demo-Produkts. */
export function supplierQueryFor(productId: string): ProductQuery {
  const query = (DEMO_QUERIES as Record<string, ProductQuery>)[productId];
  if (!query) throw new Error(`Keine Lieferanten-Suchanfrage für ${productId}`);
  return query;
}

/** Lokal importierte Preislisten und Nachweise (leer, solange nichts importiert wurde). */
function importedSupplierData() {
  const { store } = loadOfferStore();
  const { entries } = loadEvidence();
  return { store, evidence: entries };
}

export function getProductAnalyses(): ProductAnalysis[] {
  const imported = importedSupplierData();
  return DEMO_PRODUCTS.map((product) => {
    // Synchroner Vergleich über dieselben Angebote, die auch die Adapter liefern (Demo + importierte Preislisten).
    const query = supplierQueryFor(product.id);
    const scout = compareQuotes(query, [...demoQuotesFor(product.id), ...priceListQuotesFor(imported.store, query, imported.evidence)]);
    const offers = toOfferEvaluations(scout);
    const best = offers.find((o) => o.isBest);
    const costs = offers.map((o) => o.landedCost).filter(Number.isFinite);
    const demand = demandScore(product.signals);
    const margin = best ? calculateMargin(product.targetPriceGross, best.landedCost) : undefined;
    return {
      product,
      demand,
      scout,
      offers,
      best,
      minCost: Math.min(...costs),
      maxCost: Math.max(...costs),
      margin,
      recommendation: recommend(demand, margin),
    };
  });
}

/**
 * Vollständiger Scout-Lauf je Demo-Produkt über die Demo-Adapter (inkl. Adapter-Status).
 * Kein Netzwerk, keine Kosten, keine Bestellungen.
 */
export async function getSupplierScoutReports(): Promise<{ product: Product; report: ScoutReport }[]> {
  const imported = importedSupplierData();
  const adapters = [...DEMO_ADAPTERS, createPriceListAdapter(imported.store, imported.evidence)];
  return Promise.all(DEMO_PRODUCTS.map(async (product) => ({ product, report: await scoutSuppliers(supplierQueryFor(product.id), adapters) })));
}

export interface SupplierImportStatus {
  offers: number;
  /** davon synthetische Testdaten */
  synthetic: number;
  /** Angebote ohne Zuordnung zu einem Produkt (keine oder unbekannte GTIN) */
  unassigned: number;
  lastImport: ImportLogEntry | null;
  evidenceEntries: number;
  errors: string[];
}

/** Stand der lokal importierten Preislisten für die Anzeige (ohne Preise oder Konditionen). */
export function getSupplierImportStatus(): SupplierImportStatus {
  const { store, error } = loadOfferStore();
  const evidence = loadEvidence();
  const gtins = new Set(Object.values(DEMO_QUERIES).map((q) => q.gtin));
  const offers = Object.values(store.offers);
  return {
    offers: offers.length,
    synthetic: offers.filter((o) => o.provenance.synthetic).length,
    unassigned: offers.filter((o) => !o.data.gtin || !gtins.has(o.data.gtin)).length,
    lastImport: store.imports.at(-1) ?? null,
    evidenceEntries: evidence.entries.length,
    errors: [...(error ? [error] : []), ...evidence.errors],
  };
}

/** Kopplung Produkt ↔ Scout ↔ Shopify-Listing (Handle, Varianten, Angebots-ID der Kalkulationsbasis). */
export function getSupplierLinks(): SupplierProductLink[] {
  const analyses = getProductAnalyses();
  return buildSupplierLinks({
    products: DEMO_PRODUCTS,
    queries: DEMO_QUERIES,
    listings: DEMO_LISTINGS,
    calculationBasis: Object.fromEntries(analyses.map((a) => [a.product.id, a.best?.offer.id])),
  });
}

export type { DemoProductId };

/**
 * Verbindet den Market Scout mit den vorhandenen Bausteinen: Supplier Scout (Demo-Angebote + importierte Preislisten),
 * Produktanalyse (für den Profit Check und den Shopify-Dry-Run) und Shopify-Listings. Keine eigene Logik.
 */
export function marketEvaluationDeps(now: Date): EvaluationDeps {
  const imported = importedSupplierData();
  const analyses = new Map(getProductAnalyses().map((a) => [a.product.id, a]));
  const queries = DEMO_QUERIES as Record<string, ProductQuery>;
  return {
    now,
    supplierInput(candidate) {
      if (candidate.productId && queries[candidate.productId]) {
        const query = supplierQueryFor(candidate.productId);
        return { query, quotes: [...demoQuotesFor(candidate.productId), ...priceListQuotesFor(imported.store, query, imported.evidence)] };
      }
      // Ohne bekanntes Produkt nur mit GTIN – sonst kann der Supplier Scout Angebote nicht sicher zuordnen.
      if (!candidate.gtin) return null;
      const query: ProductQuery = {
        productId: candidate.key,
        title: candidate.title,
        gtin: candidate.gtin,
        quantity: 1,
        destinationCountry: "DE",
        safety: { ceRequired: assessRisk(candidate.title, candidate.category).level === "high" },
      };
      return { query, quotes: priceListQuotesFor(imported.store, query, imported.evidence) };
    },
    product: (id) => DEMO_PRODUCTS.find((p) => p.id === id),
    analysis: (id) => analyses.get(id),
    listing: (id) => DEMO_LISTINGS.find((l) => l.productId === id),
  };
}

export interface MarketScoutOverview {
  /** stored = gespeicherter Stand aus `npm run market:scan -- --save`; demo = jetzt aus der Demo-Quelle berechnet */
  origin: "stored" | "demo";
  candidates: StoredCandidate[];
  lastRun: RunLogEntry | null;
  runs: RunLogEntry[];
  stopRequested: boolean;
  enabled: boolean;
  limits: { maxRequestsPerRun: number; maxCandidatesPerRun: number; maxCostEurPerRun: number };
  errors: string[];
}

const STATE_ORDER: CandidateState[] = ["draft_created", "approved", "blocked", "deferred", "unreviewed"];

/**
 * Stand des Market Scout für das Dashboard. Ohne gespeicherten Lauf: Vorschau mit der Demo-Quelle (gekennzeichnet).
 * Bewusst ohne aktuelle Uhrzeit: Die Vorschau rechnet mit dem festen Demo-Datum, damit die Seite vorrenderbar bleibt.
 */
export async function getMarketScoutOverview(now = new Date(`${DEMO_TODAY}T12:00:00Z`)): Promise<MarketScoutOverview> {
  const loaded = loadMarketState();
  let state = loaded.state;
  let origin: MarketScoutOverview["origin"] = "stored";
  if (state.runs.length === 0) {
    origin = "demo";
    const run = await runMarketScan({
      ...marketEvaluationDeps(now),
      runId: "demo-vorschau",
      sources: [createDemoMarketSource(now)],
      allowNetwork: false,
      shouldStop: () => false,
      clock: () => now,
    });
    state = mergeRun(emptyMarketState(), run);
  }
  // Echte Kandidaten vor Demo-Kandidaten, dann nach Zustand und Bewertung
  const candidates = Object.values(state.candidates).sort(
    (a, b) =>
      Number(a.latest.candidate.demo) - Number(b.latest.candidate.demo) ||
      STATE_ORDER.indexOf(a.latest.state) - STATE_ORDER.indexOf(b.latest.state) ||
      b.latest.score.score - a.latest.score.score,
  );
  return {
    origin,
    candidates,
    lastRun: state.runs.at(-1) ?? null,
    runs: state.runs.slice(-5).reverse(),
    stopRequested: isStopRequested(),
    enabled: MARKET_SCAN.enabled,
    limits: { maxRequestsPerRun: MARKET_SCAN.maxRequestsPerRun, maxCandidatesPerRun: MARKET_SCAN.maxCandidatesPerRun, maxCostEurPerRun: MARKET_SCAN.maxCostEurPerRun },
    errors: loaded.error ? [loaded.error] : [],
  };
}

export interface OrderRow {
  order: DemoOrder;
  product: Product;
  margin?: MarginBreakdown;
  supplierName?: string;
  purchase: PurchaseDecision;
}

/** Alle Demo-Bestellungen, neueste zuerst, inkl. simulierter Einkaufsprüfung. */
export function getOrderRows(): OrderRow[] {
  const analyses = new Map(getProductAnalyses().map((a) => [a.product.id, a]));
  return DEMO_ORDERS.map((order) => {
    const a = analyses.get(order.productId)!;
    const purchase = evaluateAutoPurchase({
      paymentStatus: order.paymentStatus,
      supplierCost: (a.best?.landedCost ?? 0) * order.quantity,
      supplierPaymentTerms: a.best?.offer.paymentTerms ?? "vorkasse",
      creditLineAvailable: 0,
      expectedContribution: (a.margin?.contribution ?? 0) * order.quantity,
    });
    return { order, product: a.product, margin: a.margin, supplierName: a.best?.offer.supplierName, purchase };
  }).reverse();
}

export interface DailyPoint {
  day: string;
  revenue: number;
  profit: number;
  orders: number;
}

export function getDashboardMetrics() {
  const rows = getOrderRows();
  let revenue = 0;
  let profit = 0;
  let costs = 0;
  let vat = 0;
  let units = 0;

  const days = new Map<string, DailyPoint>();
  const end = new Date(`${DEMO_TODAY}T12:00:00Z`);
  for (let i = DEMO_DAYS - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.set(key, { day: key, revenue: 0, profit: 0, orders: 0 });
  }

  for (const { order, margin } of rows) {
    const gross = order.priceGross * order.quantity;
    const contribution = (margin?.contribution ?? 0) * order.quantity;
    revenue += gross;
    profit += contribution;
    costs += margin ? variableCosts(margin) * order.quantity : 0;
    vat += (margin?.vat ?? 0) * order.quantity;
    units += order.quantity;

    const point = days.get(order.createdAt.slice(0, 10));
    if (point) {
      point.revenue += gross;
      point.profit += contribution;
      point.orders += 1;
    }
  }

  return {
    revenue,
    profit,
    costs,
    vat,
    orders: rows.length,
    units,
    blockedPurchases: rows.filter((r) => !r.purchase.allowed).length,
    awaitingPayment: rows.filter((r) => r.order.paymentStatus === "pending" || r.order.paymentStatus === "authorized").length,
    daily: [...days.values()],
    recentOrders: rows.slice(0, 6),
  };
}

export const getAgents = () => DEMO_AGENTS;
export const getActivities = () => DEMO_ACTIVITIES;
export const getAlerts = () => DEMO_ALERTS;
export const getApprovals = () => DEMO_APPROVALS;

/** Name zur Agenten-ID für Aktivitäten und Freigaben. */
export function agentName(id: string): string {
  if (id === "system") return "System";
  return DEMO_AGENTS.find((a) => a.id === id)?.name ?? id;
}
