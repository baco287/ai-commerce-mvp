// Marktquellen des Market Scout: einheitliche Schnittstelle, Abrufbudget, reale und Demo-Quelle.
// Netzwerk gibt es hier nicht: Reale Quellen bekommen die Abruffunktion von außen (server/wikimedia-client.ts).

import { DEMO_PRODUCTS } from "@/lib/demo/products";
import { interestMetrics } from "./interest";
import type { MarketSignal, MarketSourceInfo } from "./model";
import {
  articleUrl,
  categoryMembersUrl,
  pageviewsUrl,
  parseCategoryMembers,
  parsePageviews,
  requestWindow,
  rotationPrefix,
  WIKI_PROJECT,
  WIKIMEDIA_SOURCE,
} from "./wikimedia";

/** Zählt Abrufe je Lauf. Ist das Limit erreicht, wird kein weiterer Abruf gestartet. */
export class RequestBudget {
  used = 0;
  constructor(readonly limit: number) {}
  get remaining() {
    return Math.max(0, this.limit - this.used);
  }
  take(): void {
    if (this.used >= this.limit) throw new BudgetExhaustedError(this.limit);
    this.used++;
  }
}

export class BudgetExhaustedError extends Error {
  constructor(limit: number) {
    super(`Abruflimit von ${limit} Anfragen je Lauf erreicht.`);
    this.name = "BudgetExhaustedError";
  }
}

/** HTTP-Fehler einer Quelle (ohne Inhalte der Antwort, ohne Zugangsdaten). */
export class SourceHttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} bei ${new URL(url).host}`);
    this.name = "SourceHttpError";
  }
}

/** Abruf einer JSON-Adresse. Implementiert nur serverseitig; in Tests durch eine Attrappe ersetzt. */
export type FetchJson = (url: string) => Promise<unknown>;

export interface DiscoveredTopic {
  key: string;
  title: string;
  category?: string;
  productId?: string;
  discoveredVia: string;
  demo: boolean;
}

export interface MarketSource {
  readonly info: MarketSourceInfo;
  /** Findet Themen, die gemessen werden sollen */
  discover(budget: RequestBudget): Promise<DiscoveredTopic[]>;
  /** Misst ein Thema. null = die Quelle hat dazu keine Daten (z. B. Artikel existiert nicht). */
  measure(topic: DiscoveredTopic, budget: RequestBudget): Promise<MarketSignal | null>;
}

export const wikiKey = (title: string) => `wiki:${WIKI_PROJECT}:${title.trim().replaceAll(" ", "_")}`;

/**
 * Grobe Regel, ob ein Artikeltitel ein Produkttyp sein kann (dokumentierte Heuristik, keine Bewertung):
 * keine Listen, keine Klammerzusätze (Begriffsklärung, Firma, Werk), höchstens vier Wörter.
 */
export function isProductLikeTitle(title: string): boolean {
  if (/^(Liste|Listen|Geschichte|Kategorie)\b/i.test(title)) return false;
  if (title.includes("(")) return false;
  return title.trim().split(/\s+/).length <= 4;
}

export interface WikimediaSourceOptions {
  fetchJson: FetchJson;
  now: Date;
  categories: readonly string[];
  linkedTopics: { title: string; productId: string }[];
  membersPerCategory: number;
}

/** Reale Quelle: Wikipedia-Kategorien für die Entdeckung, Pageviews-Zeitreihen für die Messung. */
export function createWikimediaSource(o: WikimediaSourceOptions): MarketSource {
  const window = requestWindow(o.now);
  return {
    info: WIKIMEDIA_SOURCE,
    async discover(budget) {
      const topics = new Map<string, DiscoveredTopic>();
      for (const t of o.linkedTopics) {
        topics.set(wikiKey(t.title), { key: wikiKey(t.title), title: t.title, productId: t.productId, discoveredVia: "Feste Themenliste (bekanntes Produkt)", demo: false });
      }
      for (const [index, category] of o.categories.entries()) {
        budget.take();
        const titles = parseCategoryMembers(await o.fetchJson(categoryMembersUrl(category, o.membersPerCategory, rotationPrefix(o.now, index))));
        for (const title of titles) {
          // Der Übersichtsartikel einer Kategorie („Haushaltsgerät“) ist kein Produkt; Listen, Firmen u. Ä. auch nicht.
          if (title === category || !isProductLikeTitle(title)) continue;
          const key = wikiKey(title);
          if (!topics.has(key)) topics.set(key, { key, title, category, discoveredVia: `Wikipedia-Kategorie „${category}“`, demo: false });
        }
      }
      return [...topics.values()];
    },
    async measure(topic, budget) {
      budget.take();
      const url = pageviewsUrl(topic.title, window);
      let json: unknown;
      try {
        json = await o.fetchJson(url);
      } catch (e) {
        if (e instanceof SourceHttpError && e.status === 404) return null;
        throw e;
      }
      return {
        sourceId: WIKIMEDIA_SOURCE.id,
        sourceName: WIKIMEDIA_SOURCE.name,
        kind: "public_interest",
        demo: false,
        retrievedAt: o.now.toISOString(),
        reference: articleUrl(topic.title),
        interest: interestMetrics(parsePageviews(json, window)),
      };
    },
  };
}

export const DEMO_MARKET_SOURCE_INFO: MarketSourceInfo = {
  id: "demo-signals",
  name: "Demo-Signale (simuliert, src/lib/demo/products.ts)",
  kind: "demo",
  signalKind: "simulated",
  paid: false,
  network: false,
};

/** Demo-Quelle: die simulierten Signale der fünf Demo-Produkte. Nie Grundlage für echte Entscheidungen. */
export function createDemoMarketSource(now: Date): MarketSource {
  return {
    info: DEMO_MARKET_SOURCE_INFO,
    async discover() {
      return DEMO_PRODUCTS.map((p) => ({
        key: `demo:${p.id}`,
        title: p.name,
        category: p.category,
        productId: p.id,
        discoveredVia: "Demo-Produktliste",
        demo: true,
      }));
    },
    async measure(topic) {
      const product = DEMO_PRODUCTS.find((p) => p.id === topic.productId);
      if (!product) return null;
      return {
        sourceId: DEMO_MARKET_SOURCE_INFO.id,
        sourceName: DEMO_MARKET_SOURCE_INFO.name,
        kind: "simulated",
        demo: true,
        retrievedAt: now.toISOString(),
        reference: "src/lib/demo/products.ts",
        simulated: { ...product.signals },
      };
    },
  };
}
