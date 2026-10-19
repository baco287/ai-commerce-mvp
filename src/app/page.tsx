import { ArrowRight, Info, Lock, OctagonAlert, Receipt, ShoppingCart, TrendingUp, TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/agent-icon";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Table, Td, Th } from "@/components/ui/table";
import { BUDGET, SAFETY_SWITCHES, SAFETY_SWITCH_LABELS } from "@/lib/config/budget";
import { agentName, getActivities, getAgents, getAlerts, getApprovals, getDashboardMetrics } from "@/lib/data";
import { DEMO_DAYS, DEMO_TODAY } from "@/lib/demo/orders";
import { formatDateTime, formatDayMonth, formatEur, formatEur0 } from "@/lib/format";
import { APPROVAL_KIND_LABEL, PAYMENT_STATUS_LABEL, SEVERITY_TONE } from "@/lib/labels";
import type { Severity } from "@/lib/types";

const SEVERITY_ICON: Record<Severity, typeof Info> = { info: Info, warning: TriangleAlert, critical: OctagonAlert };

export default function DashboardPage() {
  const m = getDashboardMetrics();
  const agents = getAgents();
  const activeAgents = agents.filter((a) => a.status === "active");
  const pausedAgents = agents.filter((a) => a.status === "paused");
  const alerts = getAlerts();
  const approvals = getApprovals();
  const firstDay = m.daily[0]?.day ?? DEMO_TODAY;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Überblick über den simulierten Betrieb im Zeitraum ${formatDayMonth(firstDay)}–${formatDayMonth(DEMO_TODAY)} (${DEMO_DAYS} Tage). Alle Umsätze und Bestellungen sind Demodaten.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Umsatz brutto (Demo)" value={formatEur(m.revenue)} hint={`${m.units} Artikel verkauft · simuliert`} icon={Wallet} tone="blue" />
        <StatCard label="Bestellungen (Demo)" value={String(m.orders)} hint={`${m.awaitingPayment} warten auf Zahlung`} icon={ShoppingCart} tone="cyan" />
        <StatCard
          label="Erwarteter Gewinn (Demo)"
          value={formatEur(m.profit)}
          hint="Deckungsbeitrag nach allen variablen Kosten"
          icon={TrendingUp}
          tone="green"
        />
        <StatCard label="Erwartete Kosten (Demo)" value={formatEur(m.costs)} hint={`Ware, Versand, Gebühren, Werbung · zzgl. ${formatEur(m.vat)} MwSt.`} icon={Receipt} tone="slate" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Umsatz & Gewinn pro Tag" description="Simulierte Bestellungen, erwarteter Deckungsbeitrag" action={<DemoBadge />} className="xl:col-span-2">
          <RevenueChart data={m.daily} />
        </Card>

        <Card title="Budget & Sicherheit" description="Startbudget und Sicherheitsschalter">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold tabular-nums">{formatEur0(BUDGET.total - BUDGET.spent)}</span>
            <span className="text-xs text-muted">von {formatEur0(BUDGET.total)} verfügbar</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
            <div className="h-full rounded-full bg-cyan-400" style={{ width: `${(BUDGET.spent / BUDGET.total) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted">Echtes Geld ausgegeben: {formatEur(BUDGET.spent)}</p>

          <ul className="mt-5 space-y-2.5">
            {(Object.keys(SAFETY_SWITCHES) as (keyof typeof SAFETY_SWITCHES)[]).map((key) => (
              <li key={key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">{SAFETY_SWITCH_LABELS[key]}</span>
                {SAFETY_SWITCHES[key] ? (
                  <Badge tone="amber">Aktiv</Badge>
                ) : (
                  <Badge tone="neutral">
                    <Lock className="size-3" aria-hidden /> Aus
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          <Link href="/freigaben" className="mt-5 inline-flex items-center gap-1 text-xs font-medium text-cyan-300 hover:text-cyan-200">
            Freigaberegeln ansehen <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card
          title="KI-Agenten"
          description={`${activeAgents.length} aktiv · ${pausedAgents.length} pausiert`}
          action={
            <Link href="/agenten" className="text-xs font-medium text-cyan-300 hover:text-cyan-200">
              Alle
            </Link>
          }
          flush
        >
          <ul className="divide-y divide-line">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <span className={`grid size-8 shrink-0 place-items-center rounded-lg ring-1 ${a.status === "active" ? "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20" : "bg-surface-2 text-subtle ring-line"}`}>
                  <AgentIcon id={a.id} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">{a.name}</p>
                  <p className="truncate text-xs text-subtle">{a.status === "active" ? a.role : a.pauseReason}</p>
                </div>
                <Badge tone={a.status === "active" ? "green" : "neutral"}>{a.status === "active" ? "Aktiv" : "Pausiert"}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Letzte Systemaktivitäten" description="Protokoll der Agenten (simuliert)" className="xl:col-span-2" flush>
          <ol className="divide-y divide-line">
            {getActivities().map((e) => (
              <li key={e.id} className="flex gap-4 px-5 py-3">
                <time dateTime={e.at} className="w-28 shrink-0 pt-0.5 text-xs tabular-nums text-subtle">
                  {formatDateTime(e.at)}
                </time>
                <div className="min-w-0">
                  <p className="text-sm text-fg">{e.message}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-subtle">
                    {agentName(e.agentId)}
                    {e.kind === "blocked" && <Badge tone="amber">Blockiert</Badge>}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Warnmeldungen" description={`${alerts.filter((a) => a.severity !== "info").length} offen`} flush>
          <ul className="divide-y divide-line">
            {alerts.map((a) => {
              const Icon = SEVERITY_ICON[a.severity];
              const tone = SEVERITY_TONE[a.severity];
              return (
                <li key={a.id} className="flex gap-3 px-5 py-3">
                  <Icon
                    className={`mt-0.5 size-4 shrink-0 ${tone === "red" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : "text-blue-300"}`}
                    aria-hidden
                  />
                  <div>
                    <p className="text-sm font-medium text-fg">{a.title}</p>
                    <p className="mt-0.5 text-xs text-muted">{a.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card
          title="Offene Freigaben"
          description={`${approvals.length} Anfragen · ${approvals.filter((a) => a.lockedReason).length} im MVP gesperrt`}
          action={
            <Link href="/freigaben" className="text-xs font-medium text-cyan-300 hover:text-cyan-200">
              Bearbeiten
            </Link>
          }
          flush
        >
          <ul className="divide-y divide-line">
            {approvals.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg">{a.title}</p>
                  <p className="mt-0.5 text-xs text-subtle">
                    {APPROVAL_KIND_LABEL[a.kind]} · {agentName(a.requestedBy)}
                  </p>
                </div>
                {a.lockedReason ? (
                  <Badge tone="neutral">
                    <Lock className="size-3" aria-hidden /> Gesperrt
                  </Badge>
                ) : (
                  <Badge tone="cyan">Wartet</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card
        title="Letzte Bestellungen"
        description="Simulierte Kundenbestellungen mit automatischer Einkaufsprüfung"
        action={<DemoBadge />}
        className="mt-4"
        flush
      >
        <Table minWidth={860}>
          <thead>
            <tr>
              <Th>Bestellung</Th>
              <Th>Produkt</Th>
              <Th align="right">Betrag</Th>
              <Th>Zahlung</Th>
              <Th>Lieferant</Th>
              <Th>Einkauf</Th>
            </tr>
          </thead>
          <tbody>
            {m.recentOrders.map(({ order, product, supplierName, purchase }) => (
              <tr key={order.id}>
                <Td>
                  <div className="font-mono text-xs text-fg">{order.id}</div>
                  <div className="text-xs text-subtle">{formatDateTime(order.createdAt)}</div>
                </Td>
                <Td>
                  {product.name}
                  {order.quantity > 1 && <span className="text-muted"> × {order.quantity}</span>}
                </Td>
                <Td align="right">{formatEur(order.priceGross * order.quantity)}</Td>
                <Td>
                  <Badge tone={PAYMENT_STATUS_LABEL[order.paymentStatus].tone}>{PAYMENT_STATUS_LABEL[order.paymentStatus].label}</Badge>
                </Td>
                <Td className="text-muted">{supplierName ?? "–"}</Td>
                <Td>
                  {purchase.allowed ? (
                    <Badge tone="green">Zulässig</Badge>
                  ) : (
                    <span title={purchase.reasons.join("\n")}>
                      <Badge tone="amber">
                        <Lock className="size-3" aria-hidden /> Blockiert ({purchase.reasons.length})
                      </Badge>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="px-5 py-3 text-xs text-muted">
          Der Order Fulfillment Agent kauft nie automatisch ein. Gründe pro Bestellung erscheinen beim Überfahren des Status.
        </p>
      </Card>
    </>
  );
}
