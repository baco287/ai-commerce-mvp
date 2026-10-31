// Lokaler Zielproduktkatalog: von Hand gepflegte echte Produktideen mit Varianten-Identität und Planpreis.
// Die Datei liegt unter .data/catalog/products.json (von Git ignoriert) und wird nur lesend geladen
// (server/catalog-store.ts). Echte Katalogdaten kommen nie ins Repo – Beispiele nur synthetisch (docs/MARKET-SCOUT.md).
//
// Rein: Validierung und Abfragen ohne Datei- oder Netzwerkzugriff; die Uhr kommt immer von außen (`now`).
// Wartung des Katalogs von Hand nach dokumentierter Vorlage – Entscheidung des Inhabers offen (Entscheidung 5);
// ein Importbefehl mit Bestätigungscode käme erst in Phase 2.

import { DEMO_MARKERS } from "@/lib/shopify/listings";
import { DOC_TYPES, gtinClass, GTIN_CLASS_LABELS, normalizeGtin14, type DocType, type ProductQuery } from "@/lib/suppliers";
import type { ReasonCode } from "./reasons";
import { assessRisk } from "./risk";

export interface CatalogVariant {
  /** Eindeutig im ganzen Katalog, ohne DEMO-Präfix */
  shopSku: string;
  /** z. B. "Schwarz"; fehlt = Default Title (nur bei genau einer Variante) */
  optionValue?: string;
  /** Bevorzugt; nur Klasse "global" (identity.ts) */
  gtin?: string;
  /** offerKeys "supplierId::supplierSku" – Pflicht ohne GTIN */
  supplierOffers?: string[];
  mpn?: string;
  brand?: string;
  /** Variantenkennung laut Lieferant – Pflicht ohne GTIN, wenn keine MPN */
  label?: string;
}

export interface CatalogImage {
  url: string;
  alt: string;
  /** Beleg der Nutzungsrechte (z. B. Lizenz, Vertrag, eigene Aufnahme) */
  rightsReference: string;
}

export interface CatalogProduct {
  /** /^[a-z0-9][a-z0-9-]{2,39}$/, nicht /^p-/ (Demo-IDs) */
  id: string;
  title: string;
  category: string;
  /** Nachfrage über die bestehende Wikimedia-Quelle (nur --live) bzw. deren zwischengespeichertes Signal */
  wikiTitle?: string;
  salePrice: { gross: number; basis: "market_observation" | "plan"; reference: string; checkedAt: string };
  /** Zusätzlich zu den Risikoregeln */
  requiredDocTypes?: DocType[];
  /** ≥ 1 */
  variants: CatalogVariant[];
  listing: {
    handle: string;
    title: string;
    descriptionHtml: string;
    productType: string;
    categoryTag: string;
    option?: string;
    images?: CatalogImage[];
  };
}

export interface CatalogValidation {
  products: CatalogProduct[];
  invalid: { id: string; codes: ReasonCode[]; messages: string[] }[];
}

/** Format der Produkt-ID; Demo-IDs ("p-…") sind ausgeschlossen. */
export const CATALOG_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;
const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEMO_WORD = /\bdemo\b/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const optText = (v: unknown, max = 200) => v === undefined || isText(v, max);

/** Enthält der Text ein Demo-Kennzeichen (Tag, Titel-, Handle- oder SKU-Präfix, Wort „demo“)? */
export function hasDemoMarker(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes(DEMO_MARKERS.tag.toLowerCase()) ||
    lower.includes(DEMO_MARKERS.titlePrefix.trim().toLowerCase()) ||
    lower.startsWith(DEMO_MARKERS.handlePrefix.toLowerCase()) ||
    lower.startsWith(DEMO_MARKERS.skuPrefix.toLowerCase()) ||
    DEMO_WORD.test(text)
  );
}

