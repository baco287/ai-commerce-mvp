import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ScoreBar } from "@/components/ui/score-bar";
import { Table, Td, Th } from "@/components/ui/table";
import { demandLabel, DEMAND_WEIGHTS } from "@/lib/calc/demand";
import { ASSUMPTIONS, RECOMMENDATION_RULES } from "@/lib/config/assumptions";
import { MarketScoutPanel } from "@/components/market/market-scout-panel";
import { getMarketScoutOverview, getProductAnalyses, type Recommendation } from "@/lib/data";
import { formatEur, formatPercent } from "@/lib/format";
import { RECOMMENDATION_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Produktanalyse" };

export default async function ProductsPage() {
  const analyses = getProductAnalyses();
  const market = await getMarketScoutOverview();
  const count = (r: Recommendation) => analyses.filter((a) => a.recommendation === r).length;

  return (
    <>
      <PageHeader
        title="Produktanalyse"
        description="Fünf Demo-Produkte mit simulierter Nachfragebewertung, Lieferantenpreisen und prognostizierter Marge auf Basis des günstigsten geeigneten Lieferanten."
        actions={
          <>
            <Badge tone="green">{count("kandidat")} Kandidaten</Badge>
            <Badge tone="blue">{count("beobachten")} beobachten</Badge>
            <Badge tone="red">{count("verwerfen")} verwerfen</Badge>
          </>
        }
      />

      <Card
        title="Market Scout – automatische Produktrecherche"
        description="Gefundene Trends, Belege, Lieferant, Marge und warum ein Kandidat gesperrt oder zurückgestellt ist. Reale Quelle: Wikipedia-Aufrufe (öffentliches Interesse, keine Verkäufe)."
        className="mb-4"
        flush
      >
        <MarketScoutPanel overview={market} />
      </Card>

      <Card title="Produktübersicht" description="Nachfrage 0–100 aus Suchtrend, Social Buzz, Wettbewerb und Saison" action={<DemoBadge />} flush>
        <Table minWidth={1040}>
          <thead>
            <tr>
              <Th>Produkt</Th>
              <Th>Nachfrage</Th>
              <Th align="right">Verkaufspreis</Th>
              <Th align="right">Lieferantenpreise</Th>
              <Th>Günstigster geeigneter</Th>
              <Th align="right">Gewinn / Verkauf</Th>
              <Th align="right">Marge</Th>
              <Th>Empfehlung</Th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((a) => (
              <tr key={a.product.id}>
                <Td>
                  <div className="font-medium">{a.product.name}</div>
                  <div className="text-xs text-subtle">{a.product.category}</div>
                </Td>
                <Td>
                  <ScoreBar value={a.demand} label={demandLabel(a.demand)} />
                </Td>
                <Td align="right">{formatEur(a.product.targetPriceGross)}</Td>
                <Td align="right">
                  <div>
                    {formatEur(a.minCost)} – {formatEur(a.maxCost)}
                  </div>
                  <div className="text-xs text-subtle">{a.offers.length} Angebote, inkl. Versand</div>
                </Td>
                <Td>
                  {a.best ? (
                    <>
                      <div>{a.best.offer.supplierName}</div>
                      <div className="text-xs tabular-nums text-subtle">{formatEur(a.best.landedCost)} gesamt</div>
                    </>
                  ) : (
                    <span className="text-muted">Kein geeignetes Angebot</span>
                  )}
                </Td>
                <Td align="right" className={a.margin && a.margin.contribution < 0 ? "text-rose-300" : ""}>
                  {a.margin ? formatEur(a.margin.contribution) : "–"}
                </Td>
                <Td align="right" className={a.margin && a.margin.contribution < 0 ? "text-rose-300" : ""}>
                  {a.margin ? formatPercent(a.margin.marginPercent) : "–"}
                </Td>
                <Td>
                  <Badge tone={RECOMMENDATION_LABEL[a.recommendation].tone}>{RECOMMENDATION_LABEL[a.recommendation].label}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-fg">Kalkulation je Produkt</h2>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {analyses.map(({ product, margin, best }) => (
          <Card key={product.id} title={product.name} description={best ? `Basis: ${best.offer.supplierName}` : undefined}>
            {margin ? (
              <dl className="space-y-1.5 text-sm">
                <Row label="Verkaufspreis brutto" value={formatEur(margin.priceGross)} />
                <Row label="− Umsatzsteuer 19 %" value={formatEur(margin.vat)} muted />
                <Row label="= Nettoerlös" value={formatEur(margin.priceNet)} strong />
                <Row label="− Ware, Versand, Import" value={formatEur(margin.landedCost)} muted />
                <Row label="− Zahlungsgebühr" value={formatEur(margin.paymentFee)} muted />
                <Row label="− Werbekosten je Verkauf" value={formatEur(margin.adCost)} muted />
                <Row label="− Retourenreserve" value={formatEur(margin.returnsReserve)} muted />
                <div className="border-t border-line pt-1.5">
                  <Row
                    label="= Deckungsbeitrag"
                    value={`${formatEur(margin.contribution)} · ${formatPercent(margin.marginPercent)}`}
                    strong
                    negative={margin.contribution < 0}
                  />
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted">Kein geeigneter Lieferant – keine Kalkulation möglich.</p>
            )}
            <div className="mt-4 rounded-lg border border-line bg-surface-2/50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-amber-200">
                <ShieldAlert className="size-3.5" aria-hidden /> Vor Verkauf zu prüfen
              </p>
              <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-muted">
                {product.complianceNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>

      <Card title="Annahmen der Kalkulation" description="Platzhalter – vor dem Live-Betrieb durch echte Konditionen ersetzen" className="mt-8">
        <div className="grid gap-6 text-sm md:grid-cols-3">
          <dl className="space-y-1.5">
            <Row label="Zahlungsgebühr" value={`${formatPercent(ASSUMPTIONS.paymentFeePercent)} + ${formatEur(ASSUMPTIONS.paymentFeeFixed)}`} />
            <Row label="Werbekosten je Verkauf" value={formatEur(ASSUMPTIONS.adCostPerOrder)} />
            <Row label="Retourenreserve" value={formatPercent(ASSUMPTIONS.returnsReservePercent)} />
            <Row label="Auszahlungsdauer" value={`${ASSUMPTIONS.payoutDelayDays} Tage`} />
          </dl>
          <dl className="space-y-1.5">
            <Row label="Gewicht Suchtrend" value={formatPercent(DEMAND_WEIGHTS.searchTrend)} />
            <Row label="Gewicht Social Buzz" value={formatPercent(DEMAND_WEIGHTS.socialBuzz)} />
            <Row label="Gewicht geringer Wettbewerb" value={formatPercent(DEMAND_WEIGHTS.lowCompetition)} />
            <Row label="Gewicht Saison" value={formatPercent(DEMAND_WEIGHTS.seasonality)} />
          </dl>
          <dl className="space-y-1.5">
            <Row label="Kandidat ab Marge" value={formatPercent(RECOMMENDATION_RULES.candidateMinMargin)} />
            <Row label="Kandidat ab Nachfrage" value={String(RECOMMENDATION_RULES.candidateMinDemand)} />
            <Row label="Beobachten ab Marge" value={formatPercent(RECOMMENDATION_RULES.watchMinMargin)} />
          </dl>
        </div>
      </Card>
    </>
  );
}

function Row({ label, value, muted, strong, negative }: { label: string; value: string; muted?: boolean; strong?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={muted ? "text-muted" : "text-fg"}>{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : ""} ${negative ? "text-rose-300" : muted ? "text-muted" : "text-fg"}`}>{value}</dd>
    </div>
  );
}
