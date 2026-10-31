import { Ban, Cable, Lock, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { ProductSuppliers, ScoutOverview, StatusLegend } from "@/components/suppliers/supplier-scout";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SAFETY_SWITCHES } from "@/lib/config/budget";
import { getSupplierLinks, getSupplierScoutReports } from "@/lib/data";
import { formatRating } from "@/lib/format";
import { buildSupplierView, SCOUT_RULES } from "@/lib/suppliers";

export const metadata: Metadata = { title: "Lieferanten – Supplier Scout" };

export default async function SuppliersPage() {
  const reports = await getSupplierScoutReports();
  const views = reports.map(({ product, report }) =>
    buildSupplierView(product, report, { adapters: report.adapters, containsDemoData: report.containsDemoData }),
  );
  const links = new Map(getSupplierLinks().map((l) => [l.productId, l]));
  const totalOffers = views.reduce((s, v) => s + v.eligible.length + v.excluded.length, 0);
  const adapters = reports[0]?.report.adapters ?? [];

  return (
    <>
      <PageHeader
        title="Lieferanten (Supplier Scout)"
        description={`${totalOffers} Angebote fiktiver Lieferanten für ${views.length} Produkte – geprüft auf Produktidentität, Sicherheit, Dropshipping, Lieferfähigkeit und Finanzierung. Je Produkt: günstigster, schnellster und insgesamt bester geeigneter Lieferant.`}
        actions={<DemoBadge label="Fiktive Lieferanten" />}
      />

      <section
        aria-label="Sicherheitshinweis"
        className="mb-4 flex gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-100"
      >
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold">Empfehlung ist keine Einkaufsfreigabe</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-100/90">
            <li>Alle Lieferanten und Werte sind Demo-Daten – keine echten Firmen, Preise oder Konditionen.</li>
            <li>
              Es gibt hier keine Bestellungen. Automatischer Einkauf ist gesperrt
              {SAFETY_SWITCHES.autoPurchaseEnabled ? "" : " (Sicherheitsschalter aus)"}; Demo-Angebote gelten für die
              Einkaufssperre immer als Vorkasse.
            </li>
            <li>Shopify wird von dieser Seite weder gelesen noch geändert – keine Preise, keine Veröffentlichung.</li>
            <li>Vor jeder Freigabe: fehlende Nachweise, unbestätigte Angaben und die Finanzierung klären.</li>
          </ul>
        </div>
      </section>

      <div className="mb-4">
        <ScoutOverview views={views} />
      </div>

      <Card className="mb-4" title="So wird geprüft" description="Gleiche Mindestanforderungen wie in der Produktanalyse">
        <div className="space-y-3 text-xs text-muted">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <li className="rounded-lg border border-line bg-surface-2/50 p-2.5">
              Lieferzeit nach DE <span className="font-medium text-fg">max. {SCOUT_RULES.maxDeliveryDays} Tage</span>
            </li>
            <li className="rounded-lg border border-line bg-surface-2/50 p-2.5">
              Bewertung <span className="font-medium text-fg">min. {formatRating(SCOUT_RULES.minRating)}</span>
            </li>
            <li className="rounded-lg border border-line bg-surface-2/50 p-2.5">
              Lieferantenbestand <span className="font-medium text-fg">min. {SCOUT_RULES.minStock} Stück</span>
            </li>
            <li className="rounded-lg border border-line bg-surface-2/50 p-2.5">
              Auszahlung an uns nach <span className="font-medium text-fg">{SCOUT_RULES.payoutDelayDays} Tagen</span>
            </li>
          </ul>
          <p>
            Ausgeschlossen werden Angebote mit unklarer Produktidentität, fehlender CE-/GPSR-Absicherung, ohne bestätigten Direktversand, ohne
            Lieferfähigkeit oder mit Mindestabnahme über einer Kundenbestellung. <span className="text-fg">Kalkulationsbasis</span> für Marge und
            Shopify „Kosten pro Artikel“ ist der günstigste geeignete Lieferant.
          </p>
          <StatusLegend />
        </div>
      </Card>

      <div className="space-y-4">
        {views.map((v) => (
          <ProductSuppliers key={v.productId} view={v} link={links.get(v.productId)} />
        ))}
      </div>

      <Card className="mt-4" title="Datenquellen" description="Schnittstelle für spätere echte Lieferanten (docs/SUPPLIER-AGENT.md)">
        <ul className="space-y-2 text-xs">
          {adapters.map((a) => (
            <li key={a.adapterId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
              <span className="flex items-center gap-1.5 text-fg">
                <Cable className="size-3.5 text-subtle" aria-hidden /> {a.adapterName}
              </span>
              <Badge tone={a.status === "ok" ? "green" : a.status === "blocked" ? "amber" : "red"}>
                {a.status === "ok" ? "Demo-Quelle aktiv" : a.status === "blocked" ? "gesperrt" : "Fehler"}
              </Badge>
            </li>
          ))}
          <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-muted">
            <span className="flex items-center gap-1.5">
              <Ban className="size-3.5" aria-hidden /> Echte Lieferanten-APIs (kostenpflichtig oder mit Netzwerkzugriff)
            </span>
            <Badge tone="amber">
              <Lock className="size-3" aria-hidden /> gesperrt
            </Badge>
          </li>
        </ul>
      </Card>
    </>
  );
}
