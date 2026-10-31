// Store Manager der Market-Pipeline (Stufe 5): bereitet einen VOLLSTÄNDIGEN Shopify-Entwurf als lokales Artefakt vor.
//
// Keine eigene Entwurfslogik: Die productSet-Eingabe baut `buildDraftInput` (shopify/product-input.ts), die Verstöße
// prüft `productInputViolations` (shopify/guards.ts) – dieselben Bausteine wie im Demo-Weg und in `shopify:sync`.
// Das Artefakt ist nur ein lokaler Dry-Run unter .data/market/drafts/ (geschrieben von server/market-store.ts, nur mit
// `--save`). Es wird in Phase 1 an NICHTS übergeben: kein Shopify-Schreiben, keine Freigabe, keine Veröffentlichung.
//
// Vertraulichkeit: Das Artefakt enthält NIE Einkaufspreise, Versandkosten, Margen, Kreditrahmen oder Zahlungsbedingungen
// – auch nicht bei Demo. `shopifyInput` enthält nur öffentliche, laufunabhängige Angaben (PUBLIC_DRAFT_METAFIELDS, keine
// Kosten). Der Angebots-Schlüssel (`offerKey`, Lieferant + Artikelnummer) steht nur in `variantMap` als interne Zuordnung.
//
// Fingerabdruck: sha256 über das kanonische JSON von { shopifyInput, variantMap } – laufunabhängig und nicht zirkulär.
// Lauf-ID, Zeitpunkt, simulierte Uhr und geplante Menge stehen außerhalb der Berechnung: Zwei Läufe mit gleichen Daten
// ergeben denselben Fingerabdruck und damit dieselbe (inhaltsadressierte) Datei.

import { createHash } from "node:crypto";
import { productInputViolations } from "@/lib/shopify/guards";
import type { ProductListing } from "@/lib/shopify/listings";
import { buildDraftInput, demoDraftSpec, type DraftSpec, type ProductSetInput } from "@/lib/shopify/product-input";
import {
  factValue,
  isConfirmed,
  normalizeGtin14,
  plannedAvailability,
  sameGtin,
  type BasisCandidate,
  type Fact,
  type LiquidityAssessment,
  type MatchBasis,
  type SupplierQuote,
} from "@/lib/suppliers";
import type { CatalogProduct, CatalogVariant } from "./catalog";
import type { ComplianceCheck } from "./compliance";
import { STORE_MANAGER_RULES } from "./config";
import type { MarketCandidate } from "./model";
import type { SalePrice } from "./profit";
import type { ReasonCode } from "./reasons";
import type { VariantSupplierResult } from "./supplier-stage";

export interface DraftVariantMapEntry {
  shopSku: string;
  optionValue?: string;
  /** Worüber die Variante dem Lieferantenangebot zugeordnet ist */
  basis: MatchBasis;
  gtin14?: string;
  /** Angebots-Schlüssel „supplierId::supplierSku“ (nur Preislisten) – interne Zuordnung, keine Kondition, nie in shopifyInput */
  offerKey?: string;
  mpn?: string;
  label?: string;
  /** confirmed = Identität unabhängig belegt (bestätigter Abgleich oder bestätigte, gleiche GTIN); sonst stated */
  identity: "confirmed" | "stated";
}

export interface DraftArtifact {
  version: 1;
  kind: "dry_run_draft";
  /** Demo-Entwurf (vollständig gekennzeichnet) – nie Grundlage für echte Entscheidungen */
  demo: boolean;
  /** Mit simulierter Uhr erzeugt (--now) – nie bereit zur Prüfung */
  clockOverride: boolean;
  candidateKey: string;
  productRef: string;
  /** NICHT im Fingerabdruck */
  runId: string;
  /** NICHT im Fingerabdruck */
  createdAt: string;
  /** sha256(kanonisches JSON von { shopifyInput, variantMap }) */
  fingerprint: string;
  /** Ausschließlich öffentliche, laufunabhängige Angaben – keine Kosten, keine Lauf-ID, kein Fingerabdruck */
  shopifyInput: ProductSetInput;
  variantMap: DraftVariantMapEntry[];
  /** Geplante verkaufbare Menge je Variante – NICHT im Fingerabdruck (ändert sich mit Bestand und Mitteln), nie an Shopify */
  availability: { shopSku: string; plannedAvailable: number }[];
  /** `notes` nennt die Lücken als Text (ohne Beträge) */
  completeness: { complete: boolean; missing: ReasonCode[]; notes: string[] };
  /** Direkt aus productInputViolations(shopifyInput) */
  violations: string[];
  approval: { status: "none"; wouldCreate: false; note: string };
}

