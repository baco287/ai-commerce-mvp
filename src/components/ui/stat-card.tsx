import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string;
  hint?: ReactNode;
  icon: LucideIcon;
  tone?: "cyan" | "blue" | "green" | "slate";
}

const ICON_TONES = {
  cyan: "text-cyan-300 bg-cyan-400/10 ring-cyan-400/20",
  blue: "text-blue-300 bg-blue-500/10 ring-blue-400/20",
  green: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20",
  slate: "text-muted bg-surface-2 ring-line-strong",
} as const;

export function StatCard({ label, value, hint, icon: Icon, tone = "cyan" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-line bg-surface/80 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className={`grid size-8 place-items-center rounded-lg ring-1 ${ICON_TONES[tone]}`}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
