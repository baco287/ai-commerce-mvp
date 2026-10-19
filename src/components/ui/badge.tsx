import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "cyan" | "blue" | "green" | "amber" | "red";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line-strong bg-surface-2 text-muted",
  cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
  blue: "border-blue-400/30 bg-blue-500/10 text-blue-300",
  green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  red: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Einheitliche Kennzeichnung simulierter Inhalte. */
export function DemoBadge({ label = "Demo" }: { label?: string }) {
  return (
    <Badge tone="amber" className="uppercase tracking-wide">
      {label}
    </Badge>
  );
}
