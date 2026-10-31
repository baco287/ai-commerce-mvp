# Lieferanten-Preislisten importieren (CSV)

Der Preislisten-Import bringt echte Großhändler-Angebote in den Supplier Scout – ohne die Sicherheitsregeln zu
lockern. Er ist ein weiterer Adapter der bestehenden `SupplierAdapter`-Schnittstelle (`kind: "manual"`,
`paid: false`, `network: false`), keine zweite Lieferantenarchitektur.

**Grundsätze**

- **Nur lokal.** Kein Netzwerk, keine kostenpflichtigen Dienste, kein Shopify-Zugriff, keine Bestellungen.
  Ein Import ändert ausschließlich den lokalen Angebotsspeicher – und nur nach ausdrücklicher Bestätigung.
- **Nichts wird erfunden.** Fehlende Angaben bleiben „fehlend“; Mehrdeutiges (z. B. `12,500`) wird abgelehnt statt geraten.
- **Eine Preisliste bestätigt nichts.** Jede CSV-Angabe gilt als „vom Lieferanten angegeben“. CE, GPSR,
  Sicherheitshinweise, Lieferfähigkeit und verbindliche Zahlungsbedingungen werden erst durch einen unabhängigen,
  produktspezifischen Nachweis „geprüft“.
- **Kein Datenverlust.** Ein Import löscht nie: Geänderte Angebote behalten ihre frühere Fassung in der Historie,
  Angebote, die in einer neuen Liste fehlen (oder dort abgelehnt werden), bleiben gespeichert, gelten aber als
  „nicht mehr aktuell“ und werden im Scout ausgeschlossen. Vor jedem Schreiben wird der vorige Stand gesichert.
- **Echte Daten bleiben privat.** Speicher und Nachweise liegen in `.data/suppliers/` (von Git ignoriert) – das
  Repository ist öffentlich.

## Ablauf

```bash
# 1. Testlauf – prüft alles, zeigt Fehler, Dubletten, Änderungen und einen Bestätigungscode. Schreibt nichts.
npm run suppliers:import -- pfad/zur/preisliste.csv

# 2. Übernehmen – nur mit dem Code aus dem Testlauf
npm run suppliers:import -- pfad/zur/preisliste.csv --apply --confirm <CODE>

# Stand anzeigen und Nachweisdatei prüfen
npm run suppliers:import -- --status
```

Optionen:

| Option | Bedeutung |
| --- | --- |
| `--mapping zuordnung.json` | Eigene Spaltenzuordnung und feste Angaben (siehe unten) |
| `--synthetisch` | Datei als Testdaten markieren (automatisch bei `.synthetisch.` im Dateinamen) |
| `--apply --confirm <CODE>` | Übernehmen; ohne passenden Code bricht der Befehl ab |

Der **Bestätigungscode** ist an den genauen Dateiinhalt, die Zuordnung, die Testdaten-Markierung und den aktuellen
Speicherstand gebunden. Ändert sich eines davon nach dem Testlauf, passt der Code nicht mehr – erneut prüfen.

Nach der Übernahme zeigt `/lieferanten` (und die Produktanalyse) die Angebote im Entwicklungsserver (`npm run dev`)
beim nächsten Neuladen. Im Produktions-Build werden die Seiten vorab erzeugt – dort erst nach erneutem `npm run build`.

Übernommen wird nur, wenn die Datei strukturell in Ordnung ist (alle Pflichtspalten, lesbares CSV). Abgelehnte
Zeilen werden nicht übernommen, die gültigen schon; der Testlauf zeigt jede abgelehnte Zeile mit Grund.

## Sicherung und Wiederherstellung

Vor jeder Übernahme wird der bisherige Stand nach `.data/suppliers/backups/offers-<Import-ID>.json` kopiert; der
neue Stand wird atomar geschrieben (temporäre Datei, dann Umbenennen). Zusätzlich behält jedes geänderte Angebot
seine früheren Fassungen in `history`.

Einen Import rückgängig machen (lokal, von Hand):

1. Mit `npm run suppliers:import -- --status` den betroffenen Import bestimmen.
2. Die Sicherung **dieses** Imports (`backups/offers-<Import-ID>.json`) über `.data/suppliers/offers.json` kopieren –
   sie enthält den Stand unmittelbar davor. **Achtung:** Alle späteren Importe gehen dabei ebenfalls verloren – vorher
   die aktuelle `offers.json` zusätzlich kopieren.
