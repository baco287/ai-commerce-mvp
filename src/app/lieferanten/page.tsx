import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { ScoutRecommendations } from "@/components/suppliers/scout-recommendations";
import { SupplierComparison, type SupplierComparisonItem } from "@/components/suppliers/supplier-comparison";
import { DemoBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { calculateMargin } from "@/lib/calc/pricing";
import { SUPPLIER_RULES } from "@/lib/config/assumptions";
import { getProductAnalyses, getSupplierScoutReports } from "@/lib/data";
import { formatRating } from "@/lib/format";

export const metadata: Metadata = { title: "Lieferantenvergleich" };

export default async function SuppliersPage() {
  const scout = await getSupplierScoutReports();
  const items: SupplierComparisonItem[] = getProductAnalyses().map((a) => ({
    productId: a.product.id,
    productName: a.product.name,
    priceGross: a.product.targetPriceGross,
    offers: a.offers,
    margins: a.offers.map((o) => {
      const m = calculateMargin(a.product.targetPriceGross, o.landedCost);
      return { contribution: m.contribution, marginPercent: m.marginPercent };
    }),
  }));
  const totalOffers = items.reduce((s, i) => s + i.offers.length, 0);

  return (
    <>
      <PageHeader
        title="Lieferantenvergleich"
        description={`${totalOffers} simulierte Angebote für ${items.length} Produkte – verglichen nach Einkauf, Versand, Importkosten und Lieferzeit. Markiert wird das günstigste Angebot, das alle Mindestanforderungen erfüllt.`}
      />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Mindestanforderungen" description="Sonst gilt ein Angebot als „nicht geeignet“" className="lg:col-span-2">
          <ul className="grid gap-3 text-sm sm:grid-cols-3">
            <li className="rounded-lg border border-line bg-surface-2/50 p-3">
              <p className="text-xs text-subtle">Lieferzeit</p>
              <p className="mt-0.5 font-medium">max. {SUPPLIER_RULES.maxDeliveryDays} Tage</p>
            </li>
            <li className="rounded-lg border border-line bg-surface-2/50 p-3">
              <p className="text-xs text-subtle">Bewertung</p>
              <p className="mt-0.5 font-medium">min. {formatRating(SUPPLIER_RULES.minRating)} von 5</p>
            </li>
            <li className="rounded-lg border border-line bg-surface-2/50 p-3">
              <p className="text-xs text-subtle">Lagerbestand</p>
              <p className="mt-0.5 font-medium">min. {SUPPLIER_RULES.minStock} Stück</p>
            </li>
          </ul>
        </Card>
        <Card>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/25">
              <Lock className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold">Keine automatischen Bestellungen</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Der Vergleich ist reine Analyse. Echtgeld-Bestellungen und Musterkäufe sind gesperrt, bis Finanzierung und Freigabeprozess stehen.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Supplier Scout – Empfehlungen"
        description="Prüft zusätzlich Produktidentität, CE/GPSR, Direktversand, Vorratskauf und Vorfinanzierung. Empfehlungen geben nichts frei."
        action={<DemoBadge label="Fiktive Lieferanten" />}
        className="mb-4"
        flush
      >
        <ScoutRecommendations items={scout} />
      </Card>

      <Card
        title="Angebote je Produkt"
        description="Bisheriger Vergleich nach Mindestanforderungen – wird nach der Umstellung auf den Supplier Scout ersetzt."
        action={<DemoBadge label="Fiktive Lieferanten" />}
        flush
      >
        <SupplierComparison items={items} />
      </Card>
    </>
  );
}
