// Build- und Startsperre (läuft automatisch als `prebuild` und `prestart`, Paket I).
//
//   npm run build / npm run start   brechen ab, wenn .data/ echte Daten enthält (echte Preislisten oder Nachweise,
//                                   Zielproduktkatalog, echte Kandidaten, echte Entwurfs-Artefakte oder Journale).
//
// Nur lesend: kein Schreiben, kein Netzwerk, keine Umgebungsvariablen. Die Kontrollzentrale mit echten Daten läuft bis
// zum Login-Konzept (Phase 3) ausschließlich lokal über `npm run dev` (gebunden an 127.0.0.1).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { publicDataViolations } from "@/lib/guards/public-data";

const DATA_DIR = join(process.cwd(), ".data");

const violations = publicDataViolations({
  read: (rel) => {
    const file = join(DATA_DIR, rel);
    return existsSync(file) && statSync(file).isFile() ? readFileSync(file, "utf8") : null;
  },
  list: (rel) => {
    const dir = join(DATA_DIR, rel);
    return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).sort() : [];
  },
});

if (violations.length > 0) {
  console.log("Abbruch: .data/ enthält echte Daten – Build und Start sind gesperrt, bis die Kontrollzentrale ein Login hat.");
  for (const v of violations) console.log(`  – ${v}`);
  console.log("Mit echten Daten nur lokal arbeiten: npm run dev (127.0.0.1). Siehe docs/MARKET-SCOUT.md („Build- und Startsperre“).");
  process.exitCode = 1;
} else {
  console.log("Prüfung .data/: keine echten Daten gefunden – Build/Start erlaubt.");
}
