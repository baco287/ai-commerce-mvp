import { CircleAlert, CircleX, KeyRound, MapPin, Store, Truck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, DemoBadge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, Td, Th } from "@/components/ui/table";
import { LOW_STOCK_THRESHOLD, STOCK_STATE_LABELS, type InventoryRow, type StockState } from "@/lib/shopify/inventory";
import type { InventoryStatus } from "@/lib/shopify/server/sync-status";

const STATE_TONE: Record<StockState, BadgeTone> = {
  ok: "green",
  low: "amber",
  out: "red",
  oversold: "red",
  untracked: "neutral",
};

const STATE_ORDER: StockState[] = ["ok", "low", "out", "oversold", "untracked"];

/**
 * Shopify-Bestand aus read_inventory – ausdrücklich getrennt vom (späteren) Lieferantenbestand.
 * Server-Komponente: bekommt nur bereinigte Daten, nie Zugangsdaten.
 */
export function InventoryPanel({ inventory }: { inventory: InventoryStatus }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
      <Card
        title={
          <span className="flex items-center gap-1.5">
            <Store className="size-4 text-accent" aria-hidden /> Shopify-Bestand
          </span>
        }
        description="Mengen, die Shopify an den Standorten dieses Stores führt. Das ist nicht der Lagerbestand der Lieferanten."
        action={<Badge tone="cyan">Quelle: Shopify · read_inventory</Badge>}
        flush
      >
        {inventory.state === "missing-scope" && <MissingScope />}
        {inventory.state === "error" && (
          <Hint icon={CircleX} tone="red" title="Bestand konnte nicht gelesen werden">
            <span className="block">{inventory.message}</span>
            <span className="mt-1 block text-muted">
              {inventory.kind === "scope"
                ? "Prüfen, ob die aktuelle App-Version read_inventory enthält und auf dem Store genehmigt ist."
                : "Produktabgleich oben ist davon nicht betroffen. Seite später neu laden."}
            </span>
          </Hint>
        )}
        {inventory.state === "ok" && <InventoryDetails overview={inventory.overview} />}
      </Card>

      <SupplierStockCard />
    </div>
  );
}

function MissingScope() {
  return (
    <Hint icon={KeyRound} tone="amber" title="Berechtigung read_inventory fehlt – Bestand wird nicht gelesen">
      <ol className="mt-1 list-inside list-decimal space-y-0.5 text-muted">
        <li>Dev Dashboard → App → Versionen → neue Version mit den Scopes read_products,read_inventory.</li>
        <li>Version veröffentlichen und die Aktualisierung im Store-Admin genehmigen.</li>
        <li>Entwicklungsserver neu starten und diese Seite neu laden.</li>
      </ol>
      <span className="mt-1 block text-xs text-subtle">Anleitung: docs/SHOPIFY-API-EINRICHTUNG.md, Abschnitt 5. Schreibrechte bleiben gesperrt.</span>
    </Hint>
  );
}

