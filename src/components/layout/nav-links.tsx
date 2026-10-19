"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-config";

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/** Hauptnavigation – vertikal in der Seitenleiste, horizontal auf kleineren Bildschirmen. */
export function NavLinks({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";

  return (
    <ul className={vertical ? "space-y-0.5" : "flex gap-1"}>
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`group flex items-center gap-2.5 whitespace-nowrap rounded-lg text-sm transition-colors ${
                vertical ? "px-3 py-2" : "px-3 py-1.5"
              } ${
                active
                  ? "bg-linear-to-r from-cyan-400/15 to-blue-500/5 text-fg ring-1 ring-cyan-400/25"
                  : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              <Icon className={`size-4 shrink-0 ${active ? "text-accent" : "text-subtle group-hover:text-muted"}`} aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
