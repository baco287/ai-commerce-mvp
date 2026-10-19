import { Lock } from "lucide-react";
import { BUDGET } from "@/lib/config/budget";
import { formatEur0 } from "@/lib/format";
import { Brand } from "./brand";
import { PLANNED_ITEMS } from "./nav-config";
import { NavLinks } from "./nav-links";

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface/60 backdrop-blur lg:flex">
      <div className="px-5 py-5">
        <Brand />
      </div>

      <nav aria-label="Hauptnavigation" className="flex-1 overflow-y-auto px-3">
        <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-subtle">Steuerung</p>
        <NavLinks orientation="vertical" />

        <p className="mt-6 px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-subtle">Geplant</p>
        <ul className="space-y-0.5">
          {PLANNED_ITEMS.map(({ label, icon: Icon }) => (
            <li key={label} className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-subtle" title="Wird in einer späteren Phase angebunden">
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
              <span className="ml-auto text-[10px] uppercase tracking-wide">später</span>
            </li>
          ))}
        </ul>
      </nav>

      <div className="m-3 rounded-lg border border-line bg-surface-2/60 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-fg">
          <Lock className="size-3.5 text-accent" aria-hidden />
          Echtgeld-Aktionen gesperrt
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Budget {formatEur0(BUDGET.spent)} von {formatEur0(BUDGET.total)} ausgegeben. Einkauf, Anzeigen und bezahlte APIs sind deaktiviert.
        </p>
      </div>
    </aside>
  );
}
