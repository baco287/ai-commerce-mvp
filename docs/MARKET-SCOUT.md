# Market Scout Agent

Der Market Scout findet automatisch Produktkandidaten, misst das Marktinteresse und schickt interessante
Kandidaten durch die **bestehende** Kette:

```
Market Scan → Kandidatenbewertung → Supplier Scout → Profit Check → Compliance → Shopify-Entwurf (Dry-Run)
```

Er baut kein zweites System: Lieferanten vergleicht der Supplier Scout (`compareQuotes`, inkl. importierter
Preislisten), die Marge rechnet `calc/pricing.ts`, den Entwurf baut `shopify/pipeline.ts` mit den Shopify-Guards.

> **Grundsatz:** Der Agent kauft nichts, schaltet keine Werbung, veröffentlicht nichts, schreibt nicht nach Shopify
> und setzt nie „freigegeben“ oder „Entwurf erstellt“. Fehlende Daten erhöhen die Unsicherheit und zählen nie positiv.

## Marktquellen

| Quelle | Status | Signalart | Kosten | Zugriff |
| --- | --- | --- | --- | --- |
| **Wikipedia-Aufrufe** (Wikimedia Pageviews-API, de.wikipedia) | **angebunden, real** | Öffentliches Interesse – keine Suchanfragen, keine Verkäufe | kostenlos, ohne Schlüssel | [offiziell dokumentiert](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html), Daten CC0 |
| **Wikipedia-Kategorien** (MediaWiki-API `categorymembers`) | **angebunden, real** | Themen-Entdeckung | kostenlos | [offiziell dokumentiert](https://www.mediawiki.org/wiki/API:Categorymembers) |
| Demo-Signale (`src/lib/demo/products.ts`) | Demo | simuliert | – | gekennzeichnet `[DEMO]` |
| Google Trends | **nicht angebunden** | – | – | keine offizielle, frei nutzbare API; inoffizielle Werkzeuge (z. B. pytrends) lesen die Website aus – nicht erlaubt |
| Amazon-Bestseller | **nicht angebunden** | – | – | Auslesen untersagt; Keepa u. Ä. kostenpflichtig |
| eBay, Etsy | **nicht angebunden** | – | – | API-Konto/Schlüssel nötig (kein Konto verbinden) |
| Marktpreise, Wettbewerb | **nicht angebunden** | – | – | keine freie, rechtmäßig nutzbare Quelle → Bestandteil „fehlt“ |

Zugriffsregeln (Wikimedia User-Agent-Policy): eigener User-Agent mit Projekt und Kontakt, Anfragen nacheinander mit
Pause, nur HTTPS, nur `wikimedia.org` und `de.wikipedia.org`, keine Weiterleitungen, Zeitlimit je Anfrage.

**Signalarten werden strikt getrennt** (`SignalKind`): `public_interest`, `search_interest`, `estimate`,
`verified_sales`, `simulated`. Heute gibt es reale Daten nur für `public_interest`.

## Automatische Entdeckung

1. **Feste Themen** zu bekannten Produkten (`LINKED_TOPICS`): Trinkflasche → `p-bottle`, Uhrenarmband → `p-band`,
   Kabelmanagement → `p-cable`. Für LED-Lichtleiste und Laptopständer gibt es keinen passenden Artikel.
2. **Kategorien** (`WATCHED_CATEGORIES`): Haushaltsgerät, Küchengerät, Trinkgefäß, Leuchte, Sportgerät,
   Büromaterial, Werkzeug. Je Kategorie werden bis zu 12 Artikel gelesen; der Startbuchstabe rotiert täglich,
   damit über die Zeit die ganze Kategorie abgedeckt wird.
3. **Filter** (Heuristik): keine Listen, keine Klammerzusätze (Begriffsklärung, Firma, Werk), höchstens vier Wörter.
   Gesperrte Warengruppen (Waffen, Arznei, Kinderprodukte …) werden gar nicht erst gemessen.

Bekannte Grenze: Wikipedia-Kategorien enthalten auch Nicht-Handelswaren (z. B. historische Trinkgefäße). Sie
werden korrekt zurückgestellt, sind aber keine sinnvollen Ideen – eine bessere Themenquelle ist ein nächster Schritt.

## Messung je Thema (eine Anfrage, gut ein Jahr Tageswerte)

| Kennzahl | Berechnung |
| --- | --- |
| Ø 7 / Ø 30 Tage | Durchschnitt Aufrufe pro Tag |
| Trend 7 Tage | Ø letzte 7 Tage ggü. Ø der 28 Tage davor |
| Trend 30 Tage | Ø letzte 30 Tage ggü. Ø der 30 Tage davor |
| Saisonindex | Ø der 30 Tage, die vor einem Jahr auf „heute“ folgten, ÷ Ø des letzten Jahres (> 1 = Saison beginnt) |

Tage ohne Aufrufe fehlen in der API-Antwort und zählen als 0. Unter Ø 2 Aufrufen/Tag gibt es keinen Trend
(zu verrauscht), ohne ein Jahr Historie keinen Saisonindex.

## Opportunity Score

Sieben Bestandteile (0–100 oder „fehlt“), gewichtet:

| Bestandteil | Gewicht | Quelle |
| --- | --- | --- |
| Nachfrage & Trend | 25 % | 60 % Niveau (log: 1/Tag = 0 … 10.000/Tag = 100), 25 % Trend, 15 % Saison |
| Wettbewerb | 10 % | heute keine reale Quelle → fehlt (Demo: simuliert) |
| Gewinnpotenzial | 20 % | Marge aus dem Profit Check (40 % Marge = 100) |
| Lieferanten | 15 % | Anzahl geeigneter Angebote im Supplier Scout |
| Liefergeschwindigkeit | 10 % | 2 Tage = 100, 12 Tage = 0 |
| Sicherheits- & Retourenrisiko | 10 % | Regelwerk `risk.ts` (gering 100, mittel 60, hoch 30, gesperrt 0, unbekannt fehlt) |
| Datenqualität | 10 % | Länge, Aktualität und Menge der realen Daten; Demo = 20 |

- **Fehlt** ein Bestandteil: 0 Punkte **und** sein Gewicht zählt voll zur **Unsicherheit**.
- **Unsicher** (Demo-Werte, nicht verlässliche Marge, unvollständige Nachfrage): halbes Gewicht zur Unsicherheit.
- „Warum interessant“ zeigt nur belegte Bestandteile mit hohem Wert. Es gibt keine bezahlte KI-API; die Bewertung
  ist deterministisch und vollständig nachvollziehbar.

## Pipeline und Zustände

| Stufe | Bestanden, wenn … | Sonst |
| --- | --- | --- |
| Marktbewertung | Nachfrage ≥ 35 (≈ 10 Aufrufe/Tag bei flachem Trend), Warengruppe nicht gesperrt | zurückgestellt / gesperrt |
| Supplier Scout | belastbare Produktidentität (bekanntes Produkt oder GTIN) und ≥ 1 geeignetes Angebot; **echte Kandidaten nie mit Demo-Lieferanten** | zurückgestellt |
| Profit Check | Marge berechenbar und ≥ 10 %; „verlässlich“ nur mit belegtem Marktpreis, nachgewiesenen Kosten, echten Daten und bestätigtem Steuerstatus | zurückgestellt / gesperrt |
| Compliance | Pflichtunterlagen gegen Angebotsunterlagen; **Freigabe immer durch Menschen** | gesperrt |
| Shopify-Entwurf | bestehende Pipeline baut einen DRAFT im **Dry-Run** und prüft die Guards | „nicht vorbereitet“ |

Zustände: **ungeprüft** (noch nicht gemessen, z. B. Limit), **zurückgestellt**, **gesperrt**, **freigegeben** und
**Entwurf erstellt**. Die letzten beiden setzt der Agent nie (per Sicherheitstest abgesichert).

### Profit Check und Steuerstatus

Nutzt `calculateMargin` unverändert: Nettopreis − Warenkosten (Einkauf + Versand + Import) − Zahlungsgebühr −
Werbekosten je Verkauf (Annahme) − Retourenreserve. Neu: `TAX_SETTINGS` in `src/lib/config/assumptions.ts`
(`regelbesteuert` | `kleinunternehmer`, Standard `regelbesteuert`, **`confirmed: false`**). Kleinunternehmer: keine
USt. auf den Verkauf, dafür nicht abziehbare Vorsteuer auf die Kosten. Solange der Status nicht bestätigt ist, gilt
keine Marge als verlässlich.

## Laufsteuerung

```bash
npm run market:scan                      # Testlauf, nur Demo-Quelle, schreibt nichts
npm run market:scan -- --live            # mit realer Quelle (Wikimedia), schreibt nichts
npm run market:scan -- --live --save     # speichert in .data/market/state.json (Dashboard zeigt diesen Stand)
npm run market:scan -- --status          # gespeicherter Stand, Laufprotokoll, Abbruchschalter
# Optionen: --limit <Kandidaten>  --requests <Abrufe>  (nur kleiner als die Grenzen)
```

| Schutz | Wert / Ort |
| --- | --- |
| Abrufe je Lauf | höchstens 60 (`MARKET_SCAN.maxRequestsPerRun`) |
| Gemessene Kandidaten je Lauf | höchstens 25 – Rest bleibt „ungeprüft“ und folgt im nächsten Lauf |
| Kosten je Lauf | 0 € – kostenpflichtige Quellen sind über `SAFETY_SWITCHES.paidApiCallsEnabled` gesperrt |
| Abbruchschalter | `MARKET_SCAN.enabled` im Code **und** Datei `.data/market/STOP` (stoppt auch laufende Läufe) |
| Netzwerk | nur im Befehl mit `--live`, nie im Dashboard |
| Wiederholbarkeit | Kandidaten-Schlüssel (z. B. `wiki:de.wikipedia:Bleistift`) – keine Dubletten; „ungeprüft“ überschreibt nie eine Bewertung; Verlauf der letzten 10 Bewertungen, Protokoll der letzten 30 Läufe |
| Fehler | einzelne Quellen oder Kandidaten brechen den Lauf nicht ab; sie stehen im Protokoll |

**Unbeaufsichtigter Lauf:** Der Befehl `npm run market:scan -- --live --save` ist für eine zeitgesteuerte
Ausführung vorbereitet (z. B. Windows-Aufgabenplanung, n8n). **Es ist noch kein Zeitplan eingerichtet**, und der Lauf
schreibt nie nach Shopify.

## Dashboard

- **Produktanalyse** (`/produkte`): Karte „Market Scout“ – je Kandidat Trend, Bewertung mit Unsicherheit,
  Lieferant, Gewinnspanne, Sperr-/Rückstellungsgründe, Entwurfsstatus; aufklappbar Bestandteile der Bewertung,
  Belege mit Link zur Quelle und die Pipeline-Stufen. Echte Kandidaten stehen vor Demo-Kandidaten.
- **KI-Agenten** (`/agenten`): letzter Lauf (Modus, Abrufe, Kosten, Abbruchschalter) und Zählung je Zustand.
- Ohne gespeicherten Lauf zeigt das Dashboard eine **gekennzeichnete Demo-Vorschau** (festes Demo-Datum, kein Netzwerk).

## Dateien

| Datei | Inhalt |
| --- | --- |
| `src/lib/market/model.ts` | Signalarten, Kandidaten, Kennzahlen |
| `src/lib/market/interest.ts` | Zeitreihen auffüllen, Trends und Saisonindex |
| `src/lib/market/wikimedia.ts` | Adressen und strenge Antwortprüfung (ohne Netzwerk) |
| `src/lib/market/sources.ts` | Quellen-Schnittstelle, Abrufbudget, Wikimedia- und Demo-Quelle, Titel-Filter |
| `src/lib/market/risk.ts` | Risikoregeln je Warengruppe |
| `src/lib/market/score.ts` | Opportunity Score mit Unsicherheit |
| `src/lib/market/profit.ts` | Profit Check mit Steuerstatus (nutzt `calc/pricing.ts`) |
| `src/lib/market/pipeline.ts` | Kandidat bewerten, Lauf steuern, Zustände |
| `src/lib/market/state.ts` | Stand zusammenführen ohne Dubletten |
| `src/lib/market/server/wikimedia-client.ts` | **einziger** Netzwerkzugang (serverseitig) |
| `src/lib/market/server/market-store.ts` | Speicher `.data/market/` und Abbruchschalter-Datei |
| `scripts/market-scan.ts` | Befehl `npm run market:scan` |
| `src/components/market/market-scout-panel.tsx` | Anzeige im Dashboard (ohne Aktionen) |

## Was noch fehlt, bevor Produkte wirklich automatisch in den Shop kommen

1. **Produktidentität für neue Themen:** Wikipedia liefert Themen, keine GTINs. Ohne GTIN und echte Preislisten
   bleibt jeder neue Kandidat beim Supplier Scout zurückgestellt.
2. **Marktpreisquelle:** Ohne belegten Verkaufspreis ist keine Marge verlässlich.
3. **Steuerstatus bestätigen** (`TAX_SETTINGS.confirmed`).
4. **Shop-Texte und Bilder mit nachgewiesenen Nutzungsrechten** für neue Produkte – heute gibt es Entwürfe nur
   für die Demo-Produkte mit eigenen Illustrationen.
5. **Compliance-Freigabe** je Produkt durch einen Menschen.
6. **Zeitplan** für den unbeaufsichtigten Lauf einrichten (nur lesend, ohne Shopify-Schreibzugriff).
