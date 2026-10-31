// Einfacher, strenger CSV-Parser für Lieferanten-Preislisten (RFC 4180 mit Anführungszeichen).
// Erkennt das Trennzeichen (; , oder Tab) anhand der Kopfzeile, entfernt ein UTF-8-BOM und
// verarbeitet CRLF/LF. Keine Abhängigkeiten, kein Dateizugriff.

export interface CsvTable {
  delimiter: ";" | "," | "\t";
  headers: string[];
  /** Datenzeilen mit Zeilennummer in der Datei (Kopfzeile = 1) */
  rows: { line: number; cells: string[] }[];
  /** Strukturfehler, z. B. nicht geschlossene Anführungszeichen */
  errors: string[];
}

function detectDelimiter(firstLine: string): CsvTable["delimiter"] {
  const counts = { ";": 0, ",": 0, "\t": 0 } as Record<CsvTable["delimiter"], number>;
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch as CsvTable["delimiter"]]++;
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as CsvTable["delimiter"]) ?? ";";
}

export function parseCsv(text: string): CsvTable {
  const input = text.replace(/^﻿/, "");
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const records: { line: number; cells: string[] }[] = [];
  const errors: string[] = [];

  let cells: string[] = [];
  let field = "";
  let quoted = false;
  /** Feld stand in Anführungszeichen und ist geschlossen – danach ist nur noch Leerraum erlaubt */
  let closed = false;
  let line = 1;
  let recordLine = 1;
  const malformed = new Set<number>();
  const fail = (at: number) => {
    if (!malformed.has(at) && malformed.size < 20) {
      errors.push(`Zeile ${at}: Anführungszeichen fehlerhaft (Text nach schließendem oder einzelnes Anführungszeichen im Feld).`);
    }
    malformed.add(at);
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        closed = true;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === delimiter) {
      cells.push(field);
      field = "";
      closed = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      cells.push(field);
      records.push({ line: recordLine, cells });
      cells = [];
      field = "";
      closed = false;
      line++;
      recordLine = line;
    } else if (closed) {
      // Nie still Text an ein geschlossenes Feld anhängen („"1"7“ wäre sonst 17).
      if (ch !== " " && ch !== "\t") fail(recordLine);
    } else if (ch === '"') {
      if (field.trim() === "") {
        quoted = true;
        field = "";
      } else fail(recordLine);
    } else {
      field += ch;
    }
  }
  if (quoted) errors.push(`Anführungszeichen ab Zeile ${recordLine} nicht geschlossen.`);
  if (field !== "" || cells.length > 0) {
    cells.push(field);
    records.push({ line: recordLine, cells });
  }

  const nonEmpty = records.filter((r) => r.cells.some((c) => c.trim() !== ""));
  const [header, ...rows] = nonEmpty;
  if (!header) return { delimiter, headers: [], rows: [], errors: [...errors, "Datei ist leer."] };
  return { delimiter, headers: header.cells.map((h) => h.trim()), rows, errors };
}
