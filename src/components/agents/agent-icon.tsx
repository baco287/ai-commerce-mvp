import { Bot, Calculator, Megaphone, PackageCheck, Search, Store, Truck, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  "market-research": Search,
  "supplier-scout": Truck,
  "profit-calculator": Calculator,
  "store-manager": Store,
  "ads-manager": Megaphone,
  "order-fulfillment": PackageCheck,
};

export function AgentIcon({ id, className = "size-4" }: { id: string; className?: string }) {
  const Icon = ICONS[id] ?? Bot;
  return <Icon className={className} aria-hidden />;
}