3. `npm run suppliers:import -- --status` erneut ausführen und prüfen.

Nicht gleichzeitig zwei Importe ausführen: Der Bestätigungscode erkennt einen zwischenzeitlich geänderten Speicher
nur beim Start des Befehls.

## Unterstützte CSV-Formate

- Trennzeichen `;`, `,` oder Tabulator (automatisch erkannt), Anführungszeichen nach RFC 4180, UTF-8 mit oder ohne BOM,
  Zeilenenden LF oder CRLF. Leere Zeilen werden übersprungen.
- Fehlerhafte Anführungszeichen (Text nach dem schließenden Zeichen wie `"1"7`, einzelnes `"` mitten im Feld) sind ein
  Strukturfehler – die Datei wird nicht übernommen, statt Werte still zusammenzusetzen.
- Beträge: Währung nur vor oder nach der Zahl (`12,50 €`, `EUR 12,50`); `12€50` wird abgelehnt.
- Erste Zeile = Spaltenköpfe. Groß-/Kleinschreibung, Umlaute (`ä` = `ae`), Satzzeichen und Leerzeichen sind egal.
- Jede Zeile muss genau so viele Spalten haben wie die Kopfzeile.
- Kodierung **UTF-8**. Excel: „Speichern unter → CSV UTF-8 (durch Trennzeichen getrennt)“. Dateien in anderer
  Kodierung (z. B. Windows-1252) werden abgelehnt, statt Umlaute zu verfälschen.
- Einheiten in Spaltenköpfen zählen: „EK netto (EUR)“, „Lieferzeit (Tage)“ oder „Bestand (Stk.)“ werden erkannt;
  „Lieferzeit (Wochen)“, „Einkaufspreis (brutto)“, „MOQ (Kartons)“ oder „MOQ (EUR)“ werden **nicht** still umgedeutet, sondern
  ignoriert und im Testlauf gemeldet – bei Bedarf umrechnen oder per Zuordnungsdatei zuordnen.

### Spalten

| Feld | Pflicht | Erkannte Spaltenköpfe (Auswahl) | Format |
| --- | --- | --- | --- |
| Lieferantenname | ja¹ | Lieferant, Lieferantenname, Supplier, Vendor | Text |
| Lieferantenartikelnummer | ja | Artikelnummer, Art Nr, Bestellnummer, SKU, Item Number | Text |
| GTIN/EAN | – | GTIN, EAN, EAN13, Barcode, UPC | 8/12/13/14 Ziffern mit gültiger Prüfziffer |
| Marke | – | Marke, Brand | Text |
| Herstellerartikelnummer | – | Herstellerartikelnummer, MPN | Text |
| Variantenkennung | – | Variante, Variant, Variantenkennung | Text (höchstens 60 Zeichen), z. B. `Schwarz / 2 m` – Zuordnung zu Katalogvarianten ohne GTIN und MPN |
| Artikelbezeichnung | ja | Bezeichnung, Artikel, Produktname, Title, Name | Text |
| Einkaufspreis netto | ja | EK netto, Einkaufspreis, Preis netto, Net Price, Unit Price | `12,50` · `12.50` · `1.234,50` · `1,234.50` |
| Währung | ja¹ | Währung, Currency | nur `EUR` |
| Versandkosten nach Deutschland | – | Versandkosten DE, Versand DE, Shipping Cost DE | Betrag je Stück |
| Mindestbestellmenge | – | Mindestbestellmenge, MOQ | ganze Zahl ≥ 1 |
| Mindestbestellwert | – | Mindestbestellwert, MOV | Betrag |
| Lagerbestand | – | Lagerbestand, Bestand, Verfügbar, Stock | ganze Zahl ≥ 0 (`1.200` erlaubt) |
| Versandland | – | Versandland, Lagerland, Ship From | ISO-Code (`DE`, `PL`, `CN`) oder Name |
| Lieferzeit | – | Lieferzeit, Delivery Days, Lead Time · oder getrennt: Lieferzeit min/max | `3-5`, `3 bis 5 Werktage`, `4` |
| Dropshipping | – | Dropshipping, Direktversand | ja/nein, yes/no, 1/0, x |
| Neutraler Versand | – | Neutraler Versand, Blind Shipping | ja/nein |
| Zahlungsbedingungen | – | Zahlungsbedingungen, Zahlungsziel, Payment Terms | nur eindeutig: `Vorkasse`, `Rechnung 30 Tage`, `netto 14`, `net 30` – mit Zusätzen (Skonto, „oder“, Bedingungen) abgelehnt |
| Aktualisierungsdatum | – | Stand, Aktualisiert, Last Updated | `2026-10-31` oder `31.10.2026` |
| Datenquelle | – | Quelle, Datenquelle, Source | Text, z. B. „Händlerportal, Export vom …“ |

