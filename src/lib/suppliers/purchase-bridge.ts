// Brücke vom Supplier Scout zur Einkaufssperre (lib/guards/purchase.ts).
//
// Die Einkaufssperre kennt nur die festen Stufen aus PAYMENT_TERM_DAYS ("vorkasse", "netto14", …).
// Die Umrechnung ist bewusst konservativ: Nur ein bestätigtes, sofort nutzbares Zahlungsziel zählt,
// und es wird auf die nächstkleinere bekannte Stufe ABGERUNDET – nie aufgerundet.

import { PAYMENT_TERM_DAYS } from "@/lib/guards/purchase";
import type { PaymentTerms } from "@/lib/types";
import type { FinancingAssessment } from "./financing";

/** Zahlungsziel, wie es der Einkaufssperre übergeben werden darf. */
export function toPurchaseGuardTerms(financing: FinancingAssessment): PaymentTerms {
  const usable = financing.status === "payment_terms_confirmed" || financing.status === "payment_terms_too_short";
  const days = usable ? (financing.termDays ?? 0) : 0;
  let best: PaymentTerms = "vorkasse";
  for (const [terms, termDays] of Object.entries(PAYMENT_TERM_DAYS) as [PaymentTerms, number][]) {
    if (termDays <= days && termDays > PAYMENT_TERM_DAYS[best]) best = terms;
  }
  return best;
}
