// Prüft Einstellungswerte in JSON-Templates und settings_data.json gegen die Section-Schemas.
// Ergänzt Shopify Theme Check, der z. B. ungültige Schrittweiten von Schiebereglern nicht erkennt
// (Shopify lehnt solche Dateien erst beim Hochladen ab).
//
// Aufruf: npm run validate   (im Ordner storefront/)

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (p) => readFileSync(join(root, p), "utf8");
const errors = [];

function checkValue(where, id, value, def) {
  if (def.type === "range") {
    const ok = value >= def.min && value <= def.max && (value - def.min) % def.step === 0;
    if (!ok) errors.push(`${where}: "${id}" = ${value} – erlaubt ${def.min}–${def.max} in Schritten von ${def.step}`);
  }
  if (def.type === "select" && !def.options.some((o) => o.value === value)) {
    errors.push(`${where}: "${id}" = "${value}" – erlaubt: ${def.options.map((o) => o.value).join(", ")}`);
  }
}

// 1. Globale Theme-Einstellungen
const globalDefs = new Map();
for (const group of JSON.parse(read("config/settings_schema.json"))) {
  for (const s of group.settings ?? []) if (s.id) globalDefs.set(s.id, s);
}
const data = JSON.parse(read("config/settings_data.json"));
const preset = typeof data.current === "string" ? data.presets[data.current] : data.current;
for (const [id, value] of Object.entries(preset)) {
  const def = globalDefs.get(id);
  if (def) checkValue("config/settings_data.json", id, value, def);
}

// 2. Section-Schemas einlesen
const schemas = {};
for (const file of readdirSync(join(root, "sections")).filter((f) => f.endsWith(".liquid"))) {
  const match = read(`sections/${file}`).match(/{%-?\s*schema\s*-?%}([\s\S]*?){%-?\s*endschema\s*-?%}/);
  if (match) schemas[file.replace(".liquid", "")] = JSON.parse(match[1]);
}

// 2b. Schema-Regeln, die Shopify erst beim Hochladen prüft
for (const [name, schema] of Object.entries(schemas)) {
  const all = [...(schema.settings ?? []), ...(schema.blocks ?? []).flatMap((b) => b.settings ?? [])];
  for (const s of all) {
    if (s.id && "default" in s && s.default === "") errors.push(`sections/${name}.liquid: Einstellung "${s.id}" – leerer Standardwert ist nicht erlaubt (default weglassen)`);
  }
}

// 3. JSON-Templates und Section-Gruppen prüfen
const files = [
  ...readdirSync(join(root, "templates"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => `templates/${f}`),
  ...readdirSync(join(root, "sections"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => `sections/${f}`),
];
for (const file of files) {
  const json = JSON.parse(read(file).replace(/^\/\*[\s\S]*?\*\/\s*/, ""));
  for (const [key, section] of Object.entries(json.sections ?? {})) {
    const schema = schemas[section.type];
    if (!schema) continue;
    const defs = new Map((schema.settings ?? []).filter((s) => s.id).map((s) => [s.id, s]));
    for (const [id, value] of Object.entries(section.settings ?? {})) {
      const def = defs.get(id);
      if (def) checkValue(`${file} › ${key}`, id, value, def);
    }
    for (const [blockKey, block] of Object.entries(section.blocks ?? {})) {
      const blockSchema = (schema.blocks ?? []).find((b) => b.type === block.type);
      const blockDefs = new Map((blockSchema?.settings ?? []).filter((s) => s.id).map((s) => [s.id, s]));
      for (const [id, value] of Object.entries(block.settings ?? {})) {
        const def = blockDefs.get(id);
        if (def) checkValue(`${file} › ${key} › ${blockKey}`, id, value, def);
      }
    }
  }
}

if (errors.length) {
  console.error(`Ungültige Einstellungswerte (${errors.length}):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Einstellungen gültig (${files.length + 1} Dateien geprüft).`);
