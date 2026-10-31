// Marktquellen des Market Scout: einheitliche Schnittstelle, Abrufbudget, reale und Demo-Quelle.
// Netzwerk gibt es hier nicht: Reale Quellen bekommen die Abruffunktion von außen (server/wikimedia-client.ts).

import { DEMO_PRODUCTS } from "@/lib/demo/products";
import type { CatalogValidation } from "./catalog";
import { interestMetrics } from "./interest";
import type { MarketSignal, MarketSourceInfo } from "./model";
import type { ReasonCode } from "./reasons";
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
  /** Produkt des lokalen Zielproduktkatalogs */
  catalogId?: string;
  discoveredVia: string;
  demo: boolean;
  /** Ungültiger Katalogeintrag: wird nicht gemessen und nicht bewertet, sondern mit diesen Gründen zurückgestellt */
  invalid?: { codes: ReasonCode[]; messages: string[] };
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
  /**
   * Feste Themen mit Verknüpfung – genau eines von `productId` (bekanntes Produkt der Kontrollzentrale) oder
   * `catalogId` (Zielproduktkatalog, Titel = `wikiTitle`). Bei gleichem Artikel hat die Katalogverknüpfung Vorrang;
   * mehrere Katalogprodukte mit demselben Artikel: das erste gewinnt.
   */
  linkedTopics: { title: string; productId?: string; catalogId?: string }[];
  membersPerCategory: number;
}

/** Reale Quelle: Wikipedia-Kategorien für die Entdeckung, Pageviews-Zeitreihen für die Messung. */
export function createWikimediaSource(o: WikimediaSourceOptions): MarketSource {
  for (const t of o.linkedTopics) {
    if (!t.productId === !t.catalogId) throw new Error(`Festes Thema „${t.title}“: genau eines von productId oder catalogId angeben.`);
  }
  const window = requestWindow(o.now);
  return {
    info: WIKIMEDIA_SOURCE,
    async discover(budget) {
      const topics = new Map<string, DiscoveredTopic>();
      for (const t of o.linkedTopics) {
        const key = wikiKey(t.title);
        if (topics.get(key)?.catalogId) continue;
        topics.set(
          key,
          t.catalogId
            ? { key, title: t.title, catalogId: t.catalogId, discoveredVia: "Wikipedia-Artikel zum Katalogprodukt", demo: false }
            : { key, title: t.title, productId: t.productId, discoveredVia: "Feste Themenliste (bekanntes Produkt)", demo: false },
        );
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

export const CATALOG_MARKET_SOURCE_INFO: MarketSourceInfo = {
  id: "catalog",
  name: "Lokaler Zielproduktkatalog (.data/catalog/products.json)",
  kind: "manual",
  signalKind: "estimate",
  paid: false,
  network: false,
};

/**
 * Katalog-Quelle (offline): jedes Katalogprodukt wird ein Kandidat `catalog:<id>`. Der Katalog ist KEIN
 * Nachfragesignal – `measure` liefert immer null; Nachfrage kommt aus Wikimedia (`wikiTitle`, nur --live) oder
 * aus dem zwischengespeicherten Signal. Ungültige Einträge erscheinen mit Grund, werden aber nicht bewertet.
 */
export function createCatalogMarketSource(catalog: Pick<CatalogValidation, "products" | "invalid">): MarketSource {
  return {
    info: CATALOG_MARKET_SOURCE_INFO,
    async discover() {
      const valid: DiscoveredTopic[] = catalog.products.map((p) => ({
        key: `catalog:${p.id}`,
        title: p.title,
        category: p.category,
        catalogId: p.id,
        discoveredVia: "Lokaler Zielproduktkatalog",
        demo: false,
      }));
      const invalid: DiscoveredTopic[] = catalog.invalid.map((x) => ({
        key: `catalog:${x.id}`,
        title: `Katalogeintrag ${x.id}`,
        catalogId: x.id,
        discoveredVia: "Lokaler Zielproduktkatalog (ungültig)",
        demo: false,
        invalid: { codes: [...x.codes], messages: [...x.messages] },
      }));
      return [...valid, ...invalid];
    },
    async measure() {
      return null;
    },
  };
}
