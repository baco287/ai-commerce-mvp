"use client";

import { CircleCheck, Lock, TriangleAlert, Trophy, Wallet, Zap, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Badge, DemoBadge } from "@/components/ui/badge";
import type { SupplierScoutItem } from "@/lib/data";
import { formatDays, formatEur, formatPercent } from "@/lib/format";
import {
  ADAPTER_STATUS_LABEL,
  EVIDENCE_STATUS_LABEL,
  EXCLUSION_LABEL,
  FINANCING_STATUS_LABEL,
  SCOUT_RECOMMENDATION_LABEL,
} from "@/lib/labels";
import type { AdapterRun, ProductQuery, QuoteEvaluation, Recommendation, RecommendationKind } from "@/lib/suppliers";
import { evidenceFor } from "@/lib/suppliers/evidence";
import { factValue } from "@/lib/suppliers/model";

const KINDS: { kind: RecommendationKind; icon: LucideIcon; hint: string }[] = [
  { kind: "cheapest", icon: Wallet, hint: "Niedrigste Gesamtkosten je Stück" },
  { kind: "fastest", icon: Zap, hint: "Kürzeste Lieferzeit bis zum Kunden" },
  { kind: "best", icon: Trophy, hint: "Kosten, Tempo, Zuverlässigkeit und Finanzierung gewichtet" },
];

const points = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/**
 * Empfehlungen des Supplier Scouts je Produkt: günstigster, schnellster und insgesamt bester
 * geeigneter Lieferant. Reine Anzeige – hier wird nichts bestellt oder freigegeben.
 */
