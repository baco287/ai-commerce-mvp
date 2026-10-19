import { Sparkles } from "lucide-react";

/** Platzhalter-Marke, bis der endgültige Name feststeht. */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-cyan-400 to-blue-600 text-base shadow-lg shadow-cyan-500/20">
        <Sparkles className="size-4 text-white" aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-fg">AI Commerce</p>
        <p className="text-[11px] text-subtle">Kontrollzentrale</p>
      </div>
    </div>
  );
}
