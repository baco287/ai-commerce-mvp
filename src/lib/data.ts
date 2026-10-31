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
  isDemoGtin,
  sameGtin,
  scoutSuppliers,
  toOfferEvaluations,
  type DemoProductId,
  type ProductQuery,
  type ScoutReport,
  type SupplierComparison,
  type SupplierProductLink,
} from "@/lib/suppliers";
import { createPriceListAdapter, priceListQuotesFor, priceListVariantQuotes, type ImportLogEntry } from "@/lib/suppliers/import";
import { loadEvidence, loadOfferStore } from "@/lib/suppliers/server/offer-store";
import {
  assessRisk,
  catalogVariantQueries,
  createDemoMarketSource,
  emptyMarketState,
  MARKET_SCAN,
  mergeRun,
  runMarketScan,
  type CandidateState,
  type CatalogProduct,
  type EvaluationDeps,
  type MarketSignal,
  type RunLogEntry,
  type StoredCandidate,
} from "@/lib/market";
import { loadCatalog } from "@/lib/market/server/catalog-store";
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
    // Demo-Weg (allowReal: false): nur synthetische Preislistenzeilen – echte Zeilen erreichen Demo-Produkte nie.
    const scout = compareQuotes(query, [...demoQuotesFor(product.id), ...priceListQuotesFor(imported.store, query, imported.evidence, { allowReal: false })]);
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
  const adapters = [...DEMO_ADAPTERS, createPriceListAdapter(imported.store, imported.evidence, { allowReal: false })];
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

/**
 * Stand der lokal importierten Preislisten für die Anzeige (ohne Preise oder Konditionen).
 * Zuordnung getrennt nach Weg (Paket I): Synthetische Testdaten zählen als zugeordnet, wenn sie eine Demo-GTIN tragen;
 * echte Zeilen nur über den lokalen Zielproduktkatalog (global eindeutige GTIN oder ausdrücklich genannter
 * Angebots-Schlüssel einer Katalogvariante) – nie über Demo-GTINs. Gezählt wird nur, gelesen wird nichts weiter.
 */
export function getSupplierImportStatus(now: Date = new Date()): SupplierImportStatus {
  const { store, error } = loadOfferStore();
  const evidence = loadEvidence();
  const offers = Object.values(store.offers);
  const realOffers = offers.some((o) => o.provenance.synthetic !== true);
  const variants = realOffers ? loadCatalog(now).products.flatMap((p) => p.variants) : [];
  const assigned = (o: (typeof offers)[number]) =>
    o.provenance.synthetic === true
      ? isDemoGtin(o.data.gtin)
      : variants.some((v) => (v.gtin !== undefined && sameGtin(v.gtin, o.data.gtin)) || (v.supplierOffers ?? []).includes(o.key));
  return {
    offers: offers.length,
    synthetic: offers.filter((o) => o.provenance.synthetic).length,
    unassigned: offers.filter((o) => !assigned(o)).length,
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
 * Demo-Zielpreise, Shop-Angaben für den Store Manager (Demo-Listings bzw. Katalogprodukte). Keine eigene Logik.
 * - `catalog`: gültige Produkte des lokalen Zielproduktkatalogs (nur der Befehl `market:scan` lädt ihn, nie das Dashboard)
 * - `cachedSignals`: zwischengespeicherte Nachfragesignale (ebenfalls nur `market:scan`)
 *
 * Getrennte Wege für Preislisten: Demo-Produkte bekommen nur synthetische Angebote (`allowReal: false`), echte
 * Kandidaten nur echte (`allowReal: true`) – eine echte Preislistenzeile erreicht so nie ein Demo-Produkt.
 */
export function marketEvaluationDeps(now: Date, opts: { catalog?: readonly CatalogProduct[]; cachedSignals?: Map<string, MarketSignal[]> } = {}): EvaluationDeps {
  const imported = importedSupplierData();
  const queries = DEMO_QUERIES as Record<string, ProductQuery>;
  const catalog = new Map((opts.catalog ?? []).map((p) => [p.id, p]));
  return {
    now,
    supplierInput(candidate) {
      if (candidate.productId && queries[candidate.productId]) {
        // Ein echtes Thema, das nur mit einem Demo-Produkt verknüpft ist, hat keine echte Identität (Pipeline: IDENTITY_MISSING).
        if (!candidate.demo) return null;
        const query = supplierQueryFor(candidate.productId);
        return { query, quotes: [...demoQuotesFor(candidate.productId), ...priceListQuotesFor(imported.store, query, imported.evidence, { allowReal: false })] };
      }
      // Katalogprodukt: je Variante Zuordnung über GTIN bzw. Artikelnummer + MPN/Variantenkennung (nur echte Angebote)
      const product = !candidate.demo && candidate.catalogId ? catalog.get(candidate.catalogId) : undefined;
      if (product) {
        return {
          variants: catalogVariantQueries(product).map(({ variant, query }) => ({
            shopSku: variant.shopSku,
            ...(variant.optionValue !== undefined && { optionValue: variant.optionValue }),
            query,
            ...priceListVariantQuotes(imported.store, query, imported.evidence, variant),
          })),
        };
      }
      // Ohne bekanntes Produkt nur mit GTIN – sonst kann der Supplier Scout Angebote nicht sicher zuordnen.
      if (candidate.demo || !candidate.gtin) return null;
      const query: ProductQuery = {
        productId: candidate.key,
        title: candidate.title,
        gtin: candidate.gtin,
        quantity: 1,
        destinationCountry: "DE",
        safety: { ceRequired: assessRisk(candidate.title, candidate.category).level === "high" },
      };
      return { query, quotes: priceListQuotesFor(imported.store, query, imported.evidence, { allowReal: true }) };
    },
    // Nur Katalogprodukte haben einen echten Verkaufspreis (Planwert oder Marktbeobachtung); Demo nutzt den Zielpreis.
    salePrice: (candidate) => (!candidate.demo && candidate.catalogId ? (catalog.get(candidate.catalogId)?.salePrice ?? null) : null),
    product: (id) => DEMO_PRODUCTS.find((p) => p.id === id),
    // Shop-Angaben für den Store Manager: Demo-Kandidaten das Demo-Listing, echte nur ihr Katalogprodukt (nie gemischt)
    draftSource(candidate) {
      if (candidate.demo) {
        const demoListing = candidate.productId ? DEMO_LISTINGS.find((l) => l.productId === candidate.productId) : undefined;
        return demoListing ? { demoListing } : null;
      }
      const product = candidate.catalogId ? catalog.get(candidate.catalogId) : undefined;
      return product ? { catalog: product } : null;
    },
    cachedSignal: (key) => opts.cachedSignals?.get(key) ?? [],
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

const STATE_ORDER: CandidateState[] = ["draft_created", "approved", "review_ready", "blocked", "deferred", "unreviewed"];

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
