import { Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AgentBoard } from "@/components/agents/agent-board";
import { MarketRunStatus } from "@/components/market/market-scout-panel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getAgents, getMarketScoutOverview } from "@/lib/data";

export const metadata: Metadata = { title: "KI-Agenten" };

export default async function AgentsPage() {
  const agents = getAgents();
  const market = await getMarketScoutOverview();
  const counts = market.candidates.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.latest.state]: (acc[c.latest.state] ?? 0) + 1 }), {});
  const active = agents.filter((a) => a.status === "active").length;

  return (
    <>
      <PageHeader
        title="KI-Agenten"
        description="Sechs spezialisierte Agenten mit klaren Befugnissen. Alles, was Geld kostet oder nach außen wirkt, braucht eine Freigabe."
        actions={
          <>
            <Badge tone="green">{active} aktiv</Badge>
            <Badge tone="neutral">{agents.length - active} pausiert</Badge>
          </>
        }
      />

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-blue-400/20 bg-blue-500/5 px-4 py-3 text-sm text-blue-100">
        <Info className="mt-0.5 size-4 shrink-0 text-blue-300" aria-hidden />
        <p>
          Die Agenten arbeiten ausschließlich mit gekennzeichneten Demodaten und rufen keine KI-API (OpenAI, Claude) auf. Pausieren und Fortsetzen
          wirkt nur in dieser Ansicht und wird nicht gespeichert.
        </p>
      </div>

      <Card
        title="Market Scout – letzter Lauf"
        description="Market Scan → Bewertung → Supplier Scout → Profit Check → Compliance → Shopify-Entwurf (Dry-Run). Läufe per Befehl npm run market:scan."
        className="mb-4"
      >
        <MarketRunStatus overview={market} />
        <p className="mt-3 text-xs text-muted">
          {market.candidates.length} Kandidaten: {counts.blocked ?? 0} gesperrt, {counts.deferred ?? 0} zurückgestellt, {counts.unreviewed ?? 0} ungeprüft,{" "}
          {counts.approved ?? 0} freigegeben, {counts.draft_created ?? 0} Entwurf erstellt.{" "}
          <Link href="/produkte" className="text-accent hover:underline">
            Details in der Produktanalyse
          </Link>
        </p>
      </Card>

      <AgentBoard agents={agents} />
    </>
  );
}
