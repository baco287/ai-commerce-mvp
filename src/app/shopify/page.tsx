import { CircleAlert, CircleCheck, CircleMinus, CircleX, KeyRound, Lock, PlugZap, RefreshCw, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { InventoryPanel } from "@/components/shopify/inventory-panel";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { getProductAnalyses } from "@/lib/data";
import { formatDateTime } from "@/lib/format";
import { SHOPIFY_ADMIN_API_VERSION } from "@/lib/shopify/graphql";
import { DEMO_LISTINGS } from "@/lib/shopify/listings";
import { evaluatePipeline, type StepState } from "@/lib/shopify/pipeline";
import { getShopifySyncStatus, SETUP_ENV_NAMES } from "@/lib/shopify/server/sync-status";

export const metadata: Metadata = { title: "Shopify-Synchronisierung" };

export default function ShopifySyncPage() {
  return (
    <>
      <PageHeader
        title="Shopify-Synchronisierung"
        description="Vergleicht die Produkte im Shopify Dev Store mit den Daten der Kontrollzentrale. Nur lesend – es wird nichts in Shopify verändert."
        actions={
          <Badge tone="cyan">
            <ShieldCheck className="size-3" aria-hidden /> Read-only · API {SHOPIFY_ADMIN_API_VERSION}
          </Badge>
        }
      />

      <Suspense fallback={<LoadingCard />}>
        <LiveSyncStatus />
      </Suspense>

      <PipelinePreview />
    </>
  );
}

function LoadingCard() {
  return (
    <Card>
      <p className="flex items-center gap-2 text-sm text-muted">
        <RefreshCw className="size-4 animate-spin text-accent" aria-hidden /> Verbinde mit Shopify …
      </p>
    </Card>
  );
}

/** Live-Abfrage: läuft nur bei einer echten Anfrage im lokalen Entwicklungsserver, nie beim Build. */
async function LiveSyncStatus() {
  await connection();
  const status = await getShopifySyncStatus();

  if (status.state === "production-locked") {
    return (
      <Notice icon={Lock} tone="amber" title="Im Produktionsbetrieb gesperrt">
        Die Shopify-Abfrage läuft nur im lokalen Entwicklungsserver (<code>npm run dev</code>). Für eine öffentliche
        Bereitstellung muss die Kontrollzentrale zuerst einen Login erhalten.
      </Notice>
    );
  }

  if (status.state === "not-configured" || status.state === "invalid-config") {
    return <SetupHelp missing={status.state === "not-configured" ? status.missing : []} problems={status.state === "invalid-config" ? status.problems : []} />;
  }

  if (status.state === "error") {
    const hint: Record<string, string> = {
      auth: "Zugangsdaten oder App-Installation prüfen (siehe docs/SHOPIFY-API-EINRICHTUNG.md).",
      scope: "Berechtigungen der App-Version im Dev Dashboard prüfen: nur read_products und read_inventory.",
      network: "Internetverbindung und Store-Domain prüfen.",
      readonly: "Eine schreibende Abfrage wurde blockiert – das ist ein Programmierfehler.",
      api: "Antwort der Admin API prüfen; ggf. API-Version aktualisieren.",
      unknown: "Server neu starten und erneut versuchen.",
    };
    return (
      <Notice icon={CircleX} tone="red" title="Verbindung fehlgeschlagen">
        <span className="block">{status.message}</span>
        <span className="mt-1 block text-muted">{hint[status.kind]}</span>
        <span className="mt-2 block text-xs text-muted">
          Letzte erfolgreiche Synchronisierung:{" "}
          {status.lastSync.productsAt ? formatDateTime(status.lastSync.productsAt) : "noch keine"}
        </span>
      </Notice>
    );
  }

  const { shop, result, lastSync, inventory } = status;
  const currencyOk = shop.currencyCode === "EUR";
  const lastInventory = lastSync.inventoryAt ? ` – zuletzt vollständig ${formatDateTime(lastSync.inventoryAt)}` : "";
  const inventoryLabel =
    inventory.state === "missing-scope"
      ? "Berechtigung fehlt"
      : inventory.state === "error"
        ? `Fehler${lastInventory}`
        : inventory.complete
          ? formatDateTime(status.fetchedAt)
          : `unvollständig${lastInventory}`;
  const inventoryOk = inventory.state === "ok" && inventory.complete;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Verbindung" description={`Abgerufen ${formatDateTime(status.fetchedAt)}`}>
          <dl className="space-y-1.5 text-sm">
            <Row label="Store" value={shop.name} />
            <Row label="Domain" value={shop.myshopifyDomain} />
            <Row label="Währung" value={shop.currencyCode} warn={!currencyOk} />
            <Row label="API-Version" value={status.apiVersion} />
            <Row label="Berechtigungen" value={shop.grantedScopes.join(", ") || "–"} />
          </dl>
          <p className="mt-4 text-xs font-medium text-subtle">Letzte erfolgreiche Synchronisierung</p>
          <dl className="mt-1.5 space-y-1.5 text-sm">
            <Row label="Produkte" value={formatDateTime(lastSync.productsAt ?? status.fetchedAt)} />
            <Row label="Bestand" value={inventoryLabel} warn={!inventoryOk} />
          </dl>
          {!currencyOk && (
            <p className="mt-3 text-xs text-amber-200">Store-Währung ist nicht EUR – Preise werden als reine Zahlen verglichen.</p>
          )}
        </Card>

        <Card title="Abgleich" description={`${status.productCount} Produkte in Shopify gelesen`} className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Erwartet" value={result.summary.expected} />
            <Stat label="Übereinstimmend" value={result.summary.match} tone="green" />
            <Stat label="Abweichend" value={result.summary.drift} tone={result.summary.drift ? "amber" : "neutral"} />
            <Stat label="Fehlen" value={result.summary.missing} tone={result.summary.missing ? "red" : "neutral"} />
          </div>
          <p className="mt-4 text-xs text-muted">
            Erkennung über URL-Handle, ersatzweise über SKU. Nicht zugeordnete Shopify-Produkte: {result.otherCount}
            {result.otherCount > 0 && " (z. B. Shopify-Testdaten)"}.
          </p>
          <p className="mt-1 text-xs">
            {inventory.state === "ok" && (
              <span className="text-emerald-300">Bestand, Bestandsverfolgung und Kosten pro Artikel werden mitgeprüft (read_inventory).</span>
            )}
            {inventory.state === "missing-scope" && (
              <span className="text-subtle">Bestand und Kosten werden nicht geprüft – dafür braucht die App zusätzlich read_inventory.</span>
            )}
            {inventory.state === "error" && (
              <span className="text-amber-200">Bestand und Kosten konnten nicht geprüft werden – siehe Karte „Shopify-Bestand“.</span>
            )}
          </p>
          {(status.moreProducts || status.moreVariantsIn.length > 0) && (
            <p className="mt-1 text-xs text-amber-200">
              Unvollständig gelesen:
              {status.moreProducts && " mehr als 1000 Produkte im Store, nur die ersten 1000 sind berücksichtigt."}
              {status.moreVariantsIn.length > 0 && ` mehr als 100 Varianten bei ${status.moreVariantsIn.join(", ")}.`}
            </p>
          )}
        </Card>
      </div>

      <InventoryPanel inventory={inventory} />

      <Card title="Demo-Produkte im Vergleich" description="Soll = Kontrollzentrale, Ist = Shopify" flush>
        <Table minWidth={860}>
          <thead>
            <tr>
              <Th>Produkt</Th>
              <Th>Zustand</Th>
              <Th>Abweichungen</Th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.handle} className="align-top">
                <Td className="align-top">
                  <div className="font-medium">{row.title}</div>
                  <div className="font-mono text-xs text-subtle">{row.handle}</div>
                </Td>
                <Td className="align-top">
                  {row.kind === "match" && (
                    <Badge tone="green">
                      <CircleCheck className="size-3" aria-hidden /> Übereinstimmend
                    </Badge>
                  )}
                  {row.kind === "drift" && (
                    <Badge tone="amber">
                      <CircleAlert className="size-3" aria-hidden /> {row.diffs.length} Abweichung{row.diffs.length > 1 ? "en" : ""}
                    </Badge>
                  )}
                  {row.kind === "missing" && (
                    <Badge tone="red">
                      <CircleMinus className="size-3" aria-hidden /> Fehlt in Shopify
                    </Badge>
                  )}
                  {row.kind !== "missing" && <div className="mt-1 text-xs text-subtle">erkannt über {row.matchedBy === "handle" ? "Handle" : "SKU"}</div>}
                </Td>
                <Td className="align-top">
                  {row.kind === "missing" ? (
                    <span className="text-sm text-muted">Import über CSV oder später per API (Entwurf).</span>
                  ) : row.diffs.length === 0 ? (
                    <span className="text-sm text-muted">–</span>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {row.diffs.map((d) => (
                        <li key={d.field} className="grid grid-cols-[10rem_1fr] gap-2">
                          <span className="text-subtle">{d.field}</span>
                          <span>
                            Soll <span className="font-medium text-fg">{d.expected}</span> · Ist{" "}
                            <span className="font-medium text-amber-200">{d.actual}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {result.unknownDemo.length > 0 && (
          <p className="border-t border-line px-5 py-3 text-xs text-amber-200">
            Unbekannte Produkte mit Demo-Merkmalen in Shopify: {result.unknownDemo.map((p) => p.handle).join(", ")}
          </p>
        )}
      </Card>
    </div>
  );
}

function SetupHelp({ missing, problems }: { missing: string[]; problems: string[] }) {
  return (
    <Card title="Shopify ist noch nicht verbunden" description="Einmalige Einrichtung – Details in docs/SHOPIFY-API-EINRICHTUNG.md">
      <div className="grid gap-6 lg:grid-cols-2">
        <ol className="list-inside list-decimal space-y-2 text-sm text-muted">
          <li>
            Im <span className="text-fg">Shopify Dev Dashboard</span> eine App anlegen (gleiche Organisation wie der Store yakru).
          </li>
          <li>
            In der App-Version nur die Berechtigungen <code className="rounded bg-surface-2 px-1 font-mono text-xs text-fg">read_products</code> und{" "}
            <code className="rounded bg-surface-2 px-1 font-mono text-xs text-fg">read_inventory</code> auswählen, Version veröffentlichen und
            die App auf dem Store installieren.
          </li>
          <li>
            Client ID und Client Secret in die Datei <code className="rounded bg-surface-2 px-1 font-mono text-xs text-fg">.env.local</code> im
            Projektordner eintragen (wird nicht ins Git übernommen).
          </li>
          <li>Entwicklungsserver neu starten und diese Seite neu laden.</li>
        </ol>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-subtle">
            <KeyRound className="size-3.5" aria-hidden /> Benötigte Einträge in .env.local
          </p>
          <ul className="space-y-1.5">
            {SETUP_ENV_NAMES.map((name) => (
              <li key={name} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2">
                <code className="font-mono text-xs">{name}</code>
                {missing.includes(name) ? <Badge tone="red">fehlt</Badge> : <Badge tone="green">gesetzt</Badge>}
              </li>
            ))}
          </ul>
          {problems.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-amber-200">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

const STEP_ICON: Record<StepState, typeof CircleCheck> = { ok: CircleCheck, blocked: CircleX, skipped: CircleMinus };
const STEP_COLOR: Record<StepState, string> = { ok: "text-emerald-400", blocked: "text-rose-300", skipped: "text-subtle" };

/** Dry-Run der geplanten automatischen Produktanlage – rechnet nur, sendet nichts. */
function PipelinePreview() {
  const listings = new Map(DEMO_LISTINGS.map((l) => [l.productId, l]));
  const results = getProductAnalyses().map((a) => evaluatePipeline(a, listings.get(a.product.id)));
  const stepLabels = results[0]?.steps.map((s) => s.label) ?? [];

  return (
    <Card
      title="Automatische Produktanlage (Dry-Run)"
      description="Produktanalyse → Lieferantenvergleich → Margenkalkulation → Compliance-Prüfung → Shopify-Produktentwurf. Es wird nichts an Shopify gesendet."
      action={<DemoBadge label="Dry-Run" />}
      className="mt-4"
      flush
    >
      <Table minWidth={980}>
        <thead>
          <tr>
            <Th>Produkt</Th>
            {stepLabels.map((l) => (
              <Th key={l}>{l}</Th>
            ))}
            <Th>Ergebnis</Th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.productId} className="align-top">
              <Td className="align-top font-medium">{r.productName}</Td>
              {r.steps.map((s) => {
                const Icon = STEP_ICON[s.state];
                return (
                  <Td key={s.key} className="align-top">
                    <span className="flex items-start gap-1.5 text-xs" title={s.detail}>
                      <Icon className={`mt-px size-3.5 shrink-0 ${STEP_COLOR[s.state]}`} aria-hidden />
                      <span className={s.state === "skipped" ? "text-subtle" : "text-muted"}>{s.detail}</span>
                    </span>
                  </Td>
                );
              })}
              <Td className="align-top">
                {r.wouldCreateDraft ? <Badge tone="cyan">Entwurf möglich</Badge> : <Badge tone="neutral">gestoppt</Badge>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="flex items-center gap-1.5 px-5 py-3 text-xs text-muted">
        <PlugZap className="size-3.5" aria-hidden /> Schreibzugriff auf Shopify ist gesperrt (Sicherheitsschalter). Auch später entstehen nur Entwürfe; Veröffentlichen bleibt manuell.
      </p>
    </Card>
  );
}

function Notice({ icon: Icon, tone, title, children }: { icon: typeof Lock; tone: "amber" | "red"; title: string; children: ReactNode }) {
  const cls = tone === "red" ? "border-rose-400/25 bg-rose-500/5 text-rose-100" : "border-amber-400/25 bg-amber-400/5 text-amber-100";
  return (
    <div className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${cls}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 text-sm">{children}</div>
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={`min-w-0 break-words text-right ${warn ? "text-amber-200" : "text-fg"}`}>{value}</dd>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "green" | "amber" | "red" }) {
  const color = { neutral: "text-fg", green: "text-emerald-300", amber: "text-amber-300", red: "text-rose-300" }[tone];
  return (
    <div className="rounded-lg border border-line bg-surface-2/40 p-3">
      <p className="text-xs text-subtle">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
