"use client";

import { CircleCheck, Clock, Lock, Pause, Play } from "lucide-react";
import { useState } from "react";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { formatTime } from "@/lib/format";
import type { Agent, AgentStatus } from "@/lib/types";
import { AgentIcon } from "./agent-icon";

/**
 * Agentenkarten mit Pausieren/Fortsetzen. Der Schalter wirkt nur in dieser Ansicht
 * (Demo, keine Speicherung) – echte Steuerung kommt mit Datenbank und n8n.
 */
export function AgentBoard({ agents }: { agents: Agent[] }) {
  const [status, setStatus] = useState<Record<string, AgentStatus>>(() =>
    Object.fromEntries(agents.map((a) => [a.id, a.status])),
  );

  const toggle = (id: string) => setStatus((s) => ({ ...s, [id]: s[id] === "active" ? "paused" : "active" }));

  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {agents.map((agent) => {
        const current = status[agent.id];
        const active = current === "active";
        const changed = current !== agent.status;
        return (
          <article key={agent.id} className="flex flex-col rounded-xl border border-line bg-surface/80">
            <header className="flex items-start gap-3 border-b border-line p-5">
              <span
                className={`grid size-10 shrink-0 place-items-center rounded-lg ring-1 ${
                  active ? "bg-cyan-400/10 text-cyan-300 ring-cyan-400/25" : "bg-surface-2 text-subtle ring-line-strong"
                }`}
              >
                <AgentIcon id={agent.id} className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-fg">{agent.name}</h2>
                <p className="text-xs text-muted">{agent.role}</p>
              </div>
              <Badge tone={active ? "green" : "neutral"}>
                <span className={`size-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-slate-500"}`} />
                {active ? "Aktiv" : "Pausiert"}
              </Badge>
            </header>

            <div className="flex-1 space-y-4 p-5 text-sm">
              <p className="text-muted">{agent.description}</p>

              {!active && (agent.pauseReason || changed) && (
                <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted">
                  {changed ? "In dieser Ansicht manuell pausiert (Demo, wird nicht gespeichert)." : agent.pauseReason}
                </p>
              )}

              <dl className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <dt className="text-subtle">Letzter Lauf</dt>
                  <dd className="mt-0.5 tabular-nums text-fg">{formatTime(agent.lastRun)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Nächster Lauf</dt>
                  <dd className="mt-0.5 tabular-nums text-fg">{active && agent.nextRun ? formatTime(agent.nextRun) : "–"}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Läufe heute</dt>
                  <dd className="mt-0.5 tabular-nums text-fg">{agent.runsToday}</dd>
                </div>
              </dl>

              <div>
                <p className="mb-1.5 text-xs font-medium text-subtle">Darf selbstständig</p>
                <ul className="space-y-1">
                  {agent.allowedActions.map((a) => (
                    <li key={a} className="flex items-start gap-2 text-xs text-fg">
                      <CircleCheck className="mt-px size-3.5 shrink-0 text-emerald-400" aria-hidden />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-subtle">Braucht Freigabe</p>
                <ul className="space-y-1">
                  {agent.approvalRequired.map((a) => (
                    <li key={a} className="flex items-start gap-2 text-xs text-fg">
                      <Lock className="mt-px size-3.5 shrink-0 text-amber-300" aria-hidden />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              <span className="flex items-center gap-2 text-xs text-subtle">
                <Clock className="size-3.5" aria-hidden />
                Datenquelle <DemoBadge label="Demodaten" />
              </span>
              <button
                type="button"
                onClick={() => toggle(agent.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-cyan-400/40 hover:text-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
              >
                {active ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                {active ? "Pausieren" : "Fortsetzen"}
              </button>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
