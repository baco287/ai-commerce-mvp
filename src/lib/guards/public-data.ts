// Build- und Startsperre (Paket I): Solange die Kontrollzentrale kein Login hat, dürfen `next build` und `next start`
// nicht laufen, wenn .data/ echte Daten enthält – sonst könnten Einkaufspreise, Konditionen oder echte Kandidaten in
// eine Auslieferung gelangen. Reine Prüfung; das Lesen der Dateien übernimmt scripts/check-public-data.ts.
//
// Gesperrt wird bei (fail-closed – unlesbare Dateien zählen als echte Daten):
// - nicht-synthetischen Angeboten im Lieferanten-Speicher (suppliers/offers.json) oder Nachweisen zu solchen Angeboten
// - einem lokalen Zielproduktkatalog (catalog/products.json)
// - echten Kandidaten im Market-Scout-Stand (market/state.json, auch simulated/)
// - echten Entwurfs-Artefakten oder Journal-Einträgen echter Kandidaten (market/drafts, market/journal, auch simulated/)

export interface PublicDataReader {
  /** Inhalt einer Datei relativ zu .data/ – null, wenn sie fehlt */
  read(rel: string): string | null;
  /** Dateinamen eines Verzeichnisses relativ zu .data/ – leer, wenn es fehlt */
  list(rel: string): string[];
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Gründe, warum Build/Start gesperrt sind (leer = keine echten Daten gefunden). */
export function publicDataViolations(io: PublicDataReader): string[] {
  const out: string[] = [];

  // Lieferanten-Speicher: nur synthetische Testdaten erlaubt
  const offersText = io.read("suppliers/offers.json");
  const syntheticKeys = new Set<string>();
  if (offersText !== null) {
    const store = parse(offersText);
    const offers = isObject(store) && isObject(store.offers) ? Object.values(store.offers) : null;
    if (!offers) out.push("suppliers/offers.json ist nicht lesbar – wird wie echte Daten behandelt.");
    else {
      const real = offers.filter((o) => !(isObject(o) && isObject(o.provenance) && o.provenance.synthetic === true));
      if (real.length > 0) out.push(`suppliers/offers.json enthält ${real.length} nicht-synthetische Angebote (echte Preislisten).`);
      for (const o of offers) if (isObject(o) && typeof o.key === "string" && isObject(o.provenance) && o.provenance.synthetic === true) syntheticKeys.add(o.key);
    }
  }
  const evidenceText = io.read("suppliers/evidence.json");
  if (evidenceText !== null) {
    const evidence = parse(evidenceText);
    const entries = Array.isArray(evidence) ? evidence : isObject(evidence) && Array.isArray(evidence.entries) ? evidence.entries : null;
    if (!entries) out.push("suppliers/evidence.json ist nicht lesbar – wird wie echte Daten behandelt.");
    else if (entries.some((e) => !(isObject(e) && typeof e.offerKey === "string" && syntheticKeys.has(e.offerKey)))) {
      out.push("suppliers/evidence.json enthält Nachweise zu echten Angeboten.");
    }
  }

  // Lokaler Zielproduktkatalog: enthält immer echte Produktdaten
  if (io.read("catalog/products.json") !== null) out.push("catalog/products.json (lokaler Zielproduktkatalog) ist vorhanden.");

  // Market Scout: produktiver und simulierter Speicher
  for (const base of ["market", "market/simulated"]) {
    const stateText = io.read(`${base}/state.json`);
    if (stateText !== null) {
      const state = parse(stateText);
      const candidates = isObject(state) && isObject(state.candidates) ? Object.values(state.candidates) : null;
      if (!candidates) out.push(`${base}/state.json ist nicht lesbar – wird wie echte Daten behandelt.`);
      else {
        const real = candidates.filter((c) => !(isObject(c) && isObject(c.latest) && isObject(c.latest.candidate) && c.latest.candidate.demo === true));
        if (real.length > 0) out.push(`${base}/state.json enthält ${real.length} echte Kandidaten.`);
      }
    }
    const realDrafts = io
      .list(`${base}/drafts`)
      .filter((f) => f.endsWith(".json"))
      .filter((f) => {
        const a = parse(io.read(`${base}/drafts/${f}`) ?? "");
        return !(isObject(a) && a.demo === true);
      });
    if (realDrafts.length > 0) out.push(`${base}/drafts enthält ${realDrafts.length} echte (oder unlesbare) Entwurfs-Artefakte.`);
    const realJournals = io
      .list(`${base}/journal`)
      .filter((f) => f.endsWith(".jsonl"))
      .filter((f) =>
        (io.read(`${base}/journal/${f}`) ?? "")
          .split("\n")
          .filter((line) => line.trim() !== "")
          .some((line) => {
            const e = parse(line);
            return !isObject(e) || (e.type === "candidate" && e.demo !== true);
          }),
      );
    if (realJournals.length > 0) out.push(`${base}/journal enthält ${realJournals.length} Protokolle mit echten Kandidaten.`);
  }
  return out;
}