function InventoryDetails({ overview }: { overview: Extract<InventoryStatus, { state: "ok" }>["overview"] }) {
  if (overview.rows.length === 0) {
    return <p className="px-5 py-4 text-sm text-muted">Shopify meldet keine Varianten mit Bestandsdaten.</p>;
  }
  const demoOnly = overview.rows.every((r) => r.demo);

  return (
    <>
      <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
        {STATE_ORDER.filter((s) => overview.counts[s] > 0).map((s) => (
          <Badge key={s} tone={STATE_TONE[s]}>
            {overview.counts[s]} × {STOCK_STATE_LABELS[s]}
          </Badge>
        ))}
        <span className="text-xs text-subtle">„Niedrig“ = {LOW_STOCK_THRESHOLD} Stück oder weniger verfügbar.</span>
      </div>

      {overview.locations.length > 0 && (
        <ul className="grid gap-2 border-b border-line px-5 py-3 sm:grid-cols-2">
          {overview.locations.map((l) => (
            <li key={l.id} className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-fg">
                <MapPin className="size-3.5 text-accent" aria-hidden /> {l.name}
                {!l.active && <Badge tone="neutral">inaktiv</Badge>}
              </p>
              <p className="mt-1 text-muted">
                verfügbar <Num v={l.available} /> · vorhanden <Num v={l.onHand} /> · reserviert <Num v={l.committed} /> · im Zulauf{" "}
                <Num v={l.incoming} />
              </p>
            </li>
          ))}
        </ul>
      )}

      <Table minWidth={760}>
        <thead>
          <tr>
            <Th>Produkt / Variante</Th>
            <Th>SKU</Th>
            <Th>Bestandsführung</Th>
            <Th align="right">Verfügbar</Th>
            <Th>Je Standort</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {overview.rows.map((r) => (
            <tr key={r.variantId} className="align-top">
              <Td className="align-top">
                <div className="font-medium">{r.productTitle}</div>
                <div className="text-xs text-subtle">
                  {r.variantTitle === "Default Title" ? "Standardvariante" : r.variantTitle} · {r.productStatus === "ACTIVE" ? "aktiv" : r.productStatus === "DRAFT" ? "Entwurf" : r.productStatus.toLowerCase()}
                </div>
              </Td>
              <Td className="align-top font-mono text-xs">{r.sku || "–"}</Td>
              <Td className="align-top text-xs">
                {r.tracked ? "verfolgt" : <span className="text-amber-200">nicht verfolgt</span>}
                {r.continueSelling && <div className="text-amber-200">Weiterverkauf bei 0 erlaubt</div>}
              </Td>
              <Td align="right" className="align-top">
                {r.available === null ? "–" : r.available}
              </Td>
              <Td className="align-top text-xs text-muted">
                {r.locations.length === 0 ? "–" : r.locations.map((l) => `${l.locationName}: ${l.available}`).join(" · ")}
              </Td>
              <Td className="align-top">
                <StateBadge row={r} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="space-y-1 px-5 py-3 text-xs text-muted">
        {demoOnly && <p>Alle gelesenen Varianten sind Demo-Produkte: Bestand 0 und „nicht überverkaufen“ sind beabsichtigt (Kaufsperre).</p>}
        {overview.truncated && (
          <p className="text-amber-200">Mindestens ein Artikel liegt an mehr als 10 Standorten – nur die ersten 10 sind berücksichtigt.</p>
        )}
        {overview.missingVariants > 0 && (
          <p className="text-amber-200">
            Zu {overview.missingVariants} Variante{overview.missingVariants > 1 ? "n" : ""} hat Shopify keine Bestandsdaten geliefert – sie fehlen
            in dieser Liste und erscheinen im Abgleich als „nicht gelesen“.
          </p>
        )}
      </div>
    </>
  );
}

function StateBadge({ row }: { row: InventoryRow }) {
  if (row.demo && row.state === "out") {
    return (
      <span className="flex flex-col items-start gap-1">
        <Badge tone="neutral">{STOCK_STATE_LABELS.out}</Badge>
        <DemoBadge label="Demo · gesperrt" />
      </span>
    );
  }
  return <Badge tone={STATE_TONE[row.state]}>{STOCK_STATE_LABELS[row.state]}</Badge>;
}

function SupplierStockCard() {
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5">
          <Truck className="size-4 text-subtle" aria-hidden /> Lieferantenbestand
        </span>
      }
      description="Lager der Dropshipping-Partner – eigene Quelle, wird nicht mit dem Shopify-Bestand vermischt."
      action={<Badge tone="neutral">nicht angebunden</Badge>}
    >
      <ul className="space-y-2 text-xs text-muted">
        <li>
          Noch keine echte Lieferanten-Schnittstelle. Die Werte unter{" "}
          <Link href="/lieferanten" className="text-accent underline-offset-2 hover:underline">
            Lieferanten
          </Link>{" "}
          sind Demo-Daten.
        </li>
        <li>Später liefern Lieferanten-Adapter Bestand, Lieferzeit und Preis inkl. Versand (in Entwicklung).</li>
        <li>Kostenpflichtige Lieferanten-APIs bleiben gesperrt, bis sie ausdrücklich freigegeben werden.</li>
      </ul>
    </Card>
  );
}

function Hint({ icon: Icon, tone, title, children }: { icon: typeof CircleAlert; tone: "amber" | "red"; title: string; children: ReactNode }) {
  const cls = tone === "red" ? "border-rose-400/25 bg-rose-500/5 text-rose-100" : "border-amber-400/25 bg-amber-400/5 text-amber-100";
  return (
    <div className={`m-5 flex gap-3 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 text-sm">{children}</div>
      </div>
    </div>
  );
}

function Num({ v }: { v: number }) {
  return <span className={`font-medium tabular-nums ${v < 0 ? "text-rose-300" : "text-fg"}`}>{v}</span>;
}
