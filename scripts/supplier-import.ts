// Import von Lieferanten-Preislisten (CSV) in den lokalen Angebotsspeicher – nie Shopify, nie Bestellungen.
//
//   npm run suppliers:import -- <preisliste.csv> [--mapping <zuordnung.json>] [--synthetisch]
//       Testlauf: prüft alles, zeigt Änderungen und einen Bestätigungscode, schreibt NICHTS.
//   npm run suppliers:import -- <preisliste.csv> [...] --apply --confirm <CODE>
//       Übernimmt genau den geprüften Stand (Code passt nur zu dieser Datei, Zuordnung und diesem Speicherstand).
//   npm run suppliers:import -- --status
//       Zeigt Speicherstand und prüft die Nachweisdatei.
//
// Kein Netzwerk, keine kostenpflichtigen Dienste. Dokumentation: docs/LIEFERANTEN-IMPORT.md

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { DEMO_QUERIES } from "@/lib/suppliers";
import { applyImportPlan, planImport, type ColumnMapping, type ImportPlan } from "@/lib/suppliers/import";
import { EVIDENCE_FILE, loadEvidence, loadOfferStore, OFFER_STORE_FILE, saveOfferStore } from "@/lib/suppliers/server/offer-store";

const args = process.argv.slice(2);
const FLAGS = new Set(["--apply", "--synthetisch", "--status"]);
const OPTIONS = new Set(["--mapping", "--confirm"]);

/** Strenge Argumentprüfung: unbekannte oder doppelte Optionen und mehrere Dateien brechen ab, statt zu raten. */
function parseArgs(list: string[]) {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  const files: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (FLAGS.has(a)) flags.add(a);
    else if (OPTIONS.has(a)) {
      const value = list[i + 1];
      if (value === undefined || value.startsWith("--")) errors.push(`${a} braucht einen Wert.`);
      else if (options.has(a)) errors.push(`${a} ist mehrfach angegeben.`);
      else options.set(a, value);
      i++;
    } else if (a.startsWith("--")) errors.push(`Unbekannte Option ${a}.`);
    else files.push(a);
  }
  if (files.length > 1) errors.push(`Genau eine Preisliste angeben (gefunden: ${files.join(", ")}).`);
  return { flags, options, file: files[0], errors };
}
const parsed = parseArgs(args);
const flag = (name: string) => parsed.flags.has(name);
const option = (name: string) => parsed.options.get(name);
/** Einfache Anführungszeichen wirken in Bash und PowerShell gleich (kein $-Ersetzen); null = nicht sicher darstellbar. */
const quoteArg = (a: string): string | null => (/^[\w./\:-]+$/.test(a) ? a : a.includes("'") ? null : `'${a}'`);
const log = (line = "") => console.log(line);
const fmt = (v: unknown) => (v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));

function status(): number {
  const { store, error } = loadOfferStore();
  const evidence = loadEvidence();
  log(`Angebotsspeicher: ${OFFER_STORE_FILE}`);
  if (error) log(`  ! ${error}`);
  const offers = Object.values(store.offers);
  log(`  ${offers.length} Angebote (${offers.filter((o) => o.provenance.synthetic).length} Testdaten), ${store.imports.length} Importe`);
  for (const imp of store.imports.slice(-5)) {
    log(`  • ${imp.importedAt.slice(0, 16)} ${imp.file}${imp.synthetic ? " [Testdaten]" : ""}: ${imp.counts.new} neu, ${imp.counts.changed} geändert, ${imp.counts.unchanged} unverändert`);
  }
  log(`Nachweise: ${EVIDENCE_FILE}`);
  log(`  ${evidence.entries.length} gültige Einträge`);
  for (const e of evidence.errors) log(`  ! ${e}`);
  return error || evidence.errors.length ? 1 : 0;
}

