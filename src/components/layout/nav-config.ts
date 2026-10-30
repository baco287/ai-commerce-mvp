import { Bot, Database, LayoutDashboard, PackageSearch, RefreshCw, ShieldCheck, Truck, Workflow, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/produkte", label: "Produktanalyse", icon: PackageSearch },
  { href: "/lieferanten", label: "Lieferanten", icon: Truck },
  { href: "/agenten", label: "KI-Agenten", icon: Bot },
  { href: "/freigaben", label: "Freigaben & Budget", icon: ShieldCheck },
  { href: "/shopify", label: "Shopify-Sync", icon: RefreshCw },
];

/** Bereiche, die in späteren Phasen angebunden werden. */
export const PLANNED_ITEMS: NavItem[] = [
  { href: "#", label: "n8n-Automationen", icon: Workflow },
  { href: "#", label: "PostgreSQL-Daten", icon: Database },
];
