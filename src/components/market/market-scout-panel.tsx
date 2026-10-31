// Market Scout im Dashboard: gefundene Kandidaten, Belege, Lieferant, Marge, Sperrgründe, Entwurfsstatus.
// Reine Anzeige (Server Component): keine Knöpfe, keine Formulare, keine Freigabe, kein Shopify-Zugriff.

import { CircleCheck, CircleSlash, CircleX, ExternalLink, FileText, Lock } from "lucide-react";
import { Badge, DemoBadge, type BadgeTone } from "@/components/ui/badge";
import type { MarketScoutOverview } from "@/lib/data";
import { formatDateTime, formatDays, formatEur, formatPercent } from "@/lib/format";
import {
  CANDIDATE_STATE_LABELS,
  RISK_LABELS,
  SIGNAL_KIND_LABELS,
  STAGE_LABELS,
  type CandidateState,
  type InterestMetrics,
  type StageStatus,
  type StoredCandidate,
} from "@/lib/market";

const STATE_TONES: Record<CandidateState, BadgeTone> = {
  unreviewed: "neutral",
  deferred: "blue",
  blocked: "amber",
  approved: "green",
  draft_created: "cyan",
};

const STAGE_ICON: Record<StageStatus, { icon: typeof CircleCheck; className: string; label: string }> = {
  ok: { icon: CircleCheck, className: "text-emerald-300", label: "bestanden" },
  deferred: { icon: CircleSlash, className: "text-blue-300", label: "zurückgestellt" },
  blocked: { icon: CircleX, className: "text-amber-300", label: "gesperrt" },
  skipped: { icon: CircleSlash, className: "text-subtle", label: "übersprungen" },
};

const signed = (v: number | null) => (v === null ? "–" : `${v >= 0 ? "+" : ""}${formatPercent(v)}`);

function Trend({ m }: { m: InterestMetrics }) {
  return (
    <span className="tabular-nums">
      Ø {m.avg30.toLocaleString("de-DE")} Aufrufe/Tag · 7 Tage {signed(m.trend7)} · 30 Tage {signed(m.trend30)} · Saison{" "}
      {m.seasonalIndex === null ? "unbekannt" : m.seasonalIndex.toLocaleString("de-DE", { maximumFractionDigits: 2 })}
    </span>
  );
}