¹ kann statt als Spalte auch als feste Angabe in der Zuordnungsdatei stehen.
Unbekannte Spalten werden ignoriert und im Testlauf aufgelistet.

### Abweichende Spaltenköpfe: Zuordnungsdatei

```json
{
  "columns": { "Art.-Nr. Lief.": "supplierSku", "Preis Händler": "unitPrice", "Fracht DE": "shippingCostDe" },
  "defaults": { "supplierName": "Großhandel Beispiel GmbH", "currency": "EUR", "dataSource": "Preisliste per E-Mail vom 30.10.2026" }
}
```

Feldnamen: `supplierName`, `supplierSku`, `gtin`, `brand`, `mpn`, `title`, `unitPrice`, `currency`,
`shippingCostDe`, `minOrderQuantity`, `minOrderValue`, `stock`, `shipsFrom`, `deliveryDays`, `deliveryDaysMin`,
`deliveryDaysMax`, `dropshipping`, `blindShipping`, `paymentTerms`, `supplierUpdatedAt`, `dataSource`.
Beispiel: `src/lib/suppliers/import/fixtures/zuordnung-abweichend.json`.

### Prüfungen

| Fall | Ergebnis |
| --- | --- |
| Pflichtspalte fehlt, zwei Spalten meinen dasselbe Feld, CSV nicht lesbar | Datei wird nicht übernommen |
| Betrag nicht lesbar oder mehrdeutig (`abc`, `12,500`, `1.2.3,4`), Preis ≤ 0 | Zeile abgelehnt |
| Andere Währung als EUR | Zeile abgelehnt (keine Umrechnung mit geratenem Kurs) |
| GTIN mit falscher Prüfziffer, unbekanntes Land, ungültiges Datum, `Rechnung` ohne Tage | Zeile abgelehnt |
| Mehrdeutige Zahlungsbedingungen (`Vorkasse 14 Tage`, `2 % Skonto 10 Tage, 30 Tage netto`, `… nach Freigabe`) | Zeile abgelehnt – Bedingungen gesondert klären |
| Datei nicht UTF-8 | Datei wird nicht übernommen |
| Gleiche Lieferant + Artikelnummer mehrfach, identisch | einmal übernommen, Dublette gemeldet |
| Gleiche Lieferant + Artikelnummer mehrfach, widersprüchlich | alle betroffenen Zeilen abgelehnt |
| GTIN unbekannt oder fehlt | gespeichert; echte Zeilen nur über den Zielproduktkatalog zuordenbar, synthetische nur über Demo-GTINs |
| Optionale Angabe fehlt | Hinweis „bleibt fehlend“ |
| Preisliste älter als 90 Tage oder Datum in der Zukunft | Hinweis |

Ein Angebot ist eindeutig über **Lieferant + Lieferantenartikelnummer**. Die Lieferanten-Kennung entsteht aus dem
Namen (Umlaute und Akzente umgeschrieben); lässt sich ein Name nicht eindeutig umschreiben (z. B. chinesische Schrift),
wird eine kurze Prüfsumme angehängt – verschiedene Lieferanten teilen sich nie eine Kennung. Ein erneuter Import
derselben Datei legt keine Dubletten an; geänderte Werte werden je Feld angezeigt (alt → neu), ebenso eine geänderte
Testdaten-Markierung.

## Herkunft und Nachweisstufen

Jedes Angebot speichert seine Herkunft: Datei, SHA-256 des Inhalts, Zeile, Import-ID und -zeitpunkt, Stand laut
Lieferant, Datenquelle und Testdaten-Markierung. Auf `/lieferanten` steht sie unter jedem importierten Angebot.

Jede Angabe hat eine von vier Stufen:

| Stufe | Bedeutung | Woher |
| --- | --- | --- |
| **geprüft** | durch unabhängigen Nachweis belegt | Eintrag in der Nachweisdatei |
| **vom Lieferanten angegeben** | Selbstauskunft, nicht geprüft | jede Preislisten-Angabe |
| **unbestätigt** | Schätzung oder unklare Herkunft | z. B. eigene Annahmen |
| **fehlt** | keine Angabe | – |