export interface PrepareDraftInput {
  candidate: MarketCandidate;
  /** Echte Kandidaten: Katalogprodukt (Texte, Varianten, Bilder mit Nutzungsrechten) */
  catalog?: CatalogProduct;
  /** Demo-Kandidaten: Demo-Listing (Texte, Varianten, Symbolbild) */
  demoListing?: ProductListing;
  price: SalePrice;
  basis: BasisCandidate;
  /** Zuordnung je Variante aus der Supplier-Stufe (für `variantMap[].basis`) */
  supplierVariants?: VariantSupplierResult[];
  liquidity: LiquidityAssessment;
  /** Der Entwurf entsteht nur nach vollständiger Compliance-Prüfung (Freigabe durch Menschen ausstehend) */
  compliance: Pick<ComplianceCheck, "status">;
  runId: string;
  now: Date;
  demo: boolean;
  clockOverride: boolean;
}

/** Kanonisches JSON: Objektschlüssel sortiert, Listen in ihrer Reihenfolge, undefined entfällt. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(value));
}

/** Laufunabhängiger Fingerabdruck eines Entwurfs (ohne Lauf-ID, Zeitpunkt, Uhr und geplante Menge). */
export function draftFingerprint(a: Pick<DraftArtifact, "shopifyInput" | "variantMap">): string {
  return createHash("sha256").update(canonicalJson({ shopifyInput: a.shopifyInput, variantMap: a.variantMap })).digest("hex");
}

/** Inhaltsadressierter, relativer Dateiname unter .data/market: `drafts/<sichererSchlüssel>.<fingerabdruck[0..12]>.json`. */
export function draftArtifactFile(a: Pick<DraftArtifact, "candidateKey" | "fingerprint">): string {
  const safeKey = a.candidateKey.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._]+/, "").slice(0, 80) || "kandidat";
  return `drafts/${safeKey}.${a.fingerprint.slice(0, 12)}.json`;
}

const escapeHtml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const byDe = (a: string, b: string) => a.localeCompare(b, "de") || (a < b ? -1 : a > b ? 1 : 0);

/** Reiner Text einer HTML-Beschreibung (Tags und Entitäten entfernt, Leerraum zusammengefasst). */
export const descriptionText = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * GPSR-Block aus den Basisangeboten: verantwortliche Person in der EU (bestätigt) und Hinweis auf deutsche
 * Sicherheitshinweise (bestätigt). Fehlt eine Bestätigung bei einem Basisangebot → kein Block (DRAFT_GPSR_MISSING).
 */
export function gpsrHtmlOf(quotes: SupplierQuote[]): string | undefined {
  if (quotes.length === 0) return undefined;
  if (!quotes.every((q) => isConfirmed(q.safety.euResponsiblePerson, (v) => v.trim().length > 0))) return undefined;
  if (!quotes.every((q) => isConfirmed(q.safety.safetyInformationDe, (v) => v === true))) return undefined;
  const persons = [...new Set(quotes.map((q) => factValue(q.safety.euResponsiblePerson)!.trim()))].sort(byDe);
  return (
    "<h3>Produktsicherheit</h3>" +
    `<p>Verantwortliche Person in der EU: ${persons.map(escapeHtml).join("; ")}</p>` +
    "<p>Sicherheits- und Gebrauchshinweise in deutscher Sprache liegen dem Produkt bei.</p>"
  );
}

/**
 * Marke aus `identity.brand` der Basisangebote. Bestätigt nur, wenn genau eine Marke vorliegt, sie bei JEDEM
 * Basisangebot bestätigt ist und – falls angegeben – mit der Marke der Katalogvarianten übereinstimmt.
 */
export function brandOf(quotes: SupplierQuote[], catalogBrands: string[] = []): { value: string | null; confirmed: boolean } {
  const facts: Fact<string>[] = quotes.map((q) => q.identity.brand);
  const values = [...new Set(facts.flatMap((f) => (factValue(f)?.trim() ? [factValue(f)!.trim()] : [])))].sort(byDe);
  if (values.length === 0) return { value: null, confirmed: false };
  const value = values[0];
  const same = (b: string) => b.trim().toLowerCase() === value.toLowerCase();
  const confirmed = values.length === 1 && facts.every((f) => isConfirmed(f, (v) => v.trim() === value)) && catalogBrands.every(same);
  return { value, confirmed };
}

