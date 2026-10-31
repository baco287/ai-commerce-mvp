// Lieferanten-Seite: Darstellung der Supplier-Scout-Ergebnisse. Server-Komponenten ohne Interaktion
// außer nativem <details>. Bewusst KEINE Bestell-, Kauf- oder Freigabe-Knöpfe – eine Empfehlung ist
// keine Einkaufsfreigabe.

import {
  Award,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  FileWarning,
  FlaskConical,
  Gauge,
  Link2,
  Lock,
  PackageX,
  PiggyBank,
  Truck,
  Wallet,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge, DemoBadge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDays, formatEur, formatPercent } from "@/lib/format";
import { PAYMENT_TERMS_LABEL } from "@/lib/labels";
import type { FactCell, Flag, FlagKind, OfferView, ProductSupplierView, RecommendationView, SupplierProductLink } from "@/lib/suppliers";
import type { FactStatus } from "@/lib/suppliers";

const FLAG_STYLE: Record<FlagKind, { tone: BadgeTone; icon: typeof Lock }> = {
  demo: { tone: "amber", icon: FlaskConical },
  missing_evidence: { tone: "red", icon: FileWarning },
  uncertain_financing: { tone: "amber", icon: Wallet },
  delivery_unconfirmed: { tone: "amber", icon: PackageX },
  dropshipping_unconfirmed: { tone: "amber", icon: Truck },
};

const RECOMMENDATION_ICON = { cheapest: PiggyBank, fastest: Zap, best: Award } as const;

const STATUS_LABEL: Record<FactStatus, string> = { confirmed: "bestätigt", unconfirmed: "unbestätigt", missing: "fehlt" };

/** Kleines Symbol für den Status einer Angabe – Text steht im title und für Screenreader daneben. */
function StatusMark({ status }: { status: FactStatus }) {
  const Icon = status === "confirmed" ? CircleCheck : status === "unconfirmed" ? CircleDashed : CircleMinus;
  const color = status === "confirmed" ? "text-emerald-400" : status === "unconfirmed" ? "text-amber-300" : "text-rose-300";
  return (
    <span title={STATUS_LABEL[status]} className={`inline-flex shrink-0 ${color}`}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">({STATUS_LABEL[status]})</span>
    </span>
  );
}

function FactValue<T>({ cell, format }: { cell: FactCell<T>; format: (v: T) => string }) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      {cell.value === undefined ? <span className="text-subtle">–</span> : format(cell.value)}
      <StatusMark status={cell.status} />
    </span>
  );
}

function FlagBadges({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => {
        const { tone, icon: Icon } = FLAG_STYLE[f.kind];
        return (
          <Badge key={f.kind} tone={tone}>
            <Icon className="size-3" aria-hidden /> {f.label}
          </Badge>
        );
      })}
    </div>
  );
}

