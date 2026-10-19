import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

// Einheitliche, gut lesbare Tabellen. Breite Tabellen scrollen horizontal statt die Seite zu sprengen.

export function Table({ children, minWidth = 720 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ className = "", align = "left", ...props }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={`border-b border-line bg-surface-2/50 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-subtle ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
      {...props}
    />
  );
}

export function Td({ className = "", align = "left", ...props }: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) {
  return (
    <td
      className={`border-b border-line/70 px-4 py-3 align-middle text-fg ${align === "right" ? "text-right tabular-nums" : ""} ${className}`}
      {...props}
    />
  );
}
