# Offene Produktionsanforderungen

Stand 31.10.2026 (nach Auftrag 015). Die Kontrollzentrale ist heute ein **lokales Werkzeug**: `npm run dev` auf dem
eigenen Rechner, Lieferantendaten in `.data/` (von Git ignoriert). Für einen Betrieb auf einem Server oder eine
öffentliche Bereitstellung fehlen die folgenden Punkte. Keiner davon ist für den lokalen Einsatz nötig – vor einem
Deployment aber jeder.

## 1. Lieferantendaten bei Neustart und Deployment (`.data/suppliers`)

**Heute:** Angebotsspeicher, Nachweise und Sicherungen liegen als JSON-Dateien im Projektordner
(`.data/suppliers/offers.json`, `evidence.json`, `backups/`). Ein Neustart des lokalen Servers ändert nichts.

**Risiko bei Deployment:**
- `.data/` ist nicht in Git. Ein Deployment aus dem Repository (z. B. Vercel, Container-Build) startet **ohne**
  Lieferantendaten – der Scout zeigt dann nur Demo-Angebote.
- Auf Plattformen mit flüchtigem oder schreibgeschütztem Dateisystem (Serverless, Container ohne Volume) gehen
  geschriebene Daten beim nächsten Neustart verloren; der Import-Befehl läuft dort ohnehin nicht.
- Es gibt keine Sperre gegen zwei gleichzeitige Importe (lokal unkritisch, der Bestätigungscode schützt nur vor
  veralteten Testläufen).

**Anforderung:** Speicher in eine Datenbank verlagern (geplant: PostgreSQL, Phase 2) mit Transaktionen, Historie
und Sicherung; Import als serverseitiger, authentifizierter Ablauf mit derselben Prüf-/Bestätigungslogik
(`planImport` / `applyImportPlan` sind bereits frei von Dateizugriffen und wiederverwendbar).

## 2. Vertrauliche Lieferantenpreise

**Heute geschützt:**
- Echte Preislisten, Nachweise und Sicherungen liegen nur in `.data/` (gitignored; Sicherheitstest prüft
  `.gitignore`). Im öffentlichen Repository liegen nur synthetische Testdateien.
- Das Layout setzt `robots: noindex, nofollow` (keine Suchmaschinen-Indexierung).

**Risiken:**
- **Vorab erzeugte Seiten enthalten die Preise:** `/lieferanten` und `/produkte` werden beim `npm run build`
  statisch erzeugt. Liegen zu diesem Zeitpunkt importierte Preislisten in `.data/`, stehen Einkaufspreise,
  Konditionen und Lieferantennamen im HTML unter `.next/server/app/` – und damit in jedem Build-Artefakt, das
  hochgeladen oder geteilt wird. `.next/` ist gitignored, gelangt also nicht ins Repository.
- **Ohne Login ist jede Bereitstellung öffentlich:** Wer die URL kennt, sieht alle Preise, Margen und Konditionen.

**Anforderung:** vor jeder Bereitstellung Authentifizierung (Punkt 4); Seiten mit Lieferantendaten dynamisch und
nur für angemeldete Nutzer rendern; keine Builds mit echten Daten weitergeben.

## 3. Aktualisierung der Lieferantenseite ohne manuellen Build

**Heute:** Im Entwicklungsserver erscheinen neue Importe beim Neuladen. Im Produktions-Build sind `/lieferanten`
und `/produkte` statisch – neue Daten erst nach erneutem `npm run build`.

**Anforderung:** Mit dem Wechsel auf eine Datenbank die Seiten dynamisch rendern (Next.js 16 mit Cache Components:
Datenzugriff hinter `connection()` bzw. in einer dynamischen Komponente) oder gezielt nach jedem Import
neu validieren (`revalidateTag`/`updateTag` im Import-Ablauf). Damit entfällt auch das Problem aus Punkt 2, dass
Preise in Build-Artefakten landen.

## 4. Authentifizierung der Kontrollzentrale

**Ja – zwingend vor jeder öffentlichen Bereitstellung.** Die Kontrollzentrale zeigt Einkaufspreise, Margen,
Lieferantenkonditionen, Budget und Shopify-Daten. Heute gibt es keinen Login.

Bereits vorbereitet: Live-Abfragen an Shopify laufen nur im lokalen Entwicklungsmodus
(`isLocalDevelopment()`); im Produktionsbetrieb ist die Shopify-Ansicht gesperrt, bis es einen Login gibt.
Schreibzugriffe auf Shopify gibt es nur über den lokalen Befehl `npm run shopify:sync -- --apply`, nie über
das Dashboard.

**Anforderung:** Anmeldung für alle Seiten (z. B. Auth.js/NextAuth mit Single Sign-on oder ein vorgeschalteter
Zugangsschutz der Hosting-Plattform), serverseitige Prüfung in einer `proxy.ts`/Layout-Prüfung, keine
öffentlichen Vorschau-URLs mit echten Daten. Erst danach Live-Daten im Produktionsbetrieb freischalten.

## 5. Weitere Punkte vor dem Produktivbetrieb

- **Gleichzeitige Importe:** Dateisperre oder Datenbanktransaktion (siehe Punkt 1).
- **Wiederherstellung:** Sicherungen liegen in `.data/suppliers/backups/`; Wiederherstellung heute manuell
  (Datei zurückkopieren, siehe `docs/LIEFERANTEN-IMPORT.md`). Mit Datenbank: Point-in-Time-Recovery.
- **Echte Kontodaten** für die Finanzierungsprüfung (`FUNDING.verified` bleibt `false`, bis ein Kontonachweis
  angebunden ist).
- **CI:** GitHub Actions prüft jeden Pull Request ohne Secrets (`.github/workflows/ci.yml`). Für eine spätere
  Bereitstellung braucht es eine getrennte Umgebung mit eigenen, nur lesenden Zugangsdaten.