CE-Kennzeichnung, verantwortliche Person in der EU (GPSR), deutsche Sicherheitshinweise, Bestellweg,
Sendungsverfolgung und Zuverlässigkeit kann eine Preisliste **nicht** liefern – sie bleiben „fehlt“, bis ein
Nachweis vorliegt.

### Nachweisdatei `.data/suppliers/evidence.json`

```json
{
  "entries": [
    {
      "offerKey": "grosshandel-beispiel-gmbh::GB-4711",
      "productGtin": "4012345678901",
      "field": "safety.ceMarking",
      "value": true,
      "document": "EU-Konformitätserklärung Nr. 2026-117 vom 01.10.2026",
      "checkedBy": "Name der prüfenden Person",
      "checkedAt": "2026-10-31",
      "note": "Gegen Produktfoto und Typenschild abgeglichen"
    }
  ]
}
```

- `offerKey` steht im Testlauf und in `--status`; `productGtin` ist die GTIN des Produkts, für das der Nachweis gilt.
  Für Varianten des Zielproduktkatalogs **ohne GTIN** steht statt `productGtin` der Varianten-Schlüssel
  `productKey` (`"cat:<Katalog-ID>:<shopSku>"`). Genau eines der beiden Felder ist Pflicht; ein `productKey`-Nachweis gilt
  nur für eine Abfrage ohne GTIN.
- **Produktspezifisch:** Ein Nachweis gilt nur für genau dieses Angebot **und** genau dieses Produkt. Eine
  CE-Erklärung für Produkt A macht Produkt B nie „geprüft“.
- Nachweisbare Felder: `identity.match`, `identity.gtin`, `identity.brand` (Text, höchstens 80 Zeichen),
  `safety.ceMarking`, `safety.euResponsiblePerson`, `safety.safetyInformationDe`, `safety.document`,
  `pricing.unitPrice`, `pricing.shippingCost`, `pricing.minOrderValue`, `pricing.minOrderQuantity` (ganze Zahl ≥ 1),
  `pricing.importCost`, `fulfillment.shipsFrom` (ISO-Code, z. B. `"PL"`), `fulfillment.deliversToDestination`,
  `fulfillment.deliveryDays` (`{"min":2,"max":4}`), `fulfillment.stock`, `fulfillment.tracking`, `dropshipping.supported`,
  `dropshipping.blindShipping`, `dropshipping.orderChannel` (`api`/`portal`/`email`), `dropshipping.returnsHandledBy`
  (`"supplier"` = der Lieferant nimmt Retouren zurück **und** schreibt den Warenwert gut; `"shop"` = Retouren laufen über
  uns), `payment.terms` (`{"kind":"net_terms","days":30}` oder `{"kind":"prepayment"}`), `payment.creditLimit`
  (Kreditrahmen in EUR, Zahl ≥ 0), `payment.requiresBusinessVerification`, `reliability.sampleTested`.
- **Unterlagen (`safety.document`) brauchen einen festen Dokumenttyp** `docType`; `value` ist der Titel der Unterlage:
  `{ "field": "safety.document", "docType": "gpsr", "value": "Herstellerangaben (GPSR)", … }`. Erlaubte Typen:
  `eu_doc` (Konformitätserklärung), `red_doc` (Funk/RED), `weee`, `battg`, `gpsr`, `food_contact`, `cpnp`,
  `safety_assessment`, `magnet_warning`, `trademark_license`. Nur der Typ erfüllt eine Pflichtunterlage – Freitext nie.
  Einträge ohne gültigen `docType` werden verworfen; `docType` bei anderen Feldern ebenfalls.
- Kreditrahmen und Retourenabwicklung liefert eine Preisliste nie – sie bleiben „fehlt“, bis ein Nachweis vorliegt.
  Marke und Mindestbestellmenge aus der Preisliste sind „vom Lieferanten angegeben“; ein Nachweis mit anderem Wert als
  die Preisliste gilt nicht.
- Ungültige Einträge werden mit Grund verworfen (`npm run suppliers:import -- --status`) und nie angewendet –
  auch ein Prüfdatum, das es nicht gibt (`2026-02-31`) oder das in der Zukunft liegt.
- **Veraltete Nachweise:** Widerspricht ein Nachweis der aktuellen Preisliste (z. B. Preis, Bestand oder
  Zahlungsbedingung haben sich seit der Prüfung geändert), wird er nicht angewendet. Die Angabe bleibt „vom Lieferanten
  angegeben“, und `/lieferanten` zeigt den Widerspruch als offenen Punkt. Dann neu prüfen und den Nachweis aktualisieren.
