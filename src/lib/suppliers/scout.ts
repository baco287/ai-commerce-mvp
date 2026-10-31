// Supplier Scout: fragt alle zulässigen Adapter ab und vergleicht die Angebote.
// Ergebnis ist eine Empfehlung zur menschlichen Freigabe – der Scout bestellt nichts.

import { adapterBlockReason, DEFAULT_ADAPTER_POLICY, type AdapterPolicy, type SupplierAdapter } from "./adapter";
import { compareQuotes, type SupplierComparison } from "./compare";
import type { ProductQuery, SupplierQuote } from "./model";
import { SCOUT_RULES, type ScoutRules } from "./rules";

export interface AdapterRun {
  adapterId: string;
  adapterName: string;
  status: "ok" | "blocked" | "error";
  quoteCount: number;
  message?: string;
}

export interface ScoutReport extends SupplierComparison {
  adapters: AdapterRun[];
  /** true, sobald mindestens ein Angebot aus Demo-Daten stammt */
  containsDemoData: boolean;
}

export interface ScoutOptions {
  policy?: AdapterPolicy;
  rules?: ScoutRules;
}

export async function scoutSuppliers(query: ProductQuery, adapters: SupplierAdapter[], options: ScoutOptions = {}): Promise<ScoutReport> {
  const policy = options.policy ?? DEFAULT_ADAPTER_POLICY;
  const runs: AdapterRun[] = [];
  const quotes: SupplierQuote[] = [];

  // Feste Reihenfolge nach Adapter-ID, damit das Ergebnis unabhängig von der Übergabereihenfolge ist.
  for (const adapter of [...adapters].sort((a, b) => a.info.id.localeCompare(b.info.id))) {
    const base = { adapterId: adapter.info.id, adapterName: adapter.info.name };
    const blocked = adapterBlockReason(adapter.info, policy);
    if (blocked) {
      runs.push({ ...base, status: "blocked", quoteCount: 0, message: blocked });
      continue;
    }
    try {
      const found = (await adapter.findQuotes(query)).filter((q) => q.productId === query.productId);
      // Demo-Kennzeichnung erzwingen: Angebote aus Demo-Adaptern gelten immer als Demo-Daten.
      quotes.push(...found.map((q) => (adapter.info.kind === "demo" ? { ...q, demo: true } : q)));
      runs.push({ ...base, status: "ok", quoteCount: found.length });
    } catch (err) {
      runs.push({ ...base, status: "error", quoteCount: 0, message: err instanceof Error ? err.message : String(err) });
    }
  }

  const comparison = compareQuotes(query, quotes, options.rules ?? SCOUT_RULES);
  return { ...comparison, adapters: runs, containsDemoData: quotes.some((q) => q.demo) };
}