function report(plan: ImportPlan) {
  log(`Datei: ${plan.file} (SHA-256 ${plan.fileSha256.slice(0, 16)}…)${plan.synthetic ? " – SYNTHETISCHE TESTDATEN" : ""}`);
  log(`Trennzeichen: ${plan.delimiter}`);
  for (const e of plan.structureErrors) log(`  ✗ ${e}`);
  if (plan.columns.mapped.length) log(`Zugeordnete Spalten: ${plan.columns.mapped.map((c) => `${c.header} → ${c.label}`).join("; ")}`);
  if (plan.columns.ignored.length) log(`Ignorierte Spalten: ${plan.columns.ignored.join(", ")}`);
  for (const n of plan.columns.notices) log(`  ! ${n}`);
  log();
  for (const r of plan.rows) {
    if (r.status === "valid" && r.warnings.length === 0) continue;
    const mark = r.status === "rejected" ? "✗ abgelehnt" : r.status === "duplicate" ? "= Dublette" : "! Hinweis";
    log(`Zeile ${r.line} ${mark}${r.key ? ` (${r.key})` : ""}`);
    for (const e of r.errors) log(`    – ${e}`);
    for (const w of r.warnings) log(`    · ${w}`);
  }
  if (plan.changed.length) {
    log();
    log("Geänderte Angebote (alte Fassung bleibt in der Historie):");
    for (const c of plan.changed) {
      log(`  ${c.key}`);
      for (const ch of c.changes) log(`    ${ch.label}: ${fmt(ch.before)} → ${fmt(ch.after)}`);
    }
  }
  if (plan.notInFile.length) {
    log(`Nicht (gültig) in dieser Liste – bleiben gespeichert, gelten nach der Übernahme aber als nicht mehr aktuell und werden im Scout ausgeschlossen: ${plan.notInFile.join(", ")}`);
  }
  const c = plan.counts;
  log();
  log(`Zeilen ${c.rows}: ${c.valid} gültig, ${c.rejected} abgelehnt, ${c.duplicates} Dubletten → ${c.new} neu, ${c.changed} geändert, ${c.unchanged} unverändert`);
  log(`Ohne GTIN: ${plan.withoutGtin.length} · unbekannte GTIN: ${plan.unknownGtin.length} (gespeichert, aber keinem Produkt zugeordnet)`);
}

function main(): number {
  if (parsed.errors.length) {
    for (const e of parsed.errors) log(`Abbruch: ${e}`);
    return 2;
  }
  if (flag("--status")) return status();
  const file = parsed.file;
  if (!file) {
    log("Aufruf: npm run suppliers:import -- <preisliste.csv> [--mapping <zuordnung.json>] [--synthetisch] [--apply --confirm <CODE>]");
    return 2;
  }
  const mappingFile = option("--mapping");
  const mapping: ColumnMapping = mappingFile ? JSON.parse(readFileSync(mappingFile, "utf8")) : {};
  const synthetic = flag("--synthetisch") || /\.synthetisch\./i.test(basename(file));
  const loaded = loadOfferStore();
  if (loaded.error) {
    log(`Abbruch: ${loaded.error} Der Speicher wird nicht überschrieben – bitte ${OFFER_STORE_FILE} prüfen.`);
    return 1;
  }
  const now = new Date();
  const text = readFileSync(file, "utf8");
  // Demo-Zuordnung nur für synthetische Testdaten. Echte Zeilen werden nie Demo-Produkten zugeordnet – auch nicht über
  // Demo-GTINs –, sondern in der Market-Pipeline über den lokalen Zielproduktkatalog (Paket I).
  const knownGtins: ReadonlyMap<string, string> = synthetic ? new Map(Object.values(DEMO_QUERIES).map((q) => [q.gtin, q.productId] as const)) : new Map();
  if (!synthetic) log("Hinweis: Echte Zeilen werden über den Zielproduktkatalog zugeordnet (npm run market:scan), nicht über Demo-Produkte.");
  const plan = planImport({
    text,
    file: basename(file),
    mapping,
    synthetic,
    importId: `imp-${now.toISOString().replace(/[:.]/g, "-")}`,
    importedAt: now.toISOString(),
    knownGtins,
    store: loaded.store,
  });

  log(flag("--apply") ? "Preislisten-Import – ÜBERNEHMEN" : "Preislisten-Import – Testlauf (schreibt nichts)");
  report(plan);

  if (!plan.canApply) {
    log();
    log("Nicht übernehmbar: bitte Fehler beheben.");
    return 1;
  }
  if (!flag("--apply")) {
    log();
    log(`Bestätigungscode: ${plan.confirmationCode}`);
    const rerun = [quoteArg(file), ...(mappingFile ? ["--mapping", quoteArg(mappingFile)] : []), ...(flag("--synthetisch") ? ["--synthetisch"] : [])];
    if (rerun.includes(null)) log("Übernehmen: denselben Befehl mit --apply --confirm " + plan.confirmationCode + " ausführen (Dateiname mit Sonderzeichen bitte selbst einsetzen).");
    else log(`Übernehmen mit: npm run suppliers:import -- ${rerun.join(" ")} --apply --confirm ${plan.confirmationCode}`);
    return 0;
  }
  const confirm = option("--confirm");
  if (confirm !== plan.confirmationCode) {
    log();
    log("Abbruch: Bestätigungscode fehlt oder passt nicht – Datei, Zuordnung oder Speicher haben sich seit dem Testlauf geändert. Bitte erneut prüfen.");
    return 1;
  }
  const next = applyImportPlan(plan, loaded.store);
  const backup = saveOfferStore(next, { backupTag: plan.importId });
  log();
  log(`Übernommen: ${plan.counts.new} neu, ${plan.counts.changed} geändert, ${plan.counts.unchanged} unverändert. Nichts gelöscht.`);
  log(`Speicher: ${OFFER_STORE_FILE}${backup ? ` · Sicherung des vorigen Stands: ${backup}` : ""}`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.log(`Abbruch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