function FlagDetails({ flags }: { flags: Flag[] }) {
  const relevant = flags.filter((f) => f.kind !== "demo");
  if (!relevant.length) return null;
  return (
    <ul className="space-y-1 text-xs text-muted">
      {relevant.map((f) => (
        <li key={f.kind}>
          <span className="font-medium text-fg">{f.label}:</span> {f.details.join(" · ")}
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** Kennzahlen eines Angebots: Kosten, Lieferzeit, Bestand, Finanzierung, Marge. */
function OfferFacts({ offer }: { offer: OfferView }) {
  return (
    <dl className="space-y-1 text-xs">
      <Row label="Einkauf">
        <FactValue cell={offer.unitPrice} format={formatEur} />
      </Row>
      <Row label="Versand nach DE">
        <FactValue cell={offer.shippingCost} format={formatEur} />
      </Row>
      <Row label="Import">
        <FactValue cell={offer.importCost} format={formatEur} />
      </Row>
      <Row label="Gesamt je Stück">
        <span className="font-semibold tabular-nums text-fg">{offer.perUnit === null ? "unvollständig" : formatEur(offer.perUnit)}</span>
      </Row>
      <Row label="Lieferzeit DE">
        <FactValue cell={offer.deliveryDays} format={(d) => formatDays(d.min, d.max)} />
      </Row>
      <Row label="Lieferantenbestand">
        <FactValue cell={offer.stock} format={(v) => `${v} Stk.`} />
      </Row>
      <Row label="Versand aus">{offer.shipsFrom ?? "–"}</Row>
      <Row label="Marge (Kalkulation)">
        {offer.margin ? (
          <span className={`tabular-nums ${offer.margin.contribution < 0 ? "text-rose-300" : "text-fg"}`}>
            {formatPercent(offer.margin.marginPercent)} · {formatEur(offer.margin.contribution)} je Verkauf
          </span>
        ) : (
          "–"
        )}
      </Row>
    </dl>
  );
}

function FinancingBadge({ offer }: { offer: OfferView }) {
  return offer.financing.requiresPrefinancing ? (
    <Badge tone="amber">
      <Wallet className="size-3" aria-hidden /> Vorfinanzierung nötig
    </Badge>
  ) : (
    <Badge tone="green">
      <Wallet className="size-3" aria-hidden /> Zahlungsziel bestätigt
    </Badge>
  );
}

function RecommendationCard({ rec, isBasis }: { rec: RecommendationView; isBasis: boolean }) {
  const o = rec.offer;
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface-2/40 p-4">
      <header className="space-y-1">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
          {rec.kinds.map((k) => {
            const Icon = RECOMMENDATION_ICON[k];
            return <Icon key={k} className="size-3.5 text-accent" aria-hidden />;
          })}
          {rec.title}
        </p>
        <p className="break-words text-sm font-semibold text-fg">{o.supplierName}</p>
        <div className="flex flex-wrap gap-1">
          {isBasis && <Badge tone="cyan">Kalkulationsbasis</Badge>}
          <FinancingBadge offer={o} />
        </div>
      </header>
      <OfferFacts offer={o} />
      <FlagBadges flags={o.flags} />
      <p className="rounded-lg border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-[11px] text-amber-100">
        <Lock className="mr-1 inline size-3" aria-hidden />
        Empfehlung, keine Einkaufsfreigabe · Einkaufssperre: {PAYMENT_TERMS_LABEL[o.purchaseGuardTerms]}
      </p>
      <details className="group text-xs">
        <summary className="cursor-pointer select-none text-accent">Begründung und offene Punkte</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
          {rec.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="mt-2">
          <FlagDetails flags={o.flags} />
        </div>
      </details>
    </article>
  );
}

/** Kompakte Karte für ein Angebot in der Gesamtliste (geeignet oder ausgeschlossen). */
function OfferCard({ offer, isBasis }: { offer: OfferView; isBasis: boolean }) {
  return (
    <li className="min-w-0 rounded-lg border border-line bg-surface-2/30 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-medium">{offer.supplierName}</p>
        <div className="flex flex-wrap gap-1">
          {isBasis && <Badge tone="cyan">Kalkulationsbasis</Badge>}
          {offer.score !== null && (
            <Badge tone="neutral">
              <Gauge className="size-3" aria-hidden /> {offer.score.toLocaleString("de-DE", { maximumFractionDigits: 1 })} / 100
            </Badge>
          )}
          {offer.eligible ? <FinancingBadge offer={offer} /> : <Badge tone="red">ausgeschlossen</Badge>}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <OfferFacts offer={offer} />
        <div className="space-y-2 text-xs">
          {offer.exclusions.length > 0 && (
            <div>
              <p className="font-medium text-rose-200">Ausschlussgründe</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                {offer.exclusions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted">
            <span className="text-emerald-300">{offer.facts.confirmed.length} bestätigt</span> ·{" "}
            <span className="text-amber-200">{offer.facts.unconfirmed.length} unbestätigt</span> ·{" "}
            <span className="text-rose-200">{offer.facts.missing.length} fehlend</span>
          </p>
          {offer.facts.unconfirmed.length > 0 && <p className="text-muted">Unbestätigt: {offer.facts.unconfirmed.join(", ")}</p>}
          {offer.facts.missing.length > 0 && <p className="text-muted">Fehlend: {offer.facts.missing.join(", ")}</p>}
          <FlagBadges flags={offer.flags} />
        </div>
      </div>
    </li>
  );
}

/** Geplante Zuordnung zu Shopify – zeigt, was eine spätere Automatisierung schon hat und was noch fehlt. */
function LinkSection({ link }: { link: SupplierProductLink }) {
  const headingId = `${link.productId}-kopplung`;
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-dashed border-line p-3 text-xs">
      <h3 id={headingId} className="flex items-center gap-1.5 font-medium text-fg">
        <Link2 className="size-3.5 text-muted" aria-hidden /> Kopplung an Shopify – {link.productName} (Planung, nur Anzeige)
      </h3>
      <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Row label="GTIN">{link.gtin ?? "–"}</Row>
        <Row label="Shopify-Handle">
          <span className="break-all font-mono">{link.shopifyHandle ?? "–"}</span>
        </Row>
        <Row label="Varianten-SKUs">
          <span className="break-all font-mono">{link.shopifySkus.join(", ") || "–"}</span>
        </Row>
        <Row label="supplier_offer_id (geplant)">
          <span className="break-all font-mono">{link.supplierOfferId ?? "–"}</span>
        </Row>
      </dl>
      <p className="mt-2 text-muted">
        Die Angebots-ID wird nur beim Neuanlegen von Entwürfen als Metafeld übertragen – sie steht nicht zwingend schon in Shopify.
        Diese Seite liest Shopify nicht.
      </p>
      {(link.problems.length > 0 || link.variantsWithoutSupplierSku.length > 0) && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-amber-200">
          {link.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
          {link.variantsWithoutSupplierSku.length > 0 && (
            <li>Noch ohne Lieferanten-Artikelnummer je Variante: {link.variantsWithoutSupplierSku.join(", ")}</li>
          )}
        </ul>
      )}
    </section>
  );
}

/** Abschnitt je Produkt mit Empfehlungen, Nachweisen und allen Angeboten. */
export function ProductSuppliers({ view, link }: { view: ProductSupplierView; link?: SupplierProductLink }) {
  const basis = view.calculationBasisId;
  const best = view.recommendations.find((r) => r.kinds.includes("best"))?.offer;
  return (
    <div id={view.productId} className="scroll-mt-32 lg:scroll-mt-20">
      <Card
        title={view.productName}
        description={`Verkaufspreis ${formatEur(view.priceGross)} brutto · ${view.eligible.length} geeignete, ${view.excluded.length} ausgeschlossene Angebote`}
        action={view.containsDemoData ? <DemoBadge label="Demo-Daten" /> : undefined}
        flush
      >
        <div className="space-y-5 p-4 sm:p-5">
          {view.noSupplier ? (
            <p className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/5 px-3 py-2 text-sm text-rose-100">
              <PackageX className="mt-0.5 size-4 shrink-0" aria-hidden /> Kein geeigneter Lieferant – das Produkt ist derzeit nicht lieferbar.
            </p>
          ) : (
            <div className={`grid gap-3 ${view.recommendations.length >= 3 ? "lg:grid-cols-3" : view.recommendations.length === 2 ? "md:grid-cols-2" : ""}`}>
              {view.recommendations.map((r) => (
                <RecommendationCard key={r.offer.quoteId} rec={r} isBasis={r.offer.quoteId === basis} />
              ))}
            </div>
          )}

          <section aria-labelledby={`${view.productId}-nachweise`} className="rounded-lg border border-line p-3 text-xs">
            <h3 id={`${view.productId}-nachweise`} className="flex items-center gap-1.5 font-medium text-fg">
              <FileWarning className="size-3.5 text-amber-300" aria-hidden /> Offene Compliance-Nachweise – {view.productName}
            </h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-muted">Produkt (vor Verkauf zu prüfen)</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">
                  {view.complianceNotes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-muted">Pflichtunterlagen beim insgesamt besten Angebot{best ? ` (${best.supplierName})` : ""}</p>
                <ul className="mt-1 space-y-0.5">
                  {view.requiredDocuments.map((d) => {
                    const open = !best || best.openDocuments.includes(d);
                    return (
                      <li key={d} className="flex items-start gap-1.5">
                        <StatusMark status={open ? "missing" : "confirmed"} />
                        <span className={open ? "text-rose-200" : "text-muted"}>
                          {d}
                          {open ? " – fehlt" : " – liegt vor (Demo)"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </section>

          {link && <LinkSection link={link} />}

          <details className="group">
            <summary className="cursor-pointer select-none text-sm text-accent">Alle geeigneten Angebote ({view.eligible.length})</summary>
            <ul className="mt-3 space-y-2">
              {view.eligible.map((o) => (
                <OfferCard key={o.quoteId} offer={o} isBasis={o.quoteId === basis} />
              ))}
            </ul>
          </details>

          {view.excluded.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer select-none text-sm text-accent">Ausgeschlossene Angebote mit Gründen ({view.excluded.length})</summary>
              <ul className="mt-3 space-y-2">
                {view.excluded.map((o) => (
                  <OfferCard key={o.quoteId} offer={o} isBasis={false} />
                ))}
              </ul>
            </details>
          )}
        </div>
      </Card>
    </div>
  );
}

/** Übersicht aller Produkte – auf dem Smartphone als Karten, ab md als Raster. */
export function ScoutOverview({ views }: { views: ProductSupplierView[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {views.map((v) => {
        const basis = v.recommendations.find((r) => r.kinds.includes("cheapest"))?.offer;
        const best = v.recommendations.find((r) => r.kinds.includes("best"))?.offer;
        const open = v.bestOpenPoints.length;
        const compliance = v.complianceNotes.length;
        return (
          <li key={v.productId}>
            <a
              href={`#${v.productId}`}
              className="block h-full rounded-xl border border-line bg-surface/80 p-3 transition-colors hover:border-cyan-400/40"
            >
              <p className="text-sm font-medium text-fg">{v.productName}</p>
              {v.noSupplier ? (
                <p className="mt-2 text-xs text-rose-200">Kein geeigneter Lieferant</p>
              ) : (
                <dl className="mt-2 space-y-1 text-xs">
                  <Row label="Bester">{best?.supplierName ?? "–"}</Row>
                  <Row label="Kalkulationsbasis">{basis?.perUnit != null ? formatEur(basis.perUnit) : "–"}</Row>
                  <Row label="Marge (Basis)">
                    {basis?.margin ? (
                      <span className={basis.margin.marginPercent < 0 ? "text-rose-300" : undefined}>{formatPercent(basis.margin.marginPercent)}</span>
                    ) : (
                      "–"
                    )}
                  </Row>
                </dl>
              )}
              <p className="mt-2 text-[11px] text-amber-200">
                Vor Freigabe zu klären: {open} {open === 1 ? "Hinweis" : "Hinweise"} beim besten Angebot · {compliance}{" "}
                {compliance === 1 ? "Compliance-Punkt" : "Compliance-Punkte"} zum Produkt
              </p>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function StatusLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span className="inline-flex items-center gap-1">
        <StatusMark status="confirmed" /> bestätigt (geprüfte Quelle)
      </span>
      <span className="inline-flex items-center gap-1">
        <StatusMark status="unconfirmed" /> unbestätigt (Selbstauskunft, Schätzung)
      </span>
      <span className="inline-flex items-center gap-1">
        <StatusMark status="missing" /> fehlt
      </span>
    </p>
  );
}
