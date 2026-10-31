// Brücke vom Supplier Scout zur Einkaufssperre (lib/guards/purchase.ts).
//
// Die Einkaufssperre kennt nur die festen Stufen aus PAYMENT_TERM_DAYS ("vorkasse", "netto14", …)
// und weiß nichts über Produktsicherheit, Identität oder Demo-Daten. Deshalb entscheidet diese Brücke
// konservativ und mit dem GANZEN Prüfergebnis eines Angebots:
//
// - Demo-Angebote und ausgeschlossene Angebote (z. B. unklare CE-/GPSR-Angaben) → immer "vorkasse".
// - Nur ein bestätigtes, gültiges und sofort nutzbares Zahlungsziel zählt.
// - Es wird auf die nächstkleinere bekannte Stufe ABGERUNDET – nie aufgerundet.
//
// "vorkasse" bedeutet für die Einkaufssperre: Finanzierung ist nur über bereits ausgezahltes Geld
// oder einen Finanzierungsrahmen gesichert. Eine Empfehlung des Scouts ist nie eine Einkaufsfreigabe.

import { PAYMENT_TERM_DAYS } from "@/lib/guards/purchase";
import type { PaymentTerms } from "@/lib/types";
import type { QuoteEvaluation } from "./compare";
import { isValidTermDays } from "./financing";

/** Zahlungsziel, wie es der Einkaufssperre für dieses Angebot übergeben werden darf. */
export function toPurchaseGuardTerms(evaluation: Pick<QuoteEvaluation, "quote" | "eligibility" | "financing">): PaymentTerms {
  const { quote, eligibility, financing } = evaluation;
  if (quote.demo || !eligibility.eligible) return "vorkasse";
  const usable = financing.status === "payment_terms_confirmed" || financing.status === "payment_terms_too_short";
  if (!usable || !isValidTermDays(financing.termDays)) return "vorkasse";
  const days = financing.termDays;
  let best: PaymentTerms = "vorkasse";
  for (const [terms, termDays] of Object.entries(PAYMENT_TERM_DAYS) as [PaymentTerms, number][]) {
    if (termDays <= days && termDays > PAYMENT_TERM_DAYS[best]) best = terms;
  }
  return best;
}
