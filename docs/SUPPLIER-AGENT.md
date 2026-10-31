# Supplier Scout Agent

Der Supplier Scout findet und vergleicht Lieferanten für ein Produkt und empfiehlt den
**günstigsten geeigneten**, den **schnellsten geeigneten** und den **insgesamt besten** Lieferanten –
jeweils mit nachvollziehbarer Begründung.

Er ist reine Analyse: Er bestellt nichts, bezahlt nichts, legt keine Lieferantenkonten an und
veröffentlicht nichts in Shopify. Einkäufe laufen später ausschließlich über die Einkaufssperre
(`src/lib/guards/purchase.ts`) und nach menschlicher Freigabe.

> **Stand:** Kernlogik mit fiktiven Demo-Lieferanten. Es ist noch keine echte Lieferantenquelle angebunden.

## Geschäftsmodell, auf das die Regeln zugeschnitten sind

- Kein eigenes Lager, keine Vorratseinkäufe – jede Lieferantenbestellung entspricht einer Kundenbestellung.
- Der Kunde zahlt im Shopify-Shop; die Auszahlung an uns kommt erst nach ca. 7 Tagen (`ASSUMPTIONS.payoutDelayDays`).
- Der Lieferant versendet direkt an den Kunden (Dropshipping).
- Vorfinanzierung soll vermieden werden → bevorzugt werden Lieferanten mit **bestätigtem** Zahlungsziel ≥ Auszahlungsdauer.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `src/lib/suppliers/model.ts` | Einheitliches Datenmodell (`SupplierQuote`, `ProductQuery`, `Fact<T>`) |
| `src/lib/suppliers/adapter.ts` | Adapter-Schnittstelle (`SupplierAdapter`) und Sperrlogik für kostenpflichtige/Netzwerk-Adapter |
| `src/lib/suppliers/rules.ts` | Grenzwerte und Gewichte (`SCOUT_RULES`, übernimmt `SUPPLIER_RULES`) |
| `src/lib/suppliers/eligibility.ts` | Eignungsprüfung: Ausschlüsse und offene Punkte, Gesamtkosten |
| `src/lib/suppliers/financing.ts` | Vorfinanzierung vs. bestätigtes Zahlungsziel |
| `src/lib/suppliers/scoring.ts` | Deterministische Punktbewertung |
| `src/lib/suppliers/compare.ts` | Vergleich, drei Empfehlungen, Begründungstexte |
| `src/lib/suppliers/scout.ts` | Ablauf über mehrere Adapter (`scoutSuppliers`) |
| `src/lib/suppliers/purchase-bridge.ts` | Konservative Übergabe des Zahlungsziels an die Einkaufssperre |
| `src/lib/suppliers/quote-builder.ts` | Baukasten für Demo-Daten und Tests |
| `src/lib/suppliers/demo/demo-suppliers.ts` | Fiktive Demo-Lieferanten für alle 5 Produkte in zwei Demo-Adaptern (Kernzahlen aus `src/lib/demo/suppliers.ts`) |
| `src/lib/suppliers/index.ts` | Öffentliche Schnittstelle |
| `src/lib/suppliers/*.test.ts` | Automatisierte Tests |

## Ablauf

```
ProductQuery ──► scoutSuppliers(query, adapters)
                   │  1. Adapter sortiert nach ID; kostenpflichtige / Netzwerk-Adapter werden gesperrt
                   │  2. findQuotes() je Adapter, Fehler werden abgefangen und protokolliert
                   ▼
                 compareQuotes(query, quotes)
                   │  3. checkEligibility  → geeignet oder ausgeschlossen (mit Gründen)
                   │  4. assessFinancing   → Vorfinanzierung ja/nein
                   │  5. scoreQuote        → Punkte für geeignete Angebote
                   ▼
                 ScoutReport: eligible, excluded, recommendations {cheapest, fastest, best}, notes, adapters
```