- **Widersprüchliche Nachweise:** Zwei Nachweise zum selben Feld mit unterschiedlichem Wert heben sich auf – keiner gilt,
  bis der Widerspruch geklärt ist (alten Eintrag entfernen).
- **Artikeländerung:** Ändert der Lieferant Bezeichnung, Marke, Herstellernummer, GTIN oder Variantenkennung eines Angebots, gelten
  Identitäts-, Sicherheits- und Musternachweise, die **vor oder am Tag** dieser Änderung geprüft wurden, nicht mehr – geprüft wurde
  dann womöglich ein anderer Artikel. Eine reine Preis- oder Bestandsänderung berührt sie nicht.
- Ob CE überhaupt nötig ist, entscheidet das Produkt (`ProductQuery.safety.ceRequired`), welche Unterlagen nötig
  sind, `requiredDocTypes` (feste Dokumenttypen; `requiredDocuments` sind nur die Anzeigenamen) – beides
  produktspezifisch zu prüfen. Der Abgleich liegt einmal in `src/lib/suppliers/documents.ts`.

## Wie der Scout importierte Angebote bewertet

1. **Getrennte Wege, Zuordnung nur über die Produktidentität.** Synthetische Testdaten (`--synthetisch`) erreichen
   ausschließlich die Demo-Produkte (über deren fiktive Demo-GTIN). **Echte Zeilen erreichen Demo-Produkte nie** – auch
   nicht mit einer Demo-GTIN –, sondern nur Katalogkandidaten des Market Scout (global eindeutige GTIN bzw.
   Artikelnummer + MPN/Variantenkennung, siehe [MARKET-SCOUT.md](MARKET-SCOUT.md)). Der Import zeigt für echte Zeilen
   deshalb keine Demo-Zuordnung; `/lieferanten` zählt echte Zeilen als zugeordnet, wenn eine Katalogvariante sie nennt.
2. **Gleiche Eignungsprüfung wie für alle Angebote** (`checkEligibility`): Produktidentität, CE/GPSR/Sicherheitshinweise,
   Dropshipping, Lieferung nach DE, Bestand, Lieferzeit, Mindestabnahme, **Mindestbestellwert** (darf keinen
   Vorratskauf erzwingen), Kosten. Zusätzlich gilt für Preislisten: **Einkaufspreis, Versandkosten, Versandland,
   Lieferung nach DE, Lieferzeit und Bestand** müssen per Nachweis geprüft sein, bei Versand von außerhalb der EU auch die
   **Importkosten** – eine Selbstauskunft wird nie Kalkulationsbasis. Angebote, die in der letzten Liste ihres
   Lieferanten fehlen oder dort abgelehnt wurden, sind „nicht mehr aktuell“. Ohne Nachweise bzw. nicht aktuell wird ein
   Preislisten-Angebot **ausgeschlossen** – mit Gründen.
3. **Kennzeichnung** je Angebot: `DEMO` (Demo- und synthetische Testdaten), `ECHTE QUELLE, UNGEPRÜFT`,
   `NACHWEISE GEPRÜFT` (alle kritischen Angaben belegt und keine Pflichtunterlage offen), zusätzlich `AUSGESCHLOSSEN`.
4. **Finanzierung** (`funding.ts`): Zahlungsziel bzw. Vorkasse, Fälligkeit, Auszahlung des Kundengelds
   (`payoutDelayDays`), vorzustreckender Betrag (mindestens der Mindestbestellwert), verfügbare Mittel abzüglich
   Sicherheitsreserve. Ohne Kontonachweis (`FUNDING.verified: false`) heißt es immer „Mittel nicht nachgewiesen“.
   Vorfinanzierungsfreiheit nur bei **belegtem**, sofort nutzbarem Zahlungsziel ≥ Auszahlungsdauer.
5. **Keine Freigabe.** Auch ein geprüftes Angebot mit hohem Score ist nur eine Empfehlung. `purchaseApproved` bleibt
   `false`, der automatische Einkauf gesperrt, und für die Einkaufssperre gilt ein Angebot bis zur belegten
   Zahlungsbedingung als Vorkasse.