export function ScoutRecommendations({ items }: { items: SupplierScoutItem[] }) {
  const [selected, setSelected] = useState(items[0]?.product.id);
  const item = items.find((i) => i.product.id === selected) ?? items[0];
  if (!item) return null;
  const report = item.report;

  return (
    <div>
      <div role="tablist" aria-label="Produkt wählen" className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-3">
        {items.map((i) => {
          const active = i.product.id === item.product.id;
          return (
            <button
              key={i.product.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setSelected(i.product.id)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors ${
                active ? "border-cyan-400 text-fg" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {i.product.name}
            </button>
          );
        })}
      </div>

      {!report ? (
        <p className="px-5 py-6 text-sm text-muted">Für dieses Produkt ist noch keine Lieferantensuche definiert.</p>
      ) : (
        <div role="tabpanel" className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted">
            <span>
              Verkaufspreis <span className="font-medium tabular-nums text-fg">{formatEur(item.product.targetPriceGross)}</span> brutto
            </span>
            <span>
              {report.eligible.length + report.excluded.length} Angebote geprüft · {report.eligible.length} geeignet ·{" "}
              {report.excluded.length} ausgeschlossen
            </span>
          </div>

          {report.notes.map((note) => (
            <p key={note} className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-200">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {note}
            </p>
          ))}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {KINDS.map(({ kind, icon, hint }) => {
              const rec = report.recommendations[kind];
              return (
                <RecommendationCard
                  key={kind}
                  kind={kind}
                  icon={icon}
                  hint={hint}
                  rec={rec}
                  query={report.query}
                  evaluation={rec ? report.eligible.find((e) => e.quote.id === rec.quoteId) : undefined}
                  margin={rec ? item.margins[rec.quoteId] : undefined}
                />
              );
            })}
          </div>

          <ExcludedOffers excluded={report.excluded} />
          <DataSources adapters={report.adapters} />

          <p className="flex items-start gap-2 text-xs text-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
            Eine Empfehlung ist keine Einkaufsfreigabe. Lieferantenwechsel brauchen eine manuelle Freigabe, Bestellungen sind im MVP
            gesperrt.
          </p>
        </div>
      )}
    </div>
  );
}

function RecommendationCard({
  kind,
  icon: Icon,
  hint,
  rec,
  query,
  evaluation,
  margin,
}: {
  kind: RecommendationKind;
  icon: LucideIcon;
  hint: string;
  rec: Recommendation | null;
  query: ProductQuery;
  evaluation?: QuoteEvaluation;
  margin?: { contribution: number; marginPercent: number };
}) {
  const title = SCOUT_RECOMMENDATION_LABEL[kind];
  const header = (
    <div className="flex items-center gap-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-400/25">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="truncate text-[11px] text-subtle">{hint}</p>
      </div>
    </div>
  );

  if (!rec) {
    return (
      <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface-2/40 p-4">
        {header}
        <p className="text-sm text-muted">Kein geeigneter Lieferant.</p>
      </article>
    );
  }

  const financing = FINANCING_STATUS_LABEL[rec.financingStatus];
  return (
    <article aria-label={`${title}: ${rec.supplierName}`} className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface-2/40 p-4">
      {header}

      <div>
        <p className="font-medium text-fg">{rec.supplierName}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {rec.demo && <DemoBadge />}
          <Badge tone={financing.tone}>{financing.label}</Badge>
        </div>
        {/* Detail nur bei einem Zahlungsziel in Tagen – bei Vorkasse/unbekannt sagt das Abzeichen schon alles */}
        {evaluation && (evaluation.financing.termDays ?? 0) > 0 && (
          <p className="mt-1.5 text-[11px] leading-snug text-muted">{evaluation.financing.label}.</p>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-subtle">Gesamt je Stück</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-fg">{formatEur(rec.perUnit)}</dd>
        </div>
        <div>
          <dt className="text-subtle">Lieferzeit</dt>
          <dd className="mt-0.5 tabular-nums text-fg">{formatDays(rec.deliveryDays.min, rec.deliveryDays.max)}</dd>
        </div>
        <div>
          <dt className="text-subtle">Punkte</dt>
          <dd className="mt-0.5 tabular-nums text-fg">{points.format(rec.score)}/100</dd>
        </div>
        {margin && (
          <div className="col-span-3">
            <dt className="text-subtle">Deckungsbeitrag je Verkauf</dt>
            <dd className={`mt-0.5 tabular-nums ${margin.contribution < 0 ? "text-rose-300" : "text-fg"}`}>
              {formatEur(margin.contribution)} <span className="text-subtle">({formatPercent(margin.marginPercent)})</span>
            </dd>
          </div>
        )}
      </dl>

      {evaluation && (
        <div>
          <p className="text-[11px] font-medium text-subtle">Nachweise</p>
          <ul className="mt-1 grid grid-cols-1 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {evidenceFor(evaluation.quote, query).map((e) => {
              const s = EVIDENCE_STATUS_LABEL[e.status];
              return (
                <li key={e.key} className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-muted">{e.label}</span>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {rec.openPoints.length > 0 ? (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200">
            <TriangleAlert className="size-3.5" aria-hidden />
            {rec.openPoints.length === 1 ? "1 offener Punkt" : `${rec.openPoints.length} offene Punkte`} vor einer Freigabe
          </p>
          <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-muted">
            {rec.openPoints.map((p) => (
              <li key={p.code}>• {p.message}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-[11px] text-emerald-300">
          <CircleCheck className="size-3.5" aria-hidden /> Keine offenen Punkte
        </p>
      )}

      <details className="group mt-auto text-xs">
        <summary className="cursor-pointer select-none text-muted hover:text-fg">Begründung anzeigen</summary>
        <ul className="mt-2 space-y-1 leading-relaxed text-muted">
          {rec.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

/** Ausgeschlossene Angebote mit Gründen – sie werden nie empfohlen. */
function ExcludedOffers({ excluded }: { excluded: QuoteEvaluation[] }) {
  if (excluded.length === 0) return null;
  return (
    <details className="rounded-xl border border-line bg-surface-2/30">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm text-fg hover:text-cyan-300">
        {excluded.length === 1 ? "1 ausgeschlossenes Angebot" : `${excluded.length} ausgeschlossene Angebote`}
        <span className="text-muted"> – Gründe anzeigen</span>
      </summary>
      <ul className="divide-y divide-line border-t border-line">
        {excluded.map((e) => {
          const codes = [...new Set(e.eligibility.exclusions.map((x) => x.code))];
          const from = factValue(e.quote.fulfillment.shipsFrom);
          return (
            <li key={e.quote.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-fg">{e.quote.supplierName}</span>
                {from && <span className="text-xs text-subtle">Versand aus {from}</span>}
                {e.cost && <span className="text-xs tabular-nums text-subtle">· {formatEur(e.cost.perUnit)} je Stück</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {codes.map((c) => (
                  <Badge key={c} tone="red">
                    {EXCLUSION_LABEL[c]}
                  </Badge>
                ))}
              </div>
              <ul className="mt-1.5 space-y-0.5 text-xs leading-snug text-muted">
                {e.eligibility.exclusions.map((x) => (
                  <li key={x.message}>• {x.message}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** Welche Datenquellen abgefragt, gesperrt oder fehlerhaft waren. */
function DataSources({ adapters }: { adapters: AdapterRun[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      <span className="text-subtle">Datenquellen:</span>
      {adapters.map((a) => {
        const s = ADAPTER_STATUS_LABEL[a.status];
        return (
          <span key={a.adapterId} className="inline-flex items-center gap-1.5" title={a.message}>
            {a.adapterName}
            <Badge tone={s.tone}>
              {s.label}
              {a.status === "ok" ? ` · ${a.quoteCount}` : ""}
            </Badge>
          </span>
        );
      })}
    </div>
  );
}
