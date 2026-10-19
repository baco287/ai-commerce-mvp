// Prüft data/demo-products.csv vor dem Import in Shopify.
// Aufruf: npm run validate:products   (im Ordner storefront/)

import { readFileSync } from "node:fs";

// Die Datei wird aus den Dashboard-Daten erzeugt: im Hauptordner `npm run shopify:csv`.
const REQUIRED = [
  "Title",
  "URL handle",
  "Status",
  "Published on online store",
  "Option1 name",
  "Option1 value",
  "Price",
  "SKU",
  "Tags",
  "Inventory tracker",
  "Inventory quantity",
  "Continue selling when out of stock",
];
const LEGACY = ["Handle", "Body (HTML)", "Variant Price", "Published", "Option1 Name", "Variant SKU"];
const FORBIDDEN_CLAIMS = [/Werktage/i, /Lieferung in \d/i, /Express/i, /Garantie/i, /\bSterne?\b/i, /Bewertung(en)? \d/i, /zertifiziert/i, /Testsieger/i, /kostenloser Versand/i];

const raw = readFileSync(new URL("../data/demo-products.csv", import.meta.url), "utf8");
const errors = [];
if (raw.charCodeAt(0) === 0xfeff) errors.push("Datei beginnt mit BOM – bitte UTF-8 ohne BOM speichern.");

// Minimaler CSV-Parser (Anführungszeichen, Kommas, doppelte Anführungszeichen)
function parse(text) {
  const out = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); out.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c !== ""));
}

const [header, ...rows] = parse(raw);
const col = (name) => header.indexOf(name);

for (const name of REQUIRED) if (col(name) === -1) errors.push(`Spalte fehlt: "${name}"`);
for (const name of LEGACY) if (col(name) !== -1) errors.push(`Veraltete Spalte: "${name}"`);

const products = new Map();
rows.forEach((r, i) => {
  const line = i + 2;
  if (r.length !== header.length) errors.push(`Zeile ${line}: ${r.length} statt ${header.length} Spalten`);
  const get = (name) => r[col(name)] ?? "";
  const handle = get("URL handle");
  if (!/^[a-z0-9-]+$/.test(handle)) errors.push(`Zeile ${line}: ungültiges URL-Handle "${handle}"`);
  if (!/^\d+\.\d{2}$/.test(get("Price"))) errors.push(`Zeile ${line}: Preis "${get("Price")}" – erwartet z. B. 29.90 (Punkt, ohne Währung)`);
  if (!get("SKU").startsWith("DEMO-")) errors.push(`Zeile ${line}: SKU muss mit DEMO- beginnen`);
  if (!get("Option1 value")) errors.push(`Zeile ${line}: Option1 value fehlt`);
  // Serverseitige Verkaufssperre: Bestand wird verfolgt, ist 0, Überverkauf verboten
  if (get("Inventory tracker") !== "shopify") errors.push(`Zeile ${line}: "Inventory tracker" muss shopify sein (Bestand verfolgen)`);
  if (get("Inventory quantity") !== "0") errors.push(`Zeile ${line}: "Inventory quantity" muss 0 sein`);
  if (get("Continue selling when out of stock") !== "deny") errors.push(`Zeile ${line}: Überverkauf muss verboten sein (deny)`);

  if (get("Title")) {
    if (products.has(handle)) errors.push(`Zeile ${line}: Handle "${handle}" doppelt`);
    products.set(handle, { variants: 1 });
    if (!get("Title").startsWith("[DEMO]")) errors.push(`Zeile ${line}: Titel muss mit [DEMO] beginnen`);
    if (get("Status") !== "draft") errors.push(`Zeile ${line}: Status muss "draft" sein`);
    if (get("Published on online store") !== "false") errors.push(`Zeile ${line}: "Published on online store" muss false sein`);
    if (!get("Tags").split(",").map((t) => t.trim()).includes("ai-commerce-demo")) errors.push(`Zeile ${line}: Tag ai-commerce-demo fehlt`);
    if (!get("Description").includes("Demo-Produkt")) errors.push(`Zeile ${line}: Demo-Hinweis in der Beschreibung fehlt`);
    for (const re of FORBIDDEN_CLAIMS) if (re.test(get("Title") + get("Description"))) errors.push(`Zeile ${line}: unzulässige Aussage (${re})`);
  } else {
    const p = products.get(handle);
    if (!p) errors.push(`Zeile ${line}: Variante ohne vorherige Produktzeile ("${handle}")`);
    else p.variants++;
    if (get("Status") || get("Published on online store")) errors.push(`Zeile ${line}: Variantenzeile darf keinen Produktstatus setzen`);
  }
});

if (products.size !== 5) errors.push(`Erwartet 5 Produkte, gefunden ${products.size}`);

if (errors.length) {
  console.error(`demo-products.csv: ${errors.length} Problem(e):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
const summary = [...products].map(([h, p]) => `${h} (${p.variants} Variante${p.variants > 1 ? "n" : ""})`).join(", ");
console.log(`demo-products.csv gültig: ${products.size} Produkte, ${rows.length} Zeilen – ${summary}`);
