// Automatische Shopify-Synchronisierung (Reparatur) – lokal per Befehl, nie aus dem Dashboard.
//
//   npm run shopify:sync              Testlauf: liest Shopify, zeigt geplante Änderungen, schreibt nichts
//   npm run shopify:sync -- --apply   führt die geplanten Änderungen aus und prüft danach live nach
//
// Schreibt ausschließlich Operationen aus der Positivliste (src/lib/shopify/write-operations.ts).
// Gibt nur Handles, SKUs und bereinigte Meldungen aus – nie Zugangsdaten.

import { getProductAnalyses } from "@/lib/data";
import { summarizeInventory } from "@/lib/shopify/inventory";
import { reconcile } from "@/lib/shopify/reconcile";
import { isTransient, planRepairs } from "@/lib/shopify/repair";
import { createGuardedWriteClient, createReadOnlyAdminClient } from "@/lib/shopify/server/admin-client";
import { readShopifyConfig } from "@/lib/shopify/server/config";
import { readAllProducts, readInventory } from "@/lib/shopify/server/read-products";
import { describeError } from "@/lib/shopify/server/sync-status";
import { planProductSync } from "@/lib/shopify/sync";

const apply = process.argv.includes("--apply");
const log = (line = "") => console.log(line);

async function readState(credentials: Parameters<typeof createReadOnlyAdminClient>[0]) {
  const client = await createReadOnlyAdminClient(credentials);
  const read = await readAllProducts(client);
  const productsComplete = !read.moreProducts && read.moreVariantsIn.length === 0;
  let products = read.products;
  let inventoryComplete = false;
  if (client.scopes.includes("read_inventory")) {
    const inv = await readInventory(client, products);
    products = inv.products;
    const overview = summarizeInventory(products, { missingVariants: inv.missingVariants });
    inventoryComplete = productsComplete && overview.missingVariants === 0 && !overview.truncated;
  }
  return { client, products, productsComplete, inventoryComplete };
}

async function main(): Promise<number> {
  const config = readShopifyConfig();
  if (config.status !== "ok") {
    log(`Shopify ist nicht konfiguriert (${config.status === "missing" ? `fehlt: ${config.missing.join(", ")}` : config.problems.join(" ")}).`);
    return 2;
  }
  const expected = planProductSync(getProductAnalyses()).map((p) => p.input);

  log(`Shopify-Synchronisierung – ${apply ? "AUSFÜHREN" : "Testlauf (schreibt nichts)"}`);
  const before = await readState(config.credentials);
  log(`Store ${before.client.storeDomain} · Rechte ${before.client.scopes.join(", ")}`);
  log(`Gelesen: ${before.products.length} Produkte · Bestand ${before.inventoryComplete ? "vollständig" : "nicht vollständig"}`);

  const plan = planRepairs({ expected, shopify: before.products, ...before });
  log();
  log(`Geplante Änderungen: ${plan.actions.length}`);
  for (const a of plan.actions) log(`  • ${a.handle}${a.sku ? ` / ${a.sku}` : ""}: ${a.description}`);
  for (const b of plan.blocked) log(`  ! ${b}`);
  if (plan.manual.length) {
    log(`Nicht automatisch behoben (manuell prüfen): ${plan.manual.length}`);
    for (const m of plan.manual) log(`  – ${m.handle}: ${m.field} – Soll ${m.expected} · Ist ${m.actual}`);
  }

  // Exit-Codes: 0 = alles in Ordnung, 1 = Abweichungen/Fehler offen, 3 = Planung blockiert.
  const verdict = (p: typeof plan, failedCount = 0) =>
    p.blocked.length ? 3 : failedCount || p.actions.length || p.manual.some((m) => !isTransient(m)) ? 1 : 0;

  if (!apply || plan.actions.length === 0) {
    log();
    if (plan.blocked.length) log("Planung blockiert – siehe Hinweise oben. Es wird nichts automatisch geändert.");
    else if (plan.actions.length) log("Testlauf beendet. Ausführen mit: npm run shopify:sync -- --apply");
    else log(plan.manual.length ? "Keine automatischen Änderungen möglich – Abweichungen bitte manuell prüfen." : "Alles in Ordnung, nichts zu tun.");
    // Ein Testlauf mit geplanten Änderungen ist kein Fehler.
    return !apply && !plan.blocked.length && plan.actions.length ? 0 : verdict(plan);
  }

  const writer = await createGuardedWriteClient(config.credentials);
  let failed = 0;
  log();
  for (const a of plan.actions) {
    try {
      await writer.run(a.operation);
      log(`  ✓ ${a.handle}${a.sku ? ` / ${a.sku}` : ""}: ${a.description}`);
    } catch (error) {
      failed++;
      const { kind, message } = describeError(error);
      log(`  ✗ ${a.handle}${a.sku ? ` / ${a.sku}` : ""}: ${a.description} – ${message}`);
      // Bei fehlenden Rechten oder gesperrtem Schalter sofort abbrechen statt weiterzuprobieren.
      if (kind === "scope" || kind === "readonly") break;
    }
  }

  // Nachkontrolle mit frischem Lesestand (Bilder verarbeitet Shopify asynchron).
  const after = await readState(config.credentials);
  const result = reconcile(expected, after.products, { inventoryRead: after.inventoryComplete });
  const remaining = planRepairs({ expected, shopify: after.products, ...after });
  log();
  log(`Nachkontrolle: ${result.summary.match} von ${result.summary.expected} Produkten übereinstimmend · Bestand ${after.inventoryComplete ? "vollständig" : "nicht vollständig"}.`);
  for (const row of result.rows) {
    if (row.kind === "missing") log(`  – ${row.handle}: fehlt in Shopify`);
    else for (const d of row.diffs) log(`  – ${row.handle}: ${d.field} – Soll ${d.expected} · Ist ${d.actual}${isTransient(d) ? " (Shopify verarbeitet noch)" : ""}`);
  }
  for (const b of remaining.blocked) log(`  ! ${b}`);
  if (remaining.actions.length) log(`Noch offene automatische Änderungen: ${remaining.actions.length} (erneut ausführen).`);
  return verdict(remaining, failed);
}

// exitCode statt process.exit(): Node beendet sich sauber, sobald offene Verbindungen geschlossen sind
// (process.exit() löst unter Windows sonst „Assertion failed … async.c“ aus).
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Nur bereinigte Meldungen ausgeben – nie Rohfehler mit möglichen Interna.
    console.log(`Abbruch: ${describeError(error).message}`);
    process.exitCode = 1;
  },
);
