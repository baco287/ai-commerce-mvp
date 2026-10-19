import { FlaskConical } from "lucide-react";
import { Brand } from "./brand";
import { NavLinks } from "./nav-links";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-base/80 backdrop-blur">
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="lg:hidden">
          <Brand />
        </div>
        <p className="hidden text-sm text-muted lg:block">Interne Steuerung für Produktrecherche, Einkauf und KI-Agenten</p>
        <div
          role="status"
          className="flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200"
        >
          <FlaskConical className="size-3.5" aria-hidden />
          <span>
            Demo-Modus<span className="hidden sm:inline"> · alle Zahlen simuliert</span>
          </span>
        </div>
      </div>
      <nav aria-label="Hauptnavigation" className="overflow-x-auto px-4 pb-3 sm:px-6 lg:hidden">
        <NavLinks orientation="horizontal" />
      </nav>
    </header>
  );
}
