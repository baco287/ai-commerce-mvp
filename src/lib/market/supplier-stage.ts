// Supplier-Stufe der Market-Pipeline: Varianten-Identität → Angebote → Vergleich je Variante → EINE Kalkulationsbasis.
//
// Keine eigene Fachlogik: Der Vergleich ist compareQuotes, die Basisauswahl selectCalculationBasis (Liquidität vor
// Preis, Worst-Case-Auszahlung), die Zuordnung der Katalogvarianten matchVariant (über den Preislisten-Adapter).
// Echte Kandidaten nehmen nie Demo-Angebote. Rein und deterministisch.

import {
  compareQuotes,
  DEFAULT_FUNDING_CONTEXT,
  selectCalculationBasis,
  type BasisCandidate,
  type FundingContext,
  type LiquidityAssessment,
  type LiquidityStatus,
  type ProductQuery,
  type SupplierComparison,
  type SupplierQuote,
  type VariantMatch,
} from "@/lib/suppliers";
import type { MarketCandidate } from "./model";
import type { ReasonCode } from "./reasons";

/** Angebote zu einer Variante (Katalog) – mit dem Ergebnis der Zuordnung. */
export interface VariantSupplierInput {
  shopSku: string;
  optionValue?: string;
  query: ProductQuery;
  /** Nur die zugeordneten Angebote (bei fehlender Zuordnung leer) */
  quotes: SupplierQuote[];
  match: VariantMatch;
}

/**
 * Eingabe der Supplier-Stufe:
 * - Produktebene (Demo-Produkte, Abfragen mit GTIN): eine Abfrage für alle Listing-Varianten
 * - je Variante (Katalogprodukte): Abfrage, Zuordnung und Angebote je Katalogvariante
 */
export type SupplierInput = { query: ProductQuery; quotes: SupplierQuote[] } | { variants: VariantSupplierInput[] };

export interface VariantSupplierResult {
  shopSku: string;
  optionValue?: string;
  query: ProductQuery;
  match: VariantMatch;
  /** null, wenn die Zuordnung scheiterte */
  comparison: SupplierComparison | null;
}

export interface SupplierStageResult {
  status: "ok" | "deferred";
  codes: ReasonCode[];
  /** Gründe für den Kandidatenzustand (ohne Beträge) */
  reasons: string[];
  /** Stufentexte (inkl. Ausschlussgründe, höchstens 5) */
  details: string[];
  variants: VariantSupplierResult[];
  /** Aus selectCalculationBasis – null, wenn die Stufe zurückstellt */
  basis: BasisCandidate | null;
  /** Derselbe Aufruf; wird in Stufe 3 weiterverwendet und nicht neu gerechnet */
  liquidity: LiquidityAssessment | null;
  /** Alle Lieferanten, die jede Variante abdecken, mit Liquiditätsstatus (Rangfolge) */
  considered: { supplierId: string; status: LiquidityStatus }[];
  /** Nicht berücksichtigte Demo-Angebote (nur bei echten Kandidaten) */
  ignoredDemo: number;
}

/** Varianten der Eingabe; Produktebene = eine „Variante“ für alle Listing-Varianten. */
export function supplierVariantsOf(input: SupplierInput, candidate: MarketCandidate): VariantSupplierInput[] {
  if ("variants" in input) return input.variants;
  return [
    {
      shopSku: candidate.productId ?? candidate.key,
      query: input.query,
      quotes: input.quotes,
      // Demo-Produkte: eine Abfrage auf Produktebene für alle Listing-Varianten; sonst nur über die GTIN der Abfrage
      match: { status: "matched", basis: candidate.demo ? "demo_product_level" : "gtin", offerKeys: [], hints: [] },
    },
  ];
}

const variantName = (v: { shopSku: string; optionValue?: string }) => (v.optionValue ? `${v.optionValue} (${v.shopSku})` : v.shopSku);

/**
 * `priceGross` (Verkaufspreis brutto, falls bekannt) geht nur in die Liquiditätsbewertung der Basis ein
 * (Erstattungsrisiko, Kapazität) – so rechnet Stufe 3 sie nicht neu.
 */
