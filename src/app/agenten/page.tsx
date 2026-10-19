import { Info } from "lucide-react";
import type { Metadata } from "next";
import { AgentBoard } from "@/components/agents/agent-board";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { getAgents } from "@/lib/data";

export const metadata: Metadata = { title: "KI-Agenten" };

export default function AgentsPage() {
  const agents = getAgents();
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

      <AgentBoard agents={agents} />
    </>
  );
}
