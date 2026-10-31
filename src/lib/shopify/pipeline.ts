// Geplante automatische Produktanlage – heute nur Dry-Run:
// Produktanalyse → Lieferantenvergleich → Margenkalkulation → Compliance-Prüfung → Shopify-Produktentwurf.
// Jede Stufe kann den Ablauf stoppen. Am Ende entsteht höchstens ein ENTWURF, nie ein aktives Produkt.

import { RECOMMENDATION_RULES } from "@/lib/config/assumptions";
import { SAFETY_SWITCHES } from "@/lib/config/budget";
import type { ProductAnalysis } from "@/lib/data";
import { formatPercent } from "@/lib/format";
import { productInputViolations } from "./guards";
import type { ProductListing } from "./listings";
import { buildProductSetInput, type ProductSetInput } from "./product-input";

export type ComplianceStatus = "offen" | "in_pruefung" | "freigegeben" | "abgelehnt";

export type StepState = "ok" | "blocked" | "skipped";

export interface PipelineStep {
  key: "analysis" | "supplier" | "margin" | "compliance" | "draft";
  label: string;
  state: StepState;
  detail: string;
}

export interface PipelineResult {
  productId: string;
  productName: string;
  steps: PipelineStep[];
  /** Würde im echten Lauf ein Entwurf angelegt? (Heute immer nur simuliert.) */
  wouldCreateDraft: boolean;
  input?: ProductSetInput;
}

const STEP_LABELS: Record<PipelineStep["key"], string> = {
  analysis: "Produktanalyse",
  supplier: "Lieferantenvergleich",
  margin: "Margenkalkulation",
  compliance: "Compliance-Prüfung",
  draft: "Shopify-Produktentwurf",
};

/**
 * Bewertet ein Produkt durch alle Stufen. `compliance` kommt später aus einer echten Prüfung;
 * bis dahin ist jedes Produkt "offen" und die Pipeline endet dort.
 */
export function evaluatePipeline(
  analysis: ProductAnalysis,
  listing: ProductListing | undefined,
  compliance: ComplianceStatus = "offen",
): PipelineResult {
  const steps: PipelineStep[] = [];
  let blocked = false;
  const step = (key: PipelineStep["key"], ok: boolean, detail: string) => {
    const state: StepState = blocked ? "skipped" : ok ? "ok" : "blocked";
    steps.push({ key, label: STEP_LABELS[key], state, detail: blocked ? "Übersprungen – vorherige Stufe blockiert." : detail });
    if (!ok) blocked = true;
  };

  step(
    "analysis",
    analysis.demand >= RECOMMENDATION_RULES.candidateMinDemand,
    `Nachfrage ${analysis.demand}/100 (Schwelle ${RECOMMENDATION_RULES.candidateMinDemand}).`,
  );
  step(
    "supplier",
    Boolean(analysis.best),
    analysis.best ? `Günstigster geeigneter Lieferant: ${analysis.best.offer.supplierName}.` : "Kein geeigneter Lieferant.",
  );
  step(
    "margin",
    analysis.recommendation === "kandidat",
    analysis.margin
      ? `Marge ${formatPercent(analysis.margin.marginPercent)} – Empfehlung „${analysis.recommendation}“.`
      : "Keine Kalkulation möglich.",
  );
  step("compliance", compliance === "freigegeben", `Status „${compliance}“ – CE/GPSR/Registrierungen müssen geprüft sein.`);

  let input: ProductSetInput | undefined;
  let refused: string | undefined;
  try {
    if (listing) input = buildProductSetInput(analysis, listing);
  } catch (e) {
    // Demo-Weg mit echtem Lieferantenangebot als Basis: kein Entwurf (Konditionen echter Lieferanten nie nach Shopify)
    refused = e instanceof Error ? e.message : String(e);
  }
  const violations = refused ? [refused] : input ? productInputViolations(input) : ["Keine Shop-Angaben (Titel, Varianten, Texte) vorhanden."];
  step(
    "draft",
    violations.length === 0,
    violations.length
      ? violations.join(" ")
      : SAFETY_SWITCHES.shopifyWriteEnabled
        ? "Entwurf (DRAFT) würde angelegt."
        : "Entwurf (DRAFT) würde angelegt – Schreibzugriff ist gesperrt, daher nur Dry-Run.",
  );

  return {
    productId: analysis.product.id,
    productName: analysis.product.name,
    steps,
    wouldCreateDraft: steps.every((s) => s.state === "ok"),
    input,
  };
}
