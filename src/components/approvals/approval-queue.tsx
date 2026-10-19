"use client";

import { Check, Lock, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatEur } from "@/lib/format";
import { APPROVAL_KIND_LABEL } from "@/lib/labels";
import type { ApprovalRequest } from "@/lib/types";

type Decision = "approved" | "rejected";

/**
 * Freigabe-Warteschlange. Entscheidungen werden im MVP nur in dieser Ansicht gemerkt
 * und lösen keine Aktion aus. Gesperrte Anfragen (Echtgeld) lassen sich nicht freigeben.
 */
export function ApprovalQueue({ approvals, agentNames }: { approvals: ApprovalRequest[]; agentNames: Record<string, string> }) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const decide = (id: string, d: Decision | undefined) =>
    setDecisions((prev) => {
      const next = { ...prev };
      if (d) next[id] = d;
      else delete next[id];
      return next;
    });

  return (
    <ul className="divide-y divide-line">
      {approvals.map((a) => {
        const decision = decisions[a.id];
        return (
          <li key={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="blue">{APPROVAL_KIND_LABEL[a.kind]}</Badge>
                {a.amount !== undefined && <Badge tone="neutral">{formatEur(a.amount)}</Badge>}
                {decision === "approved" && <Badge tone="green">Freigegeben (Demo)</Badge>}
                {decision === "rejected" && <Badge tone="red">Abgelehnt (Demo)</Badge>}
              </div>
              <p className="mt-2 text-sm font-medium text-fg">{a.title}</p>
              <p className="mt-0.5 text-xs text-muted">{a.detail}</p>
              <p className="mt-1 text-[11px] text-subtle">Angefragt von {agentNames[a.requestedBy] ?? a.requestedBy}</p>
              {a.lockedReason && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-200">
                  <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
                  {a.lockedReason}
                </p>
              )}
            </div>

            <div className="flex shrink-0 gap-2">
              {a.lockedReason ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-subtle">
                  <Lock className="size-3.5" aria-hidden /> Gesperrt
                </span>
              ) : decision ? (
                <button type="button" onClick={() => decide(a.id, undefined)} className={btn("neutral")}>
                  <RotateCcw className="size-3.5" aria-hidden /> Zurücksetzen
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => decide(a.id, "rejected")} className={btn("neutral")}>
                    <X className="size-3.5" aria-hidden /> Ablehnen
                  </button>
                  <button type="button" onClick={() => decide(a.id, "approved")} className={btn("primary")}>
                    <Check className="size-3.5" aria-hidden /> Freigeben
                  </button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function btn(kind: "primary" | "neutral") {
  const base =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400";
  return kind === "primary"
    ? `${base} bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-400/30 hover:bg-cyan-400/25`
    : `${base} border border-line-strong bg-surface-2 text-fg hover:border-line-strong hover:bg-surface`;
}
