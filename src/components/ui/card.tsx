import type { ReactNode } from "react";

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Ohne Innenabstand, z. B. für randlose Tabellen */
  flush?: boolean;
  children: ReactNode;
}

export function Card({ title, description, action, className = "", flush = false, children }: CardProps) {
  return (
    <section className={`rounded-xl border border-line bg-surface/80 shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset] ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
    </section>
  );
}
