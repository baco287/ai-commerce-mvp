/** Horizontale Bewertung 0–100 mit Zahl. */
export function ScoreBar({ value, label }: { value: number; label?: string }) {
  const color = value >= 70 ? "bg-cyan-400" : value >= 50 ? "bg-blue-400" : "bg-slate-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line" aria-hidden>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="text-sm tabular-nums text-fg">{value}</span>
      {label && <span className="text-xs text-muted">{label}</span>}
    </div>
  );
}
