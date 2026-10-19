// Datenzugriff der Oberfläche. Heute: Demodaten + Berechnungen.
// Später werden hier PostgreSQL, Shopify und die Agenten-Ergebnisse angebunden –
// die Seiten selbst müssen dafür nicht geändert werden.

import { RECOMMENDATION_RULES } from "@/lib/config/assumptions";
import { demandScore } from "@/lib/calc/demand";
import { calculateMargin, variableCosts, type MarginBreakdown } from "@/lib/calc/pricing";
import { evaluateOffers, type OfferEvaluation } from "@/lib/calc/suppliers";
import { evaluateAutoPurchase, type PurchaseDecision } from "@/lib/guards/purchase";
import { DEMO_AGENTS } from "@/lib/demo/agents";
import { DEMO_ACTIVITIES, DEMO_ALERTS, DEMO_APPROVALS } from "@/lib/demo/events";
import { DEMO_DAYS, DEMO_ORDERS, DEMO_TODAY } from "@/lib/demo/orders";
import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { DEMO_OFFERS } from "@/lib/demo/suppliers";
import type { DemoOrder, Product } from "@/lib/types";

export type Recommendation = "kandidat" | "beobachten" | "verwerfen";

export interface ProductAnalysis {
  product: Product;
  demand: number;
  offers: OfferEvaluation[];
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

export function getProductAnalyses(): ProductAnalysis[] {
  return DEMO_PRODUCTS.map((product) => {
    const offers = evaluateOffers(DEMO_OFFERS.filter((o) => o.productId === product.id));
    const best = offers.find((o) => o.isBest);
    const costs = offers.map((o) => o.landedCost);
    const demand = demandScore(product.signals);
    const margin = best ? calculateMargin(product.targetPriceGross, best.landedCost) : undefined;
    return {
      product,
      demand,
      offers,
      best,
      minCost: Math.min(...costs),
      maxCost: Math.max(...costs),
      margin,
      recommendation: recommend(demand, margin),
    };
  });
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