```ts
import { scoutSuppliers, DEMO_ADAPTERS, DEMO_QUERIES } from "@/lib/suppliers";

const report = await scoutSuppliers(DEMO_QUERIES["p-led"], DEMO_ADAPTERS);
const best = report.recommendations.best;
best?.supplierName;          // "Lumio Großhandel (Demo)"
best?.approval;              // immer "none" – eine Empfehlung ist nie eine Einkaufsfreigabe
best?.requiresPrefinancing;  // false (bestätigtes Zahlungsziel 14 Tage)
best?.openPoints;            // offene Punkte als { code, message }[]
best?.reasons;               // Begründung, ein Satz je Eintrag
```

### Felder einer Empfehlung (`Recommendation`)

| Feld | Bedeutung |
| --- | --- |
| `kind` | `cheapest`, `fastest` oder `best` |
| `quoteId`, `supplierName` | Welches Angebot empfohlen wird |
| `approval` | Immer `"none"`. Eine Empfehlung gibt nichts frei; Einkäufe laufen nur über die Einkaufssperre. |
| `demo` | Angebot stammt aus fiktiven Demo-Daten |
| `requiresPrefinancing`, `financingStatus` | Ergebnis der Finanzierungsprüfung (siehe unten) |
| `openPoints` | Offene Punkte (fehlende oder unbestätigte Angaben) als `{ code, message }` |
| `perUnit`, `deliveryDays`, `score` | Gesamtkosten je Stück, Lieferzeit, Gesamtbewertung 0–100 |
| `reasons` | Begründung als Sätze für Menschen |

Die Oberfläche soll Abzeichen aus den strukturierten Feldern bauen, nicht aus den Begründungstexten.

## Fehlende und unbestätigte Angaben

Jede geschäftsrelevante Angabe ist ein `Fact<T>`:

| Status | Bedeutung | Beispiel |
| --- | --- | --- |
| `confirmed` | Geprüfte Quelle, mit `source` und `checkedAt` | Preis aus Lieferanten-API, CE-Erklärung liegt vor |
| `unconfirmed` | Selbstauskunft, Schätzung, Marktplatz-Angabe | „Zahlungsziel 30 Tage" laut Verkäuferprofil |
| `missing` | Keine Angabe | Pünktlichkeitsquote unbekannt |

Fehlende Angaben werden nie stillschweigend durch günstige Annahmen ersetzt. Einzige Ausnahme:
fehlende Importkosten gelten bei Versand **aus der EU** als 0 €.

## Eignungsprüfung (harte Ausschlüsse)

Ein Angebot wird ausgeschlossen – und nie empfohlen –, wenn einer dieser Punkte zutrifft:

