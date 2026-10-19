import type { DailyPoint } from "@/lib/data";
import { formatDayMonth, formatEur, formatEur0 } from "@/lib/format";

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 44 };

/** Balkendiagramm Umsatz (brutto) und Deckungsbeitrag je Tag – reines SVG, kein Chart-Paket nötig. */
export function RevenueChart({ data }: { data: DailyPoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / data.length;
  const barW = Math.min(26, slot * 0.6);
  const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / top) * innerH;

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Umsatz und Deckungsbeitrag pro Tag (Demo)">
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.35" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#1b2742" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-subtle text-[10px] tabular-nums">
              {formatEur0(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          return (
            <g key={d.day}>
              <title>{`${formatDayMonth(d.day)}: Umsatz ${formatEur(d.revenue)}, Deckungsbeitrag ${formatEur(d.profit)}, ${d.orders} Bestellungen (Demo)`}</title>
              <rect x={cx - barW / 2} y={y(d.revenue)} width={barW} height={y(0) - y(d.revenue)} rx={3} fill="url(#rev)" />
              <rect x={cx - barW / 4} y={y(d.profit)} width={barW / 2} height={y(0) - y(d.profit)} rx={2} fill="#22d3ee" />
              {i % 2 === data.length % 2 && (
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-subtle text-[10px] tabular-nums">
                  {formatDayMonth(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-blue-500/80" /> Umsatz brutto
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-cyan-400" /> Deckungsbeitrag (erwarteter Gewinn)
        </span>
      </figcaption>
    </figure>
  );
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
