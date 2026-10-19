// Zentrale Domänentypen der KI-Kontrollzentrale.
// Alle Werte im MVP stammen aus src/lib/demo und sind simuliert.

export type Region = "CN" | "EU" | "DE";

export interface DemandSignals {
  /** Suchinteresse-Trend, 0–100 (simuliert) */
  searchTrend: number;
  /** Erwähnungen in Social Media, 0–100 (simuliert) */
  socialBuzz: number;
  /** Wettbewerbsdichte, 0–100 – höher = mehr Konkurrenz (simuliert) */
  competition: number;
  /** Saisonale Passung für die nächsten Wochen, 0–100 (simuliert) */
  seasonality: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  /** Geplanter Verkaufspreis inkl. MwSt. in EUR */
  targetPriceGross: number;
  signals: DemandSignals;
  /** Punkte, die vor einem Verkauf rechtlich/fachlich geprüft werden müssen */
  complianceNotes: string[];
}

export type PaymentTerms = "vorkasse" | "netto14" | "netto30";

export interface SupplierOffer {
  id: string;
  productId: string;
  supplierName: string;
  region: Region;
  warehouse: string;
  unitPrice: number;
  shippingCost: number;
  /** Geschätzte Zoll-/Importnebenkosten (nur außerhalb der EU) */
  importCost: number;
  deliveryDaysMin: number;
  deliveryDaysMax: number;
  /** Bewertung 1–5 (simuliert) */
  rating: number;
  stock: number;
  paymentTerms: PaymentTerms;
}

export type AgentStatus = "active" | "paused";

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  status: AgentStatus;
  pauseReason?: string;
  lastRun: string;
  nextRun?: string;
  runsToday: number;
  /** Was der Agent im Demo-Modus selbstständig darf */
  allowedActions: string[];
  /** Was immer eine menschliche Freigabe braucht */
  approvalRequired: string[];
}

export type Severity = "info" | "warning" | "critical";

export interface SystemAlert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface ActivityEvent {
  id: string;
  at: string;
  agentId: string;
  message: string;
  kind: "analysis" | "calculation" | "system" | "blocked";
}

export type ApprovalKind = "product_listing" | "ad_budget" | "supplier_change" | "purchase";

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  requestedBy: string;
  amount?: number;
  /** Wenn gesetzt, kann die Anfrage im MVP grundsätzlich nicht freigegeben werden */
  lockedReason?: string;
}

/**
 * Zahlungsstatus einer Kundenbestellung:
 * pending = offen, authorized = reserviert, captured = eingezogen,
 * paid_out = vom Zahlungsanbieter an uns ausgezahlt.
 */
export type PaymentStatus = "pending" | "authorized" | "captured" | "paid_out";

export interface DemoOrder {
  id: string;
  createdAt: string;
  productId: string;
  quantity: number;
  priceGross: number;
  paymentStatus: PaymentStatus;
}
