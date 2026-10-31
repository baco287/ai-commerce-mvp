import { Lock, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { ApprovalQueue } from "@/components/approvals/approval-queue";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { APPROVAL_RULES, BUDGET, LIMITS, SAFETY_SWITCHES, SAFETY_SWITCH_LABELS } from "@/lib/config/budget";
import { getAgents, getApprovals } from "@/lib/data";
import { formatEur, formatEur0, formatPercent } from "@/lib/format";

export const metadata: Metadata = { title: "Freigaben & Budget" };

export default async function ApprovalsPage() {
  // Dynamisch je Anfrage: Die Seite liest lokale Laufzeitdaten (.data/) – nie beim Build vorrendern (Paket I).
  await connection();
  const approvals = getApprovals();
  const agentNames = Object.fromEntries(getAgents().map((a) => [a.id, a.name]));

  return (
    <>
      <PageHeader
        title="Freigaben & Budget"
        description="Menschliche Kontrolle über alles, was Geld kostet oder nach außen wirkt. Entscheidungen hier sind im MVP Demo-Aktionen ohne Wirkung."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Freigabe-Warteschlange"
          description="Anfragen der Agenten"
          action={<Badge tone="amber">Demo – keine Wirkung</Badge>}
          className="xl:col-span-2"
          flush
        >
          <ApprovalQueue approvals={approvals} agentNames={agentNames} />
        </Card>

        <div className="space-y-4">
          <Card title="Sicherheitsschalter" description="Nur per Code-Änderung umschaltbar">
            <ul className="space-y-2.5">
              {(Object.keys(SAFETY_SWITCHES) as (keyof typeof SAFETY_SWITCHES)[]).map((key) => (
                <li key={key} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">{SAFETY_SWITCH_LABELS[key]}</span>
                  <Badge tone={SAFETY_SWITCHES[key] ? "amber" : "neutral"}>
                    {!SAFETY_SWITCHES[key] && <Lock className="size-3" aria-hidden />}
                    {SAFETY_SWITCHES[key] ? "Aktiv" : "Aus"}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">
              Datei: <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">src/lib/config/budget.ts</code>
            </p>
          </Card>

          <Card title="Grenzwerte" description="Gelten, sobald Automationen aktiviert werden">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Einkauf je Bestellung</dt>
                <dd className="tabular-nums">max. {formatEur(LIMITS.maxAutoPurchasePerOrder)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Werbebudget pro Tag</dt>
                <dd className="tabular-nums">max. {formatEur(LIMITS.maxAdSpendPerDay)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Preisänderung ohne Freigabe</dt>
                <dd className="tabular-nums">bis {formatPercent(LIMITS.maxPriceChangeWithoutApproval)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Startbudget" description="Aufteilung ist ein Vorschlag, noch nicht freigegeben">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold tabular-nums">{formatEur0(BUDGET.total)}</span>
            <span className="text-xs text-muted">ausgegeben: {formatEur(BUDGET.spent)}</span>
          </div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
            {BUDGET.plannedAllocation.map((p, i) => (
              <div
                key={p.key}
                className={["bg-cyan-400", "bg-blue-500", "bg-sky-300", "bg-slate-500"][i % 4]}
                style={{ width: `${(p.amount / BUDGET.total) * 100}%` }}
              />
            ))}
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {BUDGET.plannedAllocation.map((p, i) => (
              <li key={p.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-muted">
                  <span className={`size-2.5 rounded-sm ${["bg-cyan-400", "bg-blue-500", "bg-sky-300", "bg-slate-500"][i % 4]}`} />
                  {p.label}
                </span>
                <span className="tabular-nums">{formatEur0(p.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Freigaberegeln" description="Gelten für alle Agenten" className="xl:col-span-2">
          <ul className="grid gap-3 md:grid-cols-2">
            {APPROVAL_RULES.map((r) => (
              <li key={r.title} className="flex gap-3 rounded-lg border border-line bg-surface-2/40 p-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-cyan-300" aria-hidden />
                <div>
                  <p className="text-sm font-medium">{r.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{r.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