export function runSupplierStage(
  input: SupplierInput,
  candidate: MarketCandidate,
  ctx: FundingContext = DEFAULT_FUNDING_CONTEXT,
  priceGross: number | null = null,
): SupplierStageResult {
  const inputs = supplierVariantsOf(input, candidate);
  const multi = inputs.length > 1;
  const codes: ReasonCode[] = [];
  const reasons: string[] = [];
  const details: string[] = [];
  let ignoredDemo = 0;
  const variants: VariantSupplierResult[] = inputs.map((v) => {
    const base = { shopSku: v.shopSku, ...(v.optionValue !== undefined && { optionValue: v.optionValue }), query: v.query, match: v.match };
    if (v.match.status !== "matched") return { ...base, comparison: null };
    // Echte Kandidaten nie mit Demo-Lieferanten
    const quotes = candidate.demo ? v.quotes : v.quotes.filter((q) => !q.demo);
    ignoredDemo += v.quotes.length - quotes.length;
    return { ...base, comparison: compareQuotes(v.query, quotes) };
  });

  const result = (status: SupplierStageResult["status"], extra: Partial<SupplierStageResult> = {}): SupplierStageResult => ({
    status,
    codes: [...new Set(codes)],
    reasons,
    details,
    variants,
    basis: null,
    liquidity: null,
    considered: [],
    ignoredDemo,
    ...extra,
  });

  if (variants.length === 0) {
    codes.push("IDENTITY_MISSING");
    reasons.push("Keine Varianten mit Produktidentität – der Supplier Scout kann keine Angebote sicher zuordnen.");
    details.push(...reasons);
    return result("deferred");
  }

  // 1. Zuordnung je Variante
  for (const v of variants) {
    if (v.match.status === "matched") {
      details.push(...v.match.hints.map((h) => (multi ? `${variantName(v)}: ${h}` : h)));
      continue;
    }
    codes.push(v.match.code);
    const text = `${multi ? `${variantName(v)}: ` : ""}${v.match.message}`;
    reasons.push(text);
    details.push(text);
  }
  if (codes.length > 0) return result("deferred");

  // 2. Angebote je Variante
  const exclusions = new Set<string>();
  for (const v of variants) {
    const c = v.comparison!;
    const total = c.eligible.length + c.excluded.length;
    const prefix = multi ? `${variantName(v)}: ` : "";
    if (total === 0) {
      codes.push("SUPPLIER_NONE");
      reasons.push(`${prefix}Keine Lieferantenangebote zu dieser Produktidentität.`);
    } else if (c.eligible.length === 0) {
      codes.push("SUPPLIER_ALL_EXCLUDED");
      reasons.push(`${prefix}Kein geeigneter Lieferant (${total} Angebote geprüft, alle ausgeschlossen).`);
      for (const e of c.excluded) for (const x of e.eligibility.exclusions) exclusions.add(x.message);
    }
  }
  if (ignoredDemo > 0) reasons.push(`${ignoredDemo} Demo-Angebote nicht berücksichtigt – fiktive Lieferanten zählen nie für echte Kandidaten.`);
  if (codes.length > 0) {
    details.push(...reasons, ...[...exclusions].slice(0, 5));
    return result("deferred");
  }

  // 3. Eine Kalkulationsbasis über alle Varianten (Liquidität vor Preis)
  const selection = selectCalculationBasis(
    variants.map((v) => ({ shopSku: v.shopSku, comparison: v.comparison! })),
    ctx,
    undefined,
    priceGross,
  );
  if (!selection.basis) {
    codes.push("SUPPLIER_VARIANTS_INCOMPLETE");
    reasons.push("Kein Lieferant deckt alle Varianten mit einem geeigneten Angebot ab – verschiedene Lieferanten je Variante sind nicht vorgesehen.");
    details.push(...reasons);
    return result("deferred", { considered: selection.considered });
  }
  return result("ok", { basis: selection.basis, liquidity: selection.liquidity, considered: selection.considered });
}