/** Prüfdatum: YYYY-MM-DD (echtes Kalenderdatum) oder ISO-Zeitpunkt mit Zeitzone; null = ungültig. */
function parseCheckedAt(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? d : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isHttpsUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

const GTIN_CLASS_CODES: Partial<Record<ReturnType<typeof gtinClass>, ReasonCode>> = {
  restricted: "IDENTITY_RESTRICTED_GTIN",
  trade_unit: "IDENTITY_TRADE_UNIT_GTIN",
};

/** Prüft ein Produkt für sich; Dubletten über den ganzen Katalog prüft `validateCatalog`. */
function checkProduct(raw: unknown, now: Date): { product: CatalogProduct | null; codes: Set<ReasonCode>; messages: string[] } {
  const codes = new Set<ReasonCode>(["CATALOG_INVALID"]);
  const messages: string[] = [];
  const fail = (message: string, code?: ReasonCode) => {
    messages.push(message);
    if (code) codes.add(code);
  };
  if (!isObj(raw)) return { product: null, codes, messages: ["Eintrag ist kein Objekt."] };

  const id = raw.id;
  if (typeof id !== "string" || !CATALOG_ID_PATTERN.test(id)) fail("id fehlt oder ungültig (a–z, 0–9, Bindestrich; 3–40 Zeichen).");
  else if (/^p-/.test(id)) fail(`id „${id}“ ist einer Demo-ID vorbehalten (p-…).`);
  if (!isText(raw.title)) fail("title fehlt oder ungültig.");
  if (!isText(raw.category, 100)) fail("category fehlt oder ungültig.");
  if (!optText(raw.wikiTitle)) fail("wikiTitle ungültig.");

  // Verkaufspreis mit Beleg und Prüfdatum
  const sp = raw.salePrice;
  if (!isObj(sp)) fail("salePrice fehlt.");
  else {
    if (typeof sp.gross !== "number" || !Number.isFinite(sp.gross) || sp.gross <= 0) fail("salePrice.gross muss eine Zahl > 0 sein.");
    if (sp.basis !== "market_observation" && sp.basis !== "plan") fail("salePrice.basis muss „market_observation“ oder „plan“ sein.");
    if (!isText(sp.reference, 300)) fail("salePrice.reference (Beleg bzw. Herleitung) fehlt.");
    const checked = parseCheckedAt(sp.checkedAt);
    if (!checked) fail("salePrice.checkedAt fehlt oder ist kein gültiges Datum.");
    else if (checked.getTime() > now.getTime()) fail("salePrice.checkedAt liegt in der Zukunft.");
  }

  if (raw.requiredDocTypes !== undefined) {
    if (!Array.isArray(raw.requiredDocTypes) || raw.requiredDocTypes.some((t) => !(DOC_TYPES as readonly unknown[]).includes(t))) {
      fail(`requiredDocTypes enthält unbekannte Dokumenttypen (erlaubt: ${DOC_TYPES.join(", ")}).`);
    }
  }

  // Shop-Angaben
  const listing = raw.listing;
  if (!isObj(listing)) fail("listing fehlt.");
  else {
    if (typeof listing.handle !== "string" || !HANDLE_PATTERN.test(listing.handle) || listing.handle.length > 100) fail("listing.handle fehlt oder ungültig.");
    if (!isText(listing.title)) fail("listing.title fehlt oder ungültig.");
    if (!isText(listing.descriptionHtml, 20_000)) fail("listing.descriptionHtml fehlt oder ungültig.");
    else if (/<\s*script/i.test(listing.descriptionHtml)) fail("listing.descriptionHtml enthält ein Skript.");
    if (!isText(listing.productType, 100)) fail("listing.productType fehlt oder ungültig.");
    if (!isText(listing.categoryTag, 100)) fail("listing.categoryTag fehlt oder ungültig.");
    if (!optText(listing.option, 60)) fail("listing.option ungültig.");
    if (listing.images !== undefined) {
      if (!Array.isArray(listing.images)) fail("listing.images muss eine Liste sein.");
      else
        listing.images.forEach((img, i) => {
          if (!isObj(img) || !isHttpsUrl(img.url)) fail(`Bild ${i + 1}: url fehlt oder ist nicht https.`);
          if (!isObj(img) || !isText(img.alt, 300)) fail(`Bild ${i + 1}: alt fehlt.`);
          if (!isObj(img) || !isText(img.rightsReference, 300)) fail(`Bild ${i + 1}: rightsReference (Nutzungsrechte) fehlt.`);
        });
    }
  }

  // Varianten mit Identität
  const variants = raw.variants;
  if (!Array.isArray(variants) || variants.length === 0) fail("variants: mindestens eine Variante nötig.");
  else {
    variants.forEach((v, i) => {
      const where = `Variante ${i + 1}`;
      if (!isObj(v)) return fail(`${where}: kein Objekt.`);
      if (!isText(v.shopSku, 64) || /\s/.test(v.shopSku)) fail(`${where}: shopSku fehlt oder ungültig (ohne Leerzeichen, höchstens 64 Zeichen).`);
      if (!optText(v.optionValue, 60)) fail(`${where}: optionValue ungültig.`);
      if (!optText(v.mpn, 80)) fail(`${where}: mpn ungültig.`);
      if (!optText(v.brand, 80)) fail(`${where}: brand ungültig.`);
      if (!optText(v.label, 60)) fail(`${where}: label ungültig.`);
      if (v.gtin !== undefined) {
        const cls = typeof v.gtin === "string" ? gtinClass(v.gtin) : "invalid";
        if (cls !== "global") fail(`${where}: GTIN ${String(v.gtin)} – ${GTIN_CLASS_LABELS[cls]}.`, GTIN_CLASS_CODES[cls]);
      }
      const offers = v.supplierOffers;
      if (offers !== undefined && (!Array.isArray(offers) || offers.some((o) => !isText(o, 200) || !o.includes("::")))) {
        fail(`${where}: supplierOffers muss eine Liste von Angebots-Schlüsseln „supplierId::supplierSku“ sein.`);
      }
      if (v.gtin === undefined) {
        const hasOffers = Array.isArray(offers) && offers.length > 0;
        if (!hasOffers || (v.mpn === undefined && v.label === undefined)) {
          fail(`${where}: ohne GTIN sind supplierOffers UND (mpn oder label) Pflicht.`);
        }
      }
    });
    if (variants.length > 1) {
      if (!isObj(listing) || listing.option === undefined) fail("Mehrere Varianten: listing.option (z. B. „Farbe“) fehlt.");
      const values = variants.map((v) => (isObj(v) && typeof v.optionValue === "string" ? v.optionValue.trim().toLowerCase() : ""));
      if (values.some((x) => x === "")) fail("Mehrere Varianten: jede Variante braucht optionValue.");
      else if (new Set(values).size !== values.length) fail("Mehrere Varianten: optionValue doppelt.");
    }
  }

  // Demo-Kennzeichen in Kennungen und Texten – echte Katalogprodukte dürfen nie wie Demo-Daten aussehen
  const marked: [string, unknown][] = [
    ["id", raw.id],
    ["title", raw.title],
    ["listing.handle", isObj(listing) ? listing.handle : undefined],
    ["listing.title", isObj(listing) ? listing.title : undefined],
    ["listing.productType", isObj(listing) ? listing.productType : undefined],
    ["listing.categoryTag", isObj(listing) ? listing.categoryTag : undefined],
    ["listing.option", isObj(listing) ? listing.option : undefined],
    ...(Array.isArray(variants) ? variants : []).flatMap((v, i): [string, unknown][] =>
      isObj(v)
        ? [
            [`Variante ${i + 1} shopSku`, v.shopSku],
            [`Variante ${i + 1} optionValue`, v.optionValue],
            [`Variante ${i + 1} brand`, v.brand],
          ]
        : [],
    ),
  ];
  for (const [field, value] of marked) {
    if (typeof value === "string" && hasDemoMarker(value)) fail(`${field} „${value}“ enthält ein Demo-Kennzeichen.`);
  }

  if (messages.length) return { product: null, codes, messages };
  return { product: cleanProduct(raw), codes, messages };
}

/** Optionales Feld nur übernehmen, wenn es gesetzt ist. */
const optional = <K extends string, V>(key: K, value: V | undefined) => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

/** Übernimmt nur bekannte Felder (unbekannte Felder werden verworfen). Voraussetzung: checkProduct ohne Befund. */
function cleanProduct(raw: Obj): CatalogProduct {
  const sp = raw.salePrice as Obj;
  const listing = raw.listing as Obj;
  const text = (v: unknown) => v as string | undefined;
  const variants = (raw.variants as Obj[]).map(
    (v): CatalogVariant => ({
      shopSku: v.shopSku as string,
      ...optional("optionValue", text(v.optionValue)),
      ...optional("gtin", text(v.gtin)?.trim()),
      ...optional("supplierOffers", Array.isArray(v.supplierOffers) ? [...(v.supplierOffers as string[])] : undefined),
      ...optional("mpn", text(v.mpn)),
      ...optional("brand", text(v.brand)),
      ...optional("label", text(v.label)),
    }),
  );
  const images = Array.isArray(listing.images)
    ? (listing.images as Obj[]).map((i): CatalogImage => ({ url: i.url as string, alt: i.alt as string, rightsReference: i.rightsReference as string }))
    : undefined;
  return {
    id: raw.id as string,
    title: raw.title as string,
    category: raw.category as string,
    ...optional("wikiTitle", text(raw.wikiTitle)),
    salePrice: { gross: sp.gross as number, basis: sp.basis as CatalogProduct["salePrice"]["basis"], reference: sp.reference as string, checkedAt: sp.checkedAt as string },
    ...optional("requiredDocTypes", Array.isArray(raw.requiredDocTypes) ? [...new Set(raw.requiredDocTypes as DocType[])].sort() : undefined),
    variants,
    listing: {
      handle: listing.handle as string,
      title: listing.title as string,
      descriptionHtml: listing.descriptionHtml as string,
      productType: listing.productType as string,
      categoryTag: listing.categoryTag as string,
      ...optional("option", text(listing.option)),
      ...optional("images", images),
    },
  };
}

/**
 * Prüft den Katalog. Ungültige Produkte werden nicht bewertet; sie erscheinen mit Code CATALOG_INVALID und Meldungen.
 * Dubletten (id, handle, shopSku, GTIN nach Normalisierung) machen ALLE beteiligten Produkte ungültig.
 * Akzeptiert eine Liste oder `{ products: [...] }`.
 */
export function validateCatalog(raw: unknown, now: Date): CatalogValidation {
  if (raw === undefined || raw === null) return { products: [], invalid: [] };
  const list = Array.isArray(raw) ? raw : isObj(raw) ? raw.products : undefined;
  if (!Array.isArray(list)) return { products: [], invalid: [{ id: "(Katalog)", codes: ["CATALOG_INVALID"], messages: ["Katalogdatei: erwartet eine Liste „products“."] }] };

  const checked = list.map((entry, i) => ({ entry, index: i, ...checkProduct(entry, now) }));

  // Dubletten über den ganzen Katalog – auch aus ungültigen Einträgen (vorsichtig: alle Beteiligten sind ungültig)
  const keysOf = (entry: unknown): string[] => {
    if (!isObj(entry)) return [];
    const keys: string[] = [];
    if (typeof entry.id === "string") keys.push(`id „${entry.id}“`);
    if (isObj(entry.listing) && typeof entry.listing.handle === "string") keys.push(`handle „${entry.listing.handle}“`);
    if (Array.isArray(entry.variants)) {
      for (const v of entry.variants) {
        if (!isObj(v)) continue;
        if (typeof v.shopSku === "string") keys.push(`shopSku „${v.shopSku.trim().toLowerCase()}“`);
        const g = typeof v.gtin === "string" ? normalizeGtin14(v.gtin) : null;
        if (g) keys.push(`GTIN ${g}`);
      }
    }
    return keys;
  };
  const owners = new Map<string, Set<number>>();
  checked.forEach(({ entry, index }) => keysOf(entry).forEach((k) => owners.set(k, (owners.get(k) ?? new Set()).add(index))));
  // Mehrfach innerhalb eines Produkts (z. B. zwei Varianten mit gleicher SKU) zählt ebenfalls
  const counts = new Map<string, number>();
  checked.forEach(({ entry }) => keysOf(entry).forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1)));
  for (const [key, n] of counts) {
    if (n < 2) continue;
    for (const index of owners.get(key)!) {
      const c = checked[index];
      c.messages.push(`${key} doppelt im Katalog.`);
      c.product = null;
    }
  }

  const products = checked.flatMap((c) => (c.product && c.messages.length === 0 ? [c.product] : []));
  const invalid = checked
    .filter((c) => c.messages.length > 0)
    .map((c) => ({
      id: isObj(c.entry) && typeof c.entry.id === "string" && c.entry.id.trim() ? c.entry.id : `#${c.index + 1}`,
      codes: [...c.codes],
      messages: [...new Set(c.messages)],
    }));
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, "de") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { products: products.sort(byId), invalid: invalid.sort(byId) };
}

/**
 * Je Variante eine Suchanfrage für den Supplier Scout: Bestellmenge 1 (Kundenbestellung), Ziel DE, Pflicht-Dokumenttypen
 * aus dem Katalog. Die Dokumenttypen aus den Risikoregeln ergänzt die Compliance-Stufe (requiredDocTypesFor, Paket D).
 */
export function catalogVariantQueries(p: CatalogProduct): { variant: CatalogVariant; query: ProductQuery }[] {
  const ceRequired = assessRisk(p.title, p.category).level === "high";
  const requiredDocTypes = [...new Set(p.requiredDocTypes ?? [])].sort();
  return p.variants.map((variant) => ({
    variant,
    query: {
      productId: `catalog:${p.id}`,
      productKey: `cat:${p.id}:${variant.shopSku}`,
      title: variant.optionValue ? `${p.title} – ${variant.optionValue}` : p.title,
      ...(variant.gtin !== undefined && { gtin: variant.gtin }),
      ...(variant.label !== undefined && { variantLabel: variant.label }),
      category: p.category,
      quantity: 1,
      destinationCountry: "DE",
      safety: { ceRequired },
      requiredDocTypes,
    },
  }));
}