function CandidateCard({ c }: { c: StoredCandidate }) {
  const r = c.latest;
  const interest = r.candidate.signals.find((s) => s.interest);
  const sim = r.candidate.signals.find((s) => s.simulated);
  return (
    <li className="rounded-xl border border-line bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-fg">{r.candidate.title}</p>
          <p className="text-xs text-subtle">{r.candidate.discoveredVia}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.candidate.demo && <DemoBadge />}
          <Badge tone={STATE_TONES[r.state]}>{CANDIDATE_STATE_LABELS[r.state]}</Badge>
          <Badge tone="neutral">
            {r.score.score}/100 · Unsicherheit {formatPercent(r.score.uncertainty)}
          </Badge>
        </div>
      </div>

      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-subtle">Trend</dt>
          <dd className="mt-0.5 text-fg">
            {interest?.interest ? <Trend m={interest.interest} /> : sim?.simulated ? `Simuliert: Suchtrend ${sim.simulated.searchTrend}/100` : "Keine Daten"}
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Lieferant</dt>
          <dd className="mt-0.5 text-fg">
            {r.supplier ? (
              <>
                {r.supplier.supplierName}
                {r.supplier.demo && !/demo/i.test(r.supplier.supplierName) ? " (Demo)" : ""} · {formatEur(r.supplier.perUnit)} · {formatDays(r.supplier.deliveryDays.min, r.supplier.deliveryDays.max)}
                {r.supplier.requiresPrefinancing ? " · Vorfinanzierung nötig" : ""}
              </>
            ) : (
              "Keiner gefunden"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Gewinnspanne</dt>
          <dd className="mt-0.5 text-fg">
            {r.profit?.contribution != null && r.profit.marginPercent != null ? (
              <>
                {formatEur(r.profit.contribution)} ({formatPercent(r.profit.marginPercent)}){r.profit.reliable ? "" : " – nicht verlässlich"}
              </>
            ) : (
              "Nicht berechenbar"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Shopify-Entwurf</dt>
          <dd className="mt-0.5 text-fg">
            {r.draft.status === "dry_run_prepared" ? (
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3.5 text-cyan-300" aria-hidden /> Dry-Run vorbereitet, nicht angelegt
              </span>
            ) : (
              "Nicht vorbereitet"
            )}
          </dd>
        </div>
      </dl>

      {r.stateReasons.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs leading-snug text-muted">
          {r.stateReasons.map((reason) => (
            <li key={reason}>• {reason}</li>
          ))}
        </ul>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer select-none text-muted hover:text-fg">Bewertung, Belege und Pipeline anzeigen</summary>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div>
            <p className="font-medium text-subtle">Warum interessant (Opportunity Score)</p>
            <ul className="mt-1 space-y-1">
              {r.score.components.map((x) => (
                <li key={x.key} className="flex justify-between gap-2">
                  <span className="text-muted">
                    {x.label} <span className="text-subtle">({formatPercent(x.weight)})</span>
                    <br />
                    <span className="text-subtle">{x.detail}</span>
                  </span>
                  <span className={`shrink-0 tabular-nums ${x.status === "missing" ? "text-amber-300" : "text-fg"}`}>
                    {x.value === null ? "fehlt" : `${x.value.toLocaleString("de-DE")}${x.status === "uncertain" ? " ?" : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium text-subtle">Belege</p>
            <ul className="mt-1 space-y-1 text-muted">
              {r.candidate.signals.length === 0 && <li>Keine Marktsignale.</li>}
              {r.candidate.signals.map((s) => (
                <li key={s.sourceId}>
                  {s.sourceName}
                  <br />
                  <span className="text-subtle">{SIGNAL_KIND_LABELS[s.kind]}</span>
                  {!s.demo && s.reference.startsWith("https://") && (
                    <>
                      <br />
                      <a href={s.reference} className="inline-flex items-center gap-1 text-accent hover:underline" rel="noreferrer noopener" target="_blank">
                        Quelle öffnen <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </>
                  )}
                </li>
              ))}
              <li>
                Risiko {RISK_LABELS[r.risk.level]}: <span className="text-subtle">{r.risk.reasons.join("; ")}</span>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-subtle">Pipeline</p>
            <ol className="mt-1 space-y-1.5">
              {r.stages.length === 0 && <li className="text-muted">Noch nicht bewertet.</li>}
              {r.stages.map((s) => {
                const st = STAGE_ICON[s.status];
                return (
                  <li key={s.key}>
                    <span className="inline-flex items-center gap-1 text-fg">
                      <st.icon className={`size-3.5 ${st.className}`} aria-hidden /> {STAGE_LABELS[s.key]} – {st.label}
                    </span>
                    {s.status !== "skipped" && (
                      <ul className="ml-4.5 mt-0.5 space-y-0.5 text-subtle">
                        {s.details.slice(0, 5).map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </details>
    </li>
  );
}

/** Gefundene Kandidaten mit Bewertung und Pipeline-Ergebnis. */
export function MarketScoutPanel({ overview }: { overview: MarketScoutOverview }) {
  const shown = overview.candidates.filter((c) => c.latest.state !== "unreviewed");
  const pending = overview.candidates.length - shown.length;
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <MarketRunStatus overview={overview} />
      {shown.length === 0 ? (
        <p className="text-sm text-muted">Noch keine bewerteten Kandidaten.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => (
            <CandidateCard key={c.latest.candidate.key} c={c} />
          ))}
        </ul>
      )}
      {pending > 0 && <p className="text-xs text-muted">{pending} weitere gefundene Themen sind noch ungeprüft und folgen in späteren Läufen.</p>}
      <p className="flex items-start gap-2 text-xs text-muted">
        <Lock className="mt-0.5 size-3.5 shrink-0 text-subtle" aria-hidden />
        Der Market Scout gibt nichts frei, kauft nichts, schaltet keine Werbung und legt in Shopify nichts an. Entwürfe entstehen nur als Dry-Run;
        Freigaben erteilen Menschen.
      </p>
    </div>
  );
}

/** Kompakter Laufstatus (auch für die Agenten-Seite). */
export function MarketRunStatus({ overview }: { overview: MarketScoutOverview }) {
  const run = overview.lastRun;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {overview.origin === "demo" ? (
        <Badge tone="amber">Demo-Vorschau – noch kein gespeicherter Lauf</Badge>
      ) : (
        <Badge tone={run?.mode === "live" ? "green" : "amber"}>{run?.mode === "live" ? "Letzter Lauf mit realer Quelle" : "Letzter Lauf nur Demo"}</Badge>
      )}
      {run && overview.origin === "stored" && <span>{formatDateTime(run.finishedAt)}</span>}
      {run && (
        <span className="tabular-nums">
          Abrufe {run.requests.used}/{run.requests.limit} · Kosten {formatEur(run.costEur)}
        </span>
      )}
      {run?.aborted && <Badge tone="red">Abgebrochen: {run.aborted}</Badge>}
      <span>
        Abbruchschalter:{" "}
        {!overview.enabled ? <Badge tone="red">im Code aus</Badge> : overview.stopRequested ? <Badge tone="red">STOP aktiv</Badge> : "nicht gesetzt"}
      </span>
      {overview.errors.map((e) => (
        <Badge key={e} tone="red">
          {e}
        </Badge>
      ))}
    </div>
  );
}