| Code | Regel |
| --- | --- |
| `identity_mismatch` | GTIN weicht vom gesuchten Produkt ab, oder Lieferant führt bestätigt ein anderes Produkt |
| `identity_unconfirmed` | Weder bestätigte GTIN noch bestätigter exakter Abgleich (z. B. nur „ähnliche Variante") |
| `safety_issue` | Bekanntes Sicherheitsproblem (Rückruf, Behördenwarnung) |
| `safety_unclear` | CE-Kennzeichnung (falls nötig), verantwortliche Person in der EU (GPSR) oder deutsche Sicherheitshinweise nicht bestätigt |
| `dropshipping_unavailable` | Direktversand an Endkunden nicht bestätigt |
| `not_deliverable` | Keine Lieferung nach DE, Bestand unbekannt oder kleiner als die Bestellmenge, Lieferzeit unbekannt |
| `insufficient_stock` | Bestand unter `minStock` (50) |
| `delivery_too_slow` | Höchstlieferzeit über `maxDeliveryDays` (12) |
| `stock_purchase_required` | Mindestabnahme größer als die Bestellmenge → wäre ein Vorratskauf |
| `cost_unknown` | Einkaufspreis, Versandkosten oder (außerhalb der EU) Importkosten fehlen |
| `rating_too_low` | Bewertung unter `minRating` (4,2) – auch wenn nur unbestätigt |

**Offene Punkte (Hinweise)** schließen nicht aus, stehen aber in der Begründung unter „Vor Freigabe klären":
unbestätigte Preise/Bestände/Lieferzeiten, neutraler Versand oder Sendungsverfolgung ungeklärt,
Bestellweg unbekannt, Mindestabnahme unbekannt, fehlende Zuverlässigkeitsdaten, kein geprüftes Muster,
unbestätigtes Zahlungsziel, unklar ob das Zahlungsziel eine Gewerbe-/USt-Prüfung voraussetzt.

## Finanzierung

| Status | Vorfinanzierung | Wann |
| --- | --- | --- |
| `payment_terms_confirmed` | nein | Bestätigtes Zahlungsziel ≥ 7 Tage (Auszahlungsdauer) **und** bestätigt, dass keine Gewerbe-/USt-Prüfung nötig ist |
| `payment_terms_too_short` | ja (teilweise) | Bestätigtes Zahlungsziel < 7 Tage |
| `payment_terms_unconfirmed` | ja | Zahlungsziel nur behauptet – gilt bis zur Bestätigung als Vorkasse |
| `payment_terms_pending_verification` | ja | Zahlungsziel gilt erst nach Gewerbe-/USt-Prüfung (auch wenn das nur behauptet ist) |
| `payment_terms_conditions_unclear` | ja | Nicht bestätigt, ob eine Gewerbe-/USt-Prüfung nötig ist (fehlt oder nur behauptet „nein") |
| `prepayment_required` | ja | Vorkasse |
| `unknown` | ja | Keine Angabe oder ungültige Tage (nur ganze Zahlen ≥ 0; kein NaN, Unendlich, Text, Bruch) |

Sind alle geeigneten Angebote vorfinanzierungspflichtig, steht im Bericht der Hinweis, vor einem Einkauf
ein Zahlungsziel zu verhandeln.

### Übergabe an die Einkaufssperre

Die Einkaufssperre (`evaluateAutoPurchase`) kennt nur die festen Stufen `vorkasse`, `netto14` und `netto30`.
Sie weiß nichts über Produktsicherheit, Identität oder Demo-Daten. `toPurchaseGuardTerms(evaluateQuote(quote, query))`
bekommt deshalb das ganze Prüfergebnis eines Angebots und rechnet konservativ um:

| Scout | An die Einkaufssperre |
| --- | --- |
| Demo-Angebot (`quote.demo`) | `vorkasse` |
| Ausgeschlossenes Angebot (z. B. CE/GPSR unklar, Identität unbestätigt, Vorratskauf) | `vorkasse` |
| Bestätigt und sofort nutzbar, 30 Tage oder mehr | `netto30` |
| Bestätigt und sofort nutzbar, 14–29 Tage | `netto14` |
| Bestätigt, unter 14 Tage | `vorkasse` (abgerundet) |
| Vorkasse, unbestätigt, fehlend, ungültig, Gewerbeprüfung ausstehend oder unklar | `vorkasse` |

Damit können unbekannte Compliance-Angaben, Demo-Daten und unbestätigte oder an Bedingungen geknüpfte
Zahlungsziele die Finanzierungsprüfung der Einkaufssperre nie erfüllen. Eine Empfehlung des Scouts ist nie
eine Einkaufsfreigabe: Der Scout ruft die Einkaufssperre nicht auf (per Test abgesichert), und die Sperre
bleibt über `SAFETY_SWITCHES.autoPurchaseEnabled` global aus.

## Bewertung

Nur geeignete Angebote werden bewertet. Alle Teilwerte liegen zwischen 0 und 100:

| Teilwert | Gewicht | Berechnung |
| --- | --- | --- |
| Kosten | 40 % | `100 × günstigste Gesamtkosten / eigene Gesamtkosten` (Einkauf + Versand + Import je Stück) |
| Tempo | 25 % | Linear nach Höchstlieferzeit: ≤ 2 Tage = 100, 12 Tage = 0 |
| Zuverlässigkeit | 25 % | 40 % Bewertung (1→0, 5→100), 35 % Pünktlichkeit, 25 % Reklamationsquote (0 % → 100, ≥ 10 % → 0) |
| Finanzierung | 10 % | 100 = bestätigtes Zahlungsziel ≥ Auszahlung, 50 = bestätigt aber kürzer, 0 = Vorkasse/unklar |

- Fehlende Zuverlässigkeitswerte zählen 0 Punkte, unbestätigte nur zu 80 %.
- Je unbestätigter Angabe (Preis, Versand, Import, Lieferzeit, Bestand, Bewertung, Pünktlichkeit,
  Reklamationsquote, Zahlungsziel) werden 2 Punkte abgezogen, höchstens 10.
- Gewichte und Grenzen stehen in `SCOUT_RULES` und können je Aufruf überschrieben werden.

### Empfehlungen und Gleichstände

| Empfehlung | Sortierung (bei Gleichstand jeweils nächstes Kriterium) |
| --- | --- |
| Günstigster | Gesamtkosten ↑, Höchstlieferzeit ↑, Angebots-ID |
| Schnellster | Höchstlieferzeit ↑, Mindestlieferzeit ↑, Gesamtkosten ↑, Angebots-ID |
| Insgesamt bester | Gesamtpunkte ↓, Gesamtkosten ↑, Höchstlieferzeit ↑, Angebots-ID |

Gleiche Eingabe ergibt immer dieselbe Empfehlung – unabhängig von der Reihenfolge der Angebote und Adapter.

### Beispiel (Demo-Daten, LED-Lichtleiste)

| Lieferant | Gesamtkosten | Lieferzeit | Zahlung | Punkte | Ergebnis |
| --- | --- | --- | --- | --- | --- |
| Lumio Großhandel (Demo), DE | 13,80 € | 2–3 Tage | 14 Tage Ziel | 89,7 | **insgesamt bester** und **schnellster** |
| EuroLight Fulfillment (Demo), PL | 11,60 € | 4–7 Tage | Vorkasse | 74,8 | **günstigster** (Vorfinanzierung nötig) |
| Brightline Demo Co., CN | 11,20 € | 9–16 Tage | – | – | ausgeschlossen: Lieferzeit über 12 Tage |
| Shinelight Wholesale (Demo) | 8,20 € | – | – | – | ausgeschlossen: nur ähnliche Variante |
| Voltmarkt Restposten (Demo) | 10,40 € | – | – | – | ausgeschlossen: CE fehlt, Sicherheitshinweise unbestätigt |
| Bulkware Demo Trading | – | – | – | – | ausgeschlossen: Mindestabnahme 100 (Vorratskauf) |

Beispielbegründung für „insgesamt bester":

> Höchste Gesamtbewertung: 89,7 von 100 (Kosten 84,1, Tempo 90, Zuverlässigkeit 94,4, Finanzierung 100).
> Gewichtung: Kosten 40 %, Tempo 25 %, Zuverlässigkeit 25 %, Finanzierung 10 %.
> 14,9 Punkte vor EuroLight Fulfillment (Demo) (74,8).
> 2,20 € teurer als das günstigste Angebot (EuroLight Fulfillment (Demo)), dafür insgesamt besser.
> Zugleich das schnellste geeignete Angebot.
> Bestätigtes Zahlungsziel 14 Tage – keine Vorfinanzierung.

### Demo-Daten

`src/lib/suppliers/demo/demo-suppliers.ts` deckt alle fünf Dashboard-Produkte ab. Preis, Versand, Import,
Lieferzeit, Bewertung, Bestand und Zahlungsbedingungen werden **1:1 aus `src/lib/demo/suppliers.ts`** übernommen –
Dashboard und Scout zeigen also dieselben Zahlen (per Test abgesichert). Ergänzt werden nur Angaben, die das alte
Modell nicht kennt: Produktidentität (fiktive GTINs mit Präfix 200), Produktsicherheit, Dropshipping,
Pünktlichkeit, Reklamationsquote, Musterprüfung und Gewerbeprüfung. Ob CE Pflicht ist, kommt aus den
Compliance-Hinweisen des Produkts. Fünf zusätzliche Angebote gibt es nur im Scout; sie zeigen Ausschlussgründe
(Identität, CE, Vorratskauf, Behördenwarnung, kein Bestand).

## Schnittstelle für echte Lieferanten

### Adapter implementieren

```ts
export interface SupplierAdapter {
  readonly info: {
    id: string;              // stabil, z. B. "acme-api"
    name: string;
    kind: "demo" | "manual" | "feed" | "api";
    paid: boolean;           // verursacht der Abruf Kosten? → nur mit SAFETY_SWITCHES.paidApiCallsEnabled
    network: boolean;        // braucht Netzwerk? → nur mit policy.networkAllowed
  };
  findQuotes(query: ProductQuery): Promise<SupplierQuote[]>;
}
```

Regeln für echte Adapter:

1. **Nur lesen.** Ein Adapter hat keine Methoden zum Bestellen, Bezahlen oder Konto-Anlegen. Bestellungen
   werden später ein eigener, gesperrter Baustein hinter `evaluateAutoPurchase`.
2. **Ehrliche Status.** Was der Lieferant nur behauptet, ist `unconfirmed`. `confirmed` nur mit Quelle und
   Prüfzeitpunkt (z. B. API-Antwort, vorliegendes Dokument, eigener Testkauf).
3. **Netzwerk nur serverseitig** in einer Datei mit `import "server-only";`. Jede neue Netzwerkstelle muss im
   Sicherheitstest (`src/lib/guards/safety.test.ts`, `NETWORK_ALLOWED`) bewusst eingetragen werden; Zugangsdaten
   nur über eine Konfigurationsdatei, die dort in `ENV_ALLOWED` steht.
4. **Kostenpflichtige Quellen** setzen `paid: true` – der Scout fragt sie nicht ab, solange
   `SAFETY_SWITCHES.paidApiCallsEnabled` aus ist. Eine beim Aufruf übergebene `policy` kann nur zusätzlich
   einschränken und diesen Schalter nie aushebeln.
5. **Beträge netto in EUR je Stück**, Versand bis zum Endkunden in DE. Fremdwährungen rechnet der Adapter um und
   markiert den Preis dann als `unconfirmed`, falls der Kurs nicht fest vereinbart ist.
6. **Fehler werfen ist erlaubt** – der Scout fängt sie ab, protokolliert sie im Bericht und wertet die übrigen Quellen aus.

### Daten, die wir von echten Lieferanten brauchen

| Bereich | Feld | Wofür | Ohne bestätigten Wert |
| --- | --- | --- | --- |
| Identität | GTIN/EAN, Hersteller-Teilenummer (MPN), Marke, Artikelnummer | Gleiches Produkt sicherstellen | Ausschluss |
| Sicherheit | CE-Konformitätserklärung (falls nötig), verantwortliche Person in der EU (GPSR), deutsche Sicherheits-/Gebrauchshinweise, Rückrufe | Rechtssicherer Verkauf | Ausschluss |
| Preis | Einkaufspreis netto, Staffelpreise, Mindestabnahme | Gesamtkosten, kein Vorratskauf | Ausschluss / Hinweis |
| Versand | Versandkosten nach DE je Stück, Versandland, Lieferzeit min/max, Sendungsverfolgung | Gesamtkosten, Tempo | Ausschluss / Hinweis |
| Import | Zoll, Einfuhrumsatzsteuer, Abwicklungsgebühren (bei Versand von außerhalb der EU), Incoterm (idealerweise DDP) | Gesamtkosten | Ausschluss |
| Bestand | Verfügbare Menge beim Lieferanten, Zeitpunkt | Lieferfähigkeit | Ausschluss |
| Dropshipping | Direktversand an Endkunden, neutraler Versand, Bestellweg (API/Portal/E-Mail), Retourenabwicklung | Geschäftsmodell | Ausschluss / Hinweis |
| Zahlung | Zahlungsarten (`methods`), Zahlungsziel in Tagen (schriftlich bestätigt), Kreditrahmen, Voraussetzungen (Gewerbe-/USt-Prüfung) | Vorfinanzierung vermeiden | Gilt als Vorfinanzierung |
| Zuverlässigkeit | Bewertung, Pünktlichkeitsquote, Reklamationsquote (idealerweise aus eigenen Bestellungen), geprüftes Muster | Zuverlässigkeitswert | 0 Punkte, Hinweis |
| Unterlagen | Konformitätserklärung, Prüfberichte (`safety.documents`) | Compliance-Prüfung vor Freigabe | Information |

Für Quellen ohne GTIN-Suche (z. B. Marktplätze) kann `ProductQuery` zusätzlich `keywords` und `category`
enthalten. Ein Treffer über Suchbegriffe ersetzt nie die Identitätsprüfung.

## Integration in das Dashboard (in Arbeit)

Die bestehende Seite `/lieferanten` nutzt `evaluateOffers` aus `src/lib/calc/suppliers.ts` mit dem älteren,
flachen Typ `SupplierOffer`.

Erledigt:

- Strukturierte Empfehlungsfelder (`approval`, `demo`, `requiresPrefinancing`, `openPoints` …).
- Einheitliche Demo-Daten für alle fünf Produkte.
- **Datenzugriff:** `getSupplierScoutReports()` in `src/lib/data.ts` liefert je Demo-Produkt
  `{ product, report, margins }`. `report` ist der `ScoutReport` (oder `null`, wenn für ein Produkt keine
  Lieferantensuche definiert ist), `margins` der Deckungsbeitrag je **geeignetem** Angebot, gerechnet mit dem
  Zielpreis. Die Funktion ist asynchron, ruft die Einkaufssperre nie auf und übergibt ihr nichts. Ein Test stellt
  sicher, dass Seiten und Komponenten weder `evaluateAutoPurchase` noch `toPurchaseGuardTerms` importieren und
  dass der günstigste geeignete Lieferant mit der bisherigen Produktanalyse übereinstimmt.

Offen, jeweils nach Absprache:

1. **Anzeige:** Die Seite `/lieferanten` wird zur `async` Server Component und ruft `getSupplierScoutReports()` auf.
   Eine neue Komponente `src/components/suppliers/scout-recommendations.tsx` zeigt je Produkt drei Karten
   (Günstigster / Schnellster / Insgesamt bester) mit den `reasons`, ein Abzeichen „Vorfinanzierung nötig" bzw.
   „Zahlungsziel bestätigt" und eine aufklappbare Liste der ausgeschlossenen Angebote mit Gründen. Bestehendes
   `DemoBadge` für `report.containsDemoData`.
2. **Freigabe-Fluss:** Die Empfehlung „insgesamt bester" als `ApprovalRequest` vom Typ `supplier_change` in die
   Freigabeliste übernehmen. Eine Freigabe setzt nur den „freigegebenen Lieferanten" je Produkt – Einkäufe bleiben
   über `SAFETY_SWITCHES.autoPurchaseEnabled` gesperrt.

Später kann der Agent-Eintrag „Lieferanten-Scout" in `src/lib/demo/agents.ts` die Anzahl geprüfter und
ausgeschlossener Angebote aus dem Bericht anzeigen.

## Sicherheit

- Keine Netzwerkaufrufe, keine Zugangsdaten, keine Bestell- oder Zahlungsfunktionen im Modul – per Test abgesichert.
- Kostenpflichtige und Netzwerk-Adapter werden standardmäßig gesperrt (`DEFAULT_ADAPTER_POLICY`).
- Angebote aus Demo-Adaptern werden immer als `demo: true` markiert; jede Begründung enthält dann
  „Demo-Daten – keine echte Einkaufsgrundlage".
- Bestehende Sicherheitsschalter und Einkaufssperren werden nur gelesen, nie verändert.