const identityOf = (q: SupplierQuote, gtin: string | undefined): DraftVariantMapEntry["identity"] =>
  isConfirmed(q.identity.match, (m) => m === "exact") || (gtin !== undefined && isConfirmed(q.identity.gtin, (v) => sameGtin(v, gtin))) ? "confirmed" : "stated";

const defaultMatchBasis = (v: CatalogVariant): MatchBasis => (v.gtin !== undefined ? "gtin" : v.mpn !== undefined ? "supplier_sku_mpn" : "supplier_sku_label");

/**
 * Bereitet den vollständigen Entwurf als Artefakt vor. Rein und deterministisch (Zeit nur aus `now`).
 * Wirft bei widersprüchlicher Eingabe (Demo und echt gemischt, Variante ohne Kalkulationsbasis, Compliance nicht
 * vollständig geprüft) – lieber kein Entwurf als ein falscher.
 */
export function prepareDraft(input: PrepareDraftInput): DraftArtifact {
  const { candidate, catalog, demoListing, basis, demo } = input;
  if (input.compliance.status !== "human_review") throw new Error("Entwurf nur nach vollständiger Compliance-Prüfung.");
  if (demo !== candidate.demo || demo !== !!demoListing || !!catalog === demo) {
    throw new Error(`Entwurf für ${candidate.key}: Demo und echte Angaben werden nie gemischt (Demo nur mit Demo-Listing, echt nur mit Katalogprodukt).`);
  }
  if (!demo && basis.demo) throw new Error(`Entwurf für ${candidate.key}: echte Kandidaten nie mit Demo-Lieferanten.`);
  const byShopSku = new Map(basis.perVariant.map((v) => [v.shopSku, v]));
  const matchOf = new Map((input.supplierVariants ?? []).map((v) => [v.shopSku, v]));

  // Varianten des Entwurfs mit ihrem Basisangebot (Demo: eine Abfrage auf Produktebene für alle Listing-Varianten)
  const rows = demo
    ? demoListing!.variants.map((lv) => {
        const entry = basis.perVariant[0];
        const sv = input.supplierVariants?.[0];
        return {
          shopSku: lv.sku,
          optionValue: lv.value,
          entry,
          gtin: sv?.query.gtin,
          map: { basis: "demo_product_level" as MatchBasis, mpn: undefined, label: undefined },
        };
      })
    : catalog!.variants.map((cv) => {
        const entry = byShopSku.get(cv.shopSku);
        if (!entry) throw new Error(`Entwurf für ${candidate.key}: Variante ${cv.shopSku} ohne Kalkulationsbasis.`);
        const m = matchOf.get(cv.shopSku)?.match;
        return {
          shopSku: cv.shopSku,
          optionValue: cv.optionValue,
          entry,
          gtin: cv.gtin,
          map: { basis: m?.status === "matched" ? m.basis : defaultMatchBasis(cv), mpn: cv.mpn, label: cv.label },
        };
      });
  if (rows.length === 0 || rows.some((r) => !r.entry)) throw new Error(`Entwurf für ${candidate.key}: keine Varianten mit Kalkulationsbasis.`);

  const quotes = basis.perVariant.map((v) => v.evaluation.quote);
  const gpsrHtml = gpsrHtmlOf(quotes);
  const brand = brandOf(quotes, demo ? [] : catalog!.variants.flatMap((v) => (v.brand ? [v.brand] : [])));
  const priceGross = input.price.gross;

  const images = demo ? [] : (catalog!.listing.images ?? []).filter((i) => i.rightsReference.trim().length > 0).map((i) => ({ url: i.url, alt: i.alt }));
  const spec: DraftSpec = demo
    ? demoDraftSpec(demoListing!, priceGross, gpsrHtml)
    : {
        demo: false,
        productRef: `catalog:${catalog!.id}`,
        listing: catalog!.listing,
        variants: rows.map((r) => ({ shopSku: r.shopSku, ...(r.optionValue !== undefined && { optionValue: r.optionValue }), priceGross })),
        images,
        vendor: brand.value ?? "—",
        ...(gpsrHtml !== undefined && { gpsrHtml }),
      };
  const shopifyInput = buildDraftInput(spec);

  const variantMap: DraftVariantMapEntry[] = rows.map((r) => {
    const gtin14 = normalizeGtin14(r.gtin) ?? undefined;
    return {
      shopSku: r.shopSku,
      ...(r.optionValue !== undefined && { optionValue: r.optionValue }),
      basis: r.map.basis,
      ...(gtin14 !== undefined && { gtin14 }),
      ...(r.entry.offerKey !== undefined && { offerKey: r.entry.offerKey }),
      ...(r.map.mpn !== undefined && { mpn: r.map.mpn }),
      ...(r.map.label !== undefined && { label: r.map.label }),
      identity: identityOf(r.entry.evaluation.quote, r.gtin),
    };
  });

  // Geplante Menge je Entwurfsvariante über dieselbe Funktion (Summe ≤ Kapazität). Demo: Produktebene je Listing-Variante.
  const availability = plannedAvailability({ ...basis, perVariant: rows.map((r) => ({ shopSku: r.shopSku, evaluation: r.entry.evaluation })) }, input.liquidity);

  // Vollständigkeit
  const gaps: { code: ReasonCode; text: string }[] = [];
  if (!demo) {
    const length = descriptionText(catalog!.listing.descriptionHtml).length;
    if (length < STORE_MANAGER_RULES.minDescriptionChars) {
      gaps.push({ code: "DRAFT_INCOMPLETE", text: `Beschreibung zu kurz (${length} von mindestens ${STORE_MANAGER_RULES.minDescriptionChars} Zeichen).` });
    }
    if (images.length === 0) gaps.push({ code: "DRAFT_INCOMPLETE", text: "Kein Produktbild mit belegten Nutzungsrechten." });
  }
  const stated = variantMap.filter((v) => v.identity !== "confirmed").map((v) => v.shopSku);
  if (stated.length > 0) gaps.push({ code: "DRAFT_INCOMPLETE", text: `Produktidentität nicht bestätigt: ${stated.join(", ")}.` });
  if (!Number.isFinite(priceGross) || priceGross <= 0) gaps.push({ code: "DRAFT_INCOMPLETE", text: "Kein Verkaufspreis über 0." });
  if (!gpsrHtml) gaps.push({ code: "DRAFT_GPSR_MISSING", text: "GPSR-Angaben fehlen: verantwortliche Person in der EU bzw. deutsche Sicherheitshinweise nicht bei jedem Basisangebot bestätigt." });
  if (!brand.confirmed) gaps.push({ code: "DRAFT_BRAND_UNCONFIRMED", text: brand.value ? "Marke nur angegeben, nicht bestätigt (oder uneinheitlich)." : "Marke fehlt." });

  const violations = productInputViolations(shopifyInput);
  const fingerprint = draftFingerprint({ shopifyInput, variantMap });
  return {
    version: 1,
    kind: "dry_run_draft",
    demo,
    clockOverride: input.clockOverride,
    candidateKey: candidate.key,
    productRef: spec.productRef,
    runId: input.runId,
    createdAt: input.now.toISOString(),
    fingerprint,
    shopifyInput,
    variantMap,
    availability,
    completeness: { complete: gaps.length === 0, missing: [...new Set(gaps.map((g) => g.code))], notes: gaps.map((g) => g.text) },
    violations,
    approval: {
      status: "none",
      wouldCreate: false,
      note: demo
        ? "Demo-Entwurf – nie zur Anlage in Shopify über die Pipeline. Nur lokaler Dry-Run."
        : "Keine Freigabe. Lokaler Dry-Run – Anlage in Shopify erst mit Freigabe-Akte (Phase 2) über npm run shopify:sync.",
    },
  };
}

/**
 * Wirkung des Artefakts auf die Entwurfsstufe: `ok` nur bei vollständigem Entwurf ohne Guard-Verstoß; Guard-Verstoß →
 * gesperrt (DRAFT_GUARD_VIOLATION), unvollständig → zurückgestellt (DRAFT_INCOMPLETE + Einzelcodes).
 */
export function draftStageOf(a: Pick<DraftArtifact, "completeness" | "violations">): { status: "ok" | "deferred" | "blocked"; codes: ReasonCode[] } {
  // Ein Guard-Verstoß sperrt; Lücken stehen dann nur im Artefakt (sonst würde „zurückstellen“ die Sperre überdecken).
  if (a.violations.length > 0) return { status: "blocked", codes: ["DRAFT_GUARD_VIOLATION"] };
  const incomplete: ReasonCode[] = a.completeness.complete ? [] : [...new Set<ReasonCode>(["DRAFT_INCOMPLETE", ...a.completeness.missing])];
  if (incomplete.length > 0) return { status: "deferred", codes: incomplete };
  return { status: "ok", codes: [] };
}