6. **Kalkulationsbasis** (Shopify „Kosten pro Artikel“) ist weiterhin der günstigste **geeignete** Lieferant. Ein
   billigeres Angebot ändert sie nur, wenn es aktuell ist und Einkaufspreis, Versandkosten, Versandland (ggf.
   Importkosten), Lieferung nach DE, Lieferzeit und Bestand per Nachweis geprüft sind (Test: `scout-integration.test.ts`). Offene Zahlungsbedingungen oder Pflichtunterlagen
   verhindern das nicht, bleiben aber sichtbar: Kennzeichnung `ECHTE QUELLE, UNGEPRÜFT`, Finanzierung als
   Vorfinanzierung, offene Unterlagen als Hinweis – wie bei den Demo-Angeboten.
   Ein vollständig geprüftes, günstigeres Angebot kann Kalkulationsbasis werden. Bestehende Shopify-Produkte ändert der
   Abgleich dabei nicht: `/shopify` und `npm run shopify:sync` melden die Kostenabweichung, angepasst wird sie bewusst
   von Hand (neue Entwürfe und der CSV-Export übernehmen die neuen Kosten).

## Was wir vom ersten echten Lieferanten brauchen

1. **Preisliste als CSV/Excel** mit Artikelnummer, GTIN/EAN, Marke, Herstellerartikelnummer, Bezeichnung,
   Einkaufspreis netto in EUR, Versandkosten je Stück nach DE (Dropshipping-Tarif), Mindestbestellmenge und
   -wert, Lagerbestand, Versandland, Lieferzeit nach DE, Stand und Quelle.
2. **Dropshipping schriftlich:** Direktversand an Endkunden, neutraler Versand, Bestellweg (Portal/API/E-Mail),
   Retourenabwicklung, Sendungsverfolgung.
3. **Zahlungsbedingungen schriftlich:** Vorkasse oder Zahlungsziel in Tagen, Voraussetzungen (Gewerbe-/USt-Prüfung),
   Kreditrahmen, Zahlungsarten.
4. **Produktunterlagen je Artikel:** EU-Konformitätserklärung (wo CE nötig), Prüfberichte (z. B. RED/EMV),
   verantwortliche Person in der EU (GPSR) mit Anschrift, deutsche Sicherheits- und Gebrauchshinweise,
   WEEE-/Verpackungsregistrierung, bei Lebensmittelkontakt LFGB/EU 1935/2004.
5. **Ein Muster** je Zielprodukt, um Identität und Qualität selbst zu prüfen.
6. Nachweis unserer **verfügbaren Mittel** (Kontoauszug), bevor eine Vorfinanzierung als „möglich“ gelten kann.

## Testdateien

`src/lib/suppliers/import/fixtures/` enthält ausschließlich **synthetische** Dateien (deutsch, englisch, abweichende
Spalten mit Zuordnung, Folgeimport, kaputte Datei). Lieferanten heißen „… (synthetisch)“, GTINs stammen aus dem
internen Bereich 200. Ausprobieren:

```bash
npm run suppliers:import -- src/lib/suppliers/import/fixtures/preisliste-de.synthetisch.csv
```

Testdaten erscheinen im Scout als `DEMO` / „Testdaten“. Zum Entfernen den Ordner `.data/suppliers/` löschen.

## Dateien

| Datei | Aufgabe |
| --- | --- |
| `src/lib/suppliers/import/csv.ts` | CSV lesen (Trennzeichen, Anführungszeichen, BOM) |
| `src/lib/suppliers/import/values.ts` | strenge Werteprüfung (Beträge, Mengen, GTIN, Land, Datum, Zahlungsbedingungen) |
| `src/lib/suppliers/import/columns.ts` | Spaltenzuordnung und Zuordnungsdatei |
| `src/lib/suppliers/import/records.ts` | Zeilen prüfen, fehlende Angaben kennzeichnen |
| `src/lib/suppliers/import/plan.ts` | Testlauf: Dubletten, Änderungen, Bestätigungscode; Übernahme ohne Löschen |
| `src/lib/suppliers/import/evidence.ts` | Nachweise prüfen und produktspezifisch anwenden |
| `src/lib/suppliers/import/to-quote.ts`, `adapter.ts` | Umwandlung ins Scout-Modell, Preislisten-Adapter |
| `src/lib/suppliers/server/offer-store.ts` | lokaler Speicher (atomar, mit Sicherung), nur serverseitig |
| `src/lib/suppliers/funding.ts` | Finanzierungsprüfung mit Beträgen, Fälligkeit, Mitteln und Reserve |
| `scripts/supplier-import.ts` | Befehl `npm run suppliers:import` |
