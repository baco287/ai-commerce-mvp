# Onboarding des ersten EU-Dropshipping-Großhändlers

Stand 31.10.2026. Leitfaden für das Onboarding unseres **ersten** EU-Großhändlers (Versand aus z. B. PL, CZ oder NL
direkt an Verbraucher in Deutschland). Er ist zugleich die fachliche Vorlage für einen späteren **Supplier-Onboarding-
und Compliance-Agenten**: Jede Anforderung ist so beschrieben, dass klar ist, was eine Maschine prüfen darf, was beim
Lieferanten angefordert wird, was ein Mensch bewerten muss und was gesperrt bleibt, solange etwas fehlt.

> **Keine Rechtsberatung.** Dieses Dokument fasst eine geprüfte Recherche (Stand 31.10.2026) zusammen. Es ersetzt
> keine Beratung. Verbindlich klären: Steuerfragen mit dem **Steuerberater**, Verträge, Marken- und Haftungsfragen mit
> einem **Anwalt**, Elektro- und Batterieregistrierung mit der **stiftung ear**, Verpackung mit der **ZSVR**, allgemeine
> Einordnungen mit der **IHK**. Punkte mit **⚠ rechtlich unsicher – fachlich klären** sind ausdrücklich offen.

Verwandte Dokumente: [LIEFERANTEN-IMPORT.md](LIEFERANTEN-IMPORT.md) (CSV-Import, Nachweisdatei),
[SUPPLIER-AGENT.md](SUPPLIER-AGENT.md) (Scout, Finanzierung, Einkaufssperre),
[PRODUKTIONSANFORDERUNGEN.md](PRODUKTIONSANFORDERUNGEN.md) (vertrauliche Preise, Deployment).

## Legende

Jede Anforderung hat eine Kennung (z. B. `L-02`) und diese festen Angaben:

| Zeichen | Bedeutung |
| --- | --- |
| 🤖 | **Automatisch prüfbar** – was der Agent selbst aus einer verlässlichen Quelle prüfen kann (mit Quelle). „–“ bzw. „keine maschinenlesbare Quelle“ heißt: nur Mensch. |
| 📨 | **Beim Lieferanten anfordern** – konkrete Unterlage oder schriftliche Zusage. |
| 👤 | **Menschliche bzw. fachliche Prüfung** – was eine Person oder Fachstelle bewerten muss. |
| ⛔ | **Automatische Sperre bei Fehlen** – was gesperrt bleibt, mit Bezug auf die vorhandenen Code-Sperren. |
| ⚠ | **⚠ rechtlich unsicher – fachlich klären** (Urteil „unsicher“ in der Recherche oder offene Frage). |

Externe Quellen in der Spalte 🤖 tragen eine feste Angabe, wie sie heute abgefragt werden dürfen (Netzwerkzugriff ist im
Code gesperrt, `network: false`, siehe Abschnitt 11):

- **[lokal maschinell]** – Prüfung im eigenen Code bzw. an vorliegenden Dateien.
- **[API vorhanden, nur nach Netzwerk-/Lizenzfreigabe]** bzw. **[Schnittstelle vorab prüfen; bis zur Freigabe nur
  Web-Oberfläche]** – erst nach eigener Netzwerk- und Kostenfreigabe durch einen Menschen.
- **[nur Web-Oberfläche → Mensch, datierter Screenshot]** – kein maschineller Abruf; ein Mensch prüft und legt einen
  datierten Screenshot außerhalb des Repositorys ab.

Sperrbegriffe (siehe Abschnitt 9 für die Gesamtübersicht):

| Sperre | Bedeutung im Code heute |
| --- | --- |
| **kein Listing** | Produkt bleibt unveröffentlicht. Veröffentlichen und Aktivieren sind technisch gesperrt (Schreib-Positivliste `src/lib/shopify/write-operations.ts`, `guards.ts`). Die Compliance-Stufe existiert heute nur als Anzeige im Dry-Run (`/shopify`, `src/lib/shopify/pipeline.ts`, Standard `offen`); sie ist nicht speicherbar und sperrt **keine** Entwurfsanlage. `shopify:sync -- --apply` legt fehlende Demo-Produkte als DRAFT an (der Agent führt das nie aus, siehe 1.2). Für echte Produkte gilt daher bis zu einer Code-Erweiterung: **kein Entwurf ohne menschliche Freigabe S5** (Prozessregel, nicht Code). |
| **keine Kalkulationsbasis** | Angebot wird von `checkEligibility` ausgeschlossen (z. B. `price_list_unverified`, `price_list_outdated`, `safety_unclear`, `identity_unconfirmed`, `cost_unknown`) und erscheint als `AUSGESCHLOSSEN`. |
| **nur ungeprüft** | Angebot bleibt `ECHTE QUELLE, UNGEPRÜFT`; Angaben gelten als „vom Lieferanten angegeben“, nie als „geprüft“. `NACHWEISE GEPRÜFT` erst, wenn alle kritischen Angaben belegt sind und keine Pflichtunterlage offen ist (`src/lib/suppliers/dashboard.ts`). |
| **keine Einkaufsfreigabe** | `purchaseApproved: false`, `SAFETY_SWITCHES.autoPurchaseEnabled: false`. Bei fehlendem oder unbestätigtem Zahlungsziel, bei Demo- und bei ausgeschlossenen Angeboten übergibt `src/lib/suppliers/purchase-bridge.ts` `vorkasse` an die Einkaufssperre; ebenso, wenn das Zahlungsziel an eine Gewerbe-/USt-Prüfung geknüpft oder das unklar ist (siehe Abschnitt 5). Nur ein per Nachweis bestätigtes Zahlungsziel wird – abgerundet – als Stufe (z. B. `netto14`) übergeben. Die Einkaufssperre bleibt unabhängig davon über `autoPurchaseEnabled: false` aus. Muss eine Vorfinanzierung angenommen werden, meldet `funding.ts` bei `FUNDING.verified: false` „Vorfinanzierung nötig – verfügbare Mittel nicht nachgewiesen“ (`src/lib/config/budget.ts`). |

---

## 0. Zweck, Geltungsbereich, Grundsätze, Rollen

### 0.1 Zweck und Geltungsbereich

- Gilt für den **ersten** EU-Großhändler mit Dropshipping und für die fünf Zielprodukte: LED-Lichtstreifen 5 m mit
  App-Steuerung, faltbarer Aluminium-Laptopständer, magnetische Kabelorganizer (10er-Pack), isolierte
  Edelstahl-Trinkflasche 750 ml, Silikon-Uhrenarmbänder (3er-Pack).
- Ziel: Lieferant und Artikel so prüfen und dokumentieren, dass ein Mensch eine **Freigabe** erteilen kann. Die
  Freigabe hebt **nicht** die Einkaufssperre auf und veröffentlicht nichts (siehe 1.3).
- Nicht im Geltungsbereich: Lieferanten außerhalb der EU (dann wären wir bzw. der Lieferant ggf. Einführer – eigenes
  Onboarding), Eigenmarken, Werbung.

### 0.2 Grundsätze für Menschen und Agent

1. **Der Agent bestellt nie, veröffentlicht nie, wirbt nie** und ändert keine Sicherheitsschalter. Er setzt weder
   `SAFETY_SWITCHES` noch `FUNDING.verified` noch die Compliance-Stufe `freigegeben`, und er schlägt auch nicht vor,
   sie ohne ausdrückliche Freigabe zu ändern. Änderungen daran sind bewusste Code-Änderungen mit Review.
2. **Fehlende Angabe = Sperre.** Was nicht belegt ist, gilt als „fehlt“ und sperrt nach Abschnitt 9. Eine
   Selbstauskunft des Lieferanten (Preisliste, E-Mail) ist nie ein Nachweis.
3. **Nichts erfinden.** Keine GTIN, keine Registrierungsnummer, kein Warnhinweis, keine Konformitätsaussage wird
   ergänzt oder geschätzt. Mehrdeutiges wird abgelehnt, nicht geraten (wie im CSV-Import).
4. **Produktspezifisch.** Ein Nachweis gilt nur für genau das Angebot und genau das Produkt bzw. die Variante (GTIN).
   Ein Prüfbericht für Modell A deckt Modell B nie ab.
5. **Vertraulich.** Echte Preislisten, Verträge, Rechnungen, Prüfberichte und Lieferantenakten liegen nur in
   `.data/suppliers/` (von Git ignoriert) oder einem internen, zugriffsgeschützten Ablageort – **nie** in GitHub, in
   Issues, Pull Requests, Commits, Build-Artefakten oder Chat-Verläufen mit Dritten. Das Repository ist öffentlich.
6. **Keine echten Kundendaten in Tests.** Testbestellungen nur an die eigene Adresse.
7. **Der Agent schreibt keine Nachweise als „geprüft“.** Er darf Prüfergebnisse und Entwürfe für Nachweiseinträge
   vorbereiten (mit Quelle und Abrufdatum). Einträge in `.data/suppliers/evidence.json` (Feld `checkedBy` = prüfende
   Person) legt ein Mensch an.
8. **Aufbewahren.** Lieferantendaten und Bezugsquellen 6 Jahre, Informationen zu Risiken, Beschwerden, Unfällen und
   Korrekturmaßnahmen 10 Jahre vorlegbar halten (VO (EU) 2023/988 Art. 15 Abs. 4–5), außerhalb des Repositorys.

### 0.3 Rollen

| Wer | Rolle | Folge |
| --- | --- | --- |
| **Wir** (Shop) | **Händler** nach Art. 3 Nr. 11 GPSR: Wir stellen das Produkt deutschen Verbrauchern online bereit (Art. 4), auch wenn der Großhändler versendet. | Händlerpflichten (Art. 12) und Fernabsatzangaben (Art. 19) bleiben bei uns. Rolle je SKU dokumentieren. |
| **Wir** (Elektro, Batterie, Verpackung) | Voraussichtlich **Hersteller** im Sinne von ElektroG und EU-Batterieverordnung; Verpackungsrecht: für die Produktverpackung in der Regel Hersteller, für die Versandverpackung ⚠ – weil wir Ware aus einem anderen Mitgliedstaat erstmals in DE anbieten. | Siehe `PL-10`, `PL-14`, `PL-15`, `D-12`. Teilweise ⚠ rechtlich unsicher – fachlich klären. |
| **Großhändler** | Je Artikel klären: **Hersteller** (Art. 3 Nr. 8), **Einführer** (Art. 3 Nr. 10, Drittlandware mit EU-Sitz) oder **Händler**. **Kein** Fulfilment-Dienstleister (Art. 3 Nr. 12 setzt fehlendes Eigentum voraus). | Bestimmt, wessen Angaben auf Produkt und im Angebot stehen und wer die technischen Unterlagen hält. |
| **Eigenmarke vermeiden** | Wer ein Produkt unter eigenem Namen oder eigener Marke in Verkehr bringt oder es wesentlich verändert, gilt als Hersteller (Art. 13 GPSR; beim LED-Streifen RED Art. 14, LVD Art. 10; Verpackung: eigenes Branding macht zum Hersteller). | Kein eigenes Branding auf Produkt oder Produktverpackung; neutraler Versandkarton ist zulässig. Ob ein Shop-Logo nur auf dem Versandkarton schon Herstellerstellung auslöst: ⚠ rechtlich unsicher – fachlich klären. |

---

## 1. Ablauf als Zustandsmodell

Zwei Ebenen: Der **Lieferant** durchläuft die Stufen einmal (Stammdaten, Vertrag, Zahlung, Versand), jeder **Artikel
bzw. jede Variante (SKU)** durchläuft sie einzeln (Produktsicherheit, GTIN, Muster). Ein Artikel kann nie weiter sein
als sein Lieferant.

### 1.1 Stufen

| Stufe | Eintritt (alle Bedingungen) | Austritt bzw. nächste Stufe | Was in dieser Stufe gesperrt bleibt |
| --- | --- | --- | --- |
| **S0 ANGEFRAGT** | Ein Mensch hat den Lieferanten ausgewählt und die Unterlagenliste (Abschnitte 2–7) verschickt. Der Agent versendet nichts selbst. | → S1, wenn alle 📨-Unterlagen für Lieferant und Artikel eingegangen sind. | Alles: kein Import, keine Kalkulationsbasis, kein Listing, kein Einkauf. |
| **S1 UNTERLAGEN VOLLSTÄNDIG** | Für jede Anforderung liegt eine Unterlage oder eine schriftliche Zusage vor; 🤖-Prüfungen (Format, Vollständigkeit, Datum, Register) sind gelaufen und protokolliert. | → S2 nach fachlicher Bewertung. Zurück nach S0, wenn eine Unterlage fehlt, abgelaufen ist oder nicht zum Artikel passt. | Wie S0. Eine vorliegende Unterlage ist noch keine Prüfung. |
| **S2 FACHLICH GEPRÜFT** | Alle 👤-Punkte sind bewertet und dokumentiert (Name, Datum). Alle ⚠-Punkte, die den Artikel betreffen, sind geklärt oder bewusst als Sperrgrund stehen gelassen. | → S3. Bei Ablehnung: Artikel bzw. Lieferant **ABGELEHNT** (mit Grund). | Kein Listing, kein Einkauf. Nachweiseinträge in `evidence.json` dürfen erst jetzt angelegt werden (durch einen Menschen). |
| **S3 TESTLAUF OK** | Die echte Preisliste lief im **Testlauf** ohne Strukturfehler; abgelehnte Zeilen sind verstanden; GTIN-Zuordnung je Variante passt (**manuelle Prüfung** durch einen Menschen, Abschnitt 7, 8 – der Code kennt heute nur die Platzhalter-GTINs der Demo-Produkte, siehe 7.2). Übernahme mit `--apply` erst nach menschlicher Freigabe. | → S4. Bei Fehlern zurück zum Lieferanten (korrigierte Liste). | Ohne Nachweise bleibt jedes **einem Produkt zugeordnete** Angebot `ECHTE QUELLE, UNGEPRÜFT` und mit `price_list_unverified` ausgeschlossen. Echte GTINs werden heute keinem Produkt zugeordnet (nur gezählt als „ohne Produktzuordnung“); eine Bewertung setzt 7.3 Nr. 1–2 voraus. |
| **S4 MUSTER / TESTBESTELLUNG OK** | Ein Mensch hat Muster bzw. eine Testbestellung an die eigene Adresse **selbst** beauftragt und bezahlt (Ausgabe braucht Freigabe; der Agent bestellt nie). Paketinhalt, Kennzeichnung, Beilagen, Neutralversand, Tracking und Laufzeit sind geprüft und mit Fotos dokumentiert. | → S5. Bei Mängeln: Artikel gesperrt, Lieferant informieren. | Ohne `reliability.sampleTested` bleibt der Hinweis „Geprüftes Muster fehlt“. Kein Listing. |
| **S5 FREIGABE DURCH MENSCH** | Eine verantwortliche Person gibt Lieferant und Artikel frei (schriftlich, datiert, mit Verweis auf die Nachweise). | Erst danach darf ein Mensch einen Shopify-**Entwurf** für das echte Produkt anlegen lassen. Das ist eine **Prozessregel, nicht Code**: Die Compliance-Stufe ist heute nur eine Dry-Run-Anzeige, nicht speicherbar und sperrt keinen Entwurf (siehe Legende „kein Listing“). Veröffentlichen ist eine eigene menschliche Entscheidung in Shopify und technisch gesperrt. | **Einkauf bleibt gesperrt** (`autoPurchaseEnabled: false`, `purchaseApproved: false`). Keine Werbung (`realAdsEnabled: false`). |
| **GESPERRT** (jederzeit) | Eine Sperrbedingung aus Abschnitt 9 tritt ein (z. B. Nachweis veraltet, Preisliste neuer, Artikeländerung, Sicherheitsmeldung). | Zurück in die Stufe, deren Bedingung wieder erfüllt ist. | Je nach Bedingung (Abschnitt 9). |

### 1.2 Was der Agent je Stufe darf

| Darf | Darf nie |
| --- | --- |
| Unterlagen auf Vollständigkeit, Format, Datum, Unterschrift und passende Modellnummer prüfen; öffentliche Register nur abfragen, wenn ein Mensch eine eigene Netzwerk- und Kostenfreigabe erteilt hat (`network`/`paid`, Sicherheitstest `NETWORK_ALLOWED`) und die Nutzungsbedingungen geprüft sind – bis dahin keine Netzwerkabfrage, kein Web-Scraping; ein Mensch prüft manuell und legt einen datierten Nachweis ab; Prüfprotokolle und Entwürfe für Nachweiseinträge vorbereiten; Testlauf `npm.cmd run suppliers:import -- <Datei>` ausführen und auswerten; `--status` lesen; offene Punkte und Sperrgründe auflisten. | Bestellen, Muster kaufen, bezahlen; Nachrichten an Lieferanten oder Behörden senden; `--apply` ausführen; `evidence.json` als „geprüft“ füllen; Shopify schreiben (`npm run shopify:sync -- --apply`), veröffentlichen, Werbung schalten; `SAFETY_SWITCHES`, `FUNDING`, `LIMITS`, Compliance-Stufe oder Einkaufssperre ändern; echte Daten ins Repository oder in Builds bringen; GTINs oder Pflichtangaben ergänzen, die nicht vom Lieferanten bzw. Hersteller stammen. |

### 1.3 Verhältnis zur Einkaufssperre

Auch nach **S5** gilt: Eine Empfehlung oder Freigabe des Lieferanten ist **keine Einkaufsfreigabe**. Die Einkaufssperre
(`evaluateAutoPurchase`) bleibt über `SAFETY_SWITCHES.autoPurchaseEnabled = false` global aus, `purchaseApproved` bleibt
`false`, und die Finanzierungsprüfung meldet „Vorfinanzierung nötig – verfügbare Mittel nicht nachgewiesen“, sobald
eine Vorfinanzierung angenommen werden muss und `FUNDING.verified = false` ist (Einzelheiten Abschnitt 5). Wann
und wie diese Schalter geändert werden, entscheidet ein Mensch per Code-Änderung mit Review – nicht dieses Onboarding.

---

## 2. Lieferant prüfen

| ID · Anforderung | 🤖 Automatisch prüfbar | 📨 Beim Lieferanten anfordern | 👤 Menschliche Prüfung | ⛔ Sperre bei Fehlen | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- |
| **L-01 Identität und Registerauszug** | Abgleich Name, Anschrift, Registernummer zwischen Auszug, Vertrag, Rechnung und USt-IdNr.-Bestätigung (Widersprüche melden). Register selbst: KRS (PL), Obchodní rejstřík (CZ), KvK (NL) – öffentlich, maschinenlesbarer Zugang je Register vorab prüfen **[Schnittstelle vorab prüfen; bis zur Freigabe nur Web-Oberfläche]**. | Aktueller Handelsregisterauszug, vertretungsberechtigte Personen, Steuernummer im Sitzstaat. | Plausibilität, Vertretungsbefugnis des Unterzeichners. | Lieferant bleibt in S0; kein Import über `--apply`. | Keine gesetzliche Pflicht, Sorgfaltsmaßnahme. Quelle: https://www.gesetze-im-internet.de/ustg_1980/__18e.html (Recherche „USt-IdNr.-Prüfung“) |
| **L-02 USt-IdNr. qualifiziert bestätigen** | Technisch möglich über die eVatR-Schnittstelle des BZSt (qualifizierte Bestätigung: Name, Ort, PLZ, Straße), aber nur mit eigener deutscher USt-IdNr. (`O-28`) und nach Netzwerkfreigabe. Heute nicht angebunden → Mensch fragt manuell ab und legt das Ergebnis datiert im Lieferantenakt ab (nicht im Repository); regelmäßig wiederholen. **[API vorhanden, nur nach Netzwerk-/Lizenzfreigabe]** | USt-IdNr. des Lieferanten. | Bei Abweichung: Rückfrage, keine Freigabe. | Ohne gültige Bestätigung keine Freigabe (S5) und keine Einkaufsfreigabe. | § 18e Nr. 1 UStG. https://www.gesetze-im-internet.de/ustg_1980/__18e.html |
| **L-03 Rolle je Artikel** | Vollständigkeit der Rollenerklärung je SKU (Hersteller/Einführer/Händler, Pflichtfelder vorhanden). | Schriftliche Rollenerklärung je Artikel; falls Händler: Name und Anschrift von Hersteller und Einführer. | Plausibilität (z. B. Ware aus China → wer ist EU-Einführer?). | Artikel bleibt in S0/S1, kein Listing. | VO (EU) 2023/988 Art. 3 Nr. 6–13, Art. 4. https://gesetze.legal/eu/vo_eu_2023_988/3 |
| **L-04 Keine Eigenmarke** | Prüfen, ob Fotos/Etiketten unseren Namen oder unsere Marke zeigen (Bildabgleich nur als Hinweis). | Bestätigung: Lieferung mit Hersteller- bzw. Markenkennzeichnung des Herstellers, kein Private Label mit unserem Namen. | Entscheidung, ob jemals eine Eigenmarke gewünscht ist (dann eigenes Hersteller-Onboarding). | Bei Eigenmarke ohne Herstellerpflichten-Erfüllung: kein Listing. | VO (EU) 2023/988 Art. 13 Abs. 1–3, Art. 9; LED: RL 2014/53/EU Art. 14, RL 2014/35/EU Art. 10. https://gesetze.legal/eu/vo_eu_2023_988/13 |
| **L-05 Produktsicherheitskontakt** | Vollständigkeit (Name, E-Mail, Telefon). | Benannter Ansprechpartner für Produktsicherheit; vertragliche Pflicht, uns unverzüglich über Rückrufe, Behördenmaßnahmen und Safety-Gate-Meldungen zu informieren. | Vertragsklausel prüfen. | Keine Freigabe (S5). | VO (EU) 2023/988 Art. 12 Abs. 4, Art. 9 Abs. 10, Art. 27. https://gesetze.legal/eu/vo_eu_2023_988/12 |
| **L-06 Rückruf- und Beschwerdeprozess des Lieferanten** | – (keine maschinenlesbare Quelle) | Beschreibung des Rückruf- und Beschwerdeprozesses von Lieferant bzw. Hersteller. | Bewertung, ob er zu unserem internen Verfahren passt (`PA-11`). | Keine Freigabe (S5). | VO (EU) 2023/988 Art. 14, Art. 3 Nr. 13. https://gesetze.legal/eu/vo_eu_2023_988/14 |
| **L-07 Produkthaftpflicht- und ggf. Rückrufkostenversicherung** | Gültigkeitsdatum der Bestätigung; Geltungsbereich „Deutschland“ im Text vorhanden. | Versicherungsbestätigung (Deckung, Geltungsbereich inkl. Deutschland); Freistellungsklausel. | Deckung ausreichend? (Anwalt/Versicherungsberater) | Keine Freigabe (S5). | VO (EU) 2023/988 Art. 37; § 4 ProdHaftG; künftig RL (EU) 2024/2853 (Umsetzungsfrist 09.12.2026, Stand der deutschen Umsetzung offen). https://eur-lex.europa.eu/eli/reg/2023/988/oj |
| **L-08 Bonität / Vorkasse-Risiko** | – (keine geprüfte Quelle in der Recherche) | Angaben zu Guthaben- oder Vorkasseregeln (siehe `Z-02`). | Bonität einschätzen; kein ungesichertes hohes Guthaben aufbauen. | Bis zur Bewertung gilt jedes Angebot für die Einkaufssperre als `vorkasse`. | Keine gesetzliche Pflicht, kaufmännische Sorgfalt (Recherche „Zahlungsbedingungen“). https://www.gesetze-im-internet.de/bgb/__271a.html |
| **L-09 Rahmenvertrag: Recht, Gerichtsstand, Regress, Gewährleistung** | Prüfen, ob die Klauseln im Entwurf vorhanden sind (Checkliste). | Vertragsentwurf und AGB des Lieferanten; Zustimmung zu deutschem Recht ohne UN-Kaufrecht (CISG) und deutschem Gerichtsstand; Gewährleistung mindestens deckungsgleich mit 2 Jahren. | Anwaltliche Prüfung; Kollision mit Lieferanten-AGB klären. ⚠ rechtlich unsicher – fachlich klären, ob der Lieferant zustimmt. | Keine Freigabe (S5). | Rom I Art. 3, Art. 4 Abs. 1 lit. a; CISG Art. 1 Abs. 1 lit. a, Art. 6; Brüssel Ia Art. 25; §§ 438, 445a, 445b, 478 BGB. https://www.gesetze-im-internet.de/bgb/__445a.html |

---

## 3. CSV-Preisliste anfordern

Grundlage ist unser Import (`npm run suppliers:import`, Spalten aus `src/lib/suppliers/import/columns.ts`,
Einzelheiten in [LIEFERANTEN-IMPORT.md](LIEFERANTEN-IMPORT.md)). Eine Preisliste ist immer nur **Selbstauskunft**:
Jede Angabe gilt als „vom Lieferanten angegeben“, bis ein Nachweis vorliegt.

### 3.1 Formatvorgaben an den Lieferanten

- Kodierung **UTF-8** (Excel: „CSV UTF-8 (durch Trennzeichen getrennt)“), Trennzeichen `;`, `,` oder Tab, erste Zeile
  Spaltenköpfe, jede Zeile gleich viele Spalten. Andere Kodierungen werden abgelehnt.
- **Je Variante eine Zeile** (Farbe, Größe, Set) mit **eigener Lieferanten-Artikelnummer** und **eigener GTIN**.
  Keine Sammelzeilen wie „Silber/Grau“.
- Preise **netto in EUR** je Stück, ohne Zusätze (`12,50`, `12.50`, `1.234,50`). Andere Währungen werden abgelehnt.
- Zahlungsbedingungen nur eindeutig (`Vorkasse`, `Rechnung 30 Tage`, `netto 14`) – Skonto, „oder“, Bedingungen
  gesondert schriftlich, nicht in der Spalte.
- Datum der Liste (Spalte `Stand`) in jeder Zeile – ein festes Datum per Zuordnungsdatei ist heute nicht möglich. Die
  Herkunft (`Quelle`) kann als Spalte oder als fester Wert `defaults.dataSource` in der Zuordnungsdatei stehen.
- Abweichende Spaltenköpfe sind möglich – dann erstellen wir eine Zuordnungsdatei (`--mapping`), der Lieferant muss
  nichts umbauen.

### 3.2 Spalten

| ID · Spalte (Feld) | Pflicht | 🤖 Automatisch (Import) | 📨 Anfordern | 👤 Mensch | ⛔ Sperre bei Fehlen | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- | --- |
| **C-01 Lieferantenname** (`supplierName`) | ja¹ | Pflichtspalte; sonst Datei abgelehnt. | Rechtlicher Firmenname wie im Register. | Abgleich mit `L-01`. | Datei wird nicht übernommen. | Vertraglich (§ 311 Abs. 1 BGB). https://www.gesetze-im-internet.de/bgb/__311.html |
| **C-02 Lieferanten-Artikelnummer** (`supplierSku`) | ja | Pflichtspalte; Dubletten erkannt, widersprüchliche Dubletten abgelehnt. | Eindeutig **je Variante**. | – | Zeile bzw. Datei abgelehnt. | wie C-01 |
| **C-03 GTIN/EAN** (`gtin`) | nein im Import, **intern verlangt** | Prüfziffer (8/12/13/14 Stellen); falsche Prüfziffer → Zeile abgelehnt. | Echte GTIN **je Variante** mit GS1-Herkunft (siehe Abschnitt 7). | Abgleich Label/Foto (`G-05`). | Ohne GTIN: gespeichert, aber **keinem Produkt zugeordnet** (keine Kalkulationsbasis). | Interne Anforderung (Zuordnung je Variante). Keine gesetzliche GTIN-Pflicht. Art. 9 Abs. 5 und Art. 19 lit. c GPSR verlangen ein Identifikationsmerkmal bzw. Produktidentifikatoren, z. B. die Modell- oder Typnummer. Die GTIN ist möglich, aber nicht vorgeschrieben. ⚠ rechtlich unsicher – fachlich klären: ob die GTIN allein genügt. Bis dahin Modell/Typ und GTIN angeben. https://gesetze.legal/eu/vo_eu_2023_988/19 |
| **C-04 Marke** (`brand`) | nein, **erbeten** | Änderung später = Artikeländerung (Nachweise verfallen). | Marke wie auf dem Produkt. | – | Kein Hinweis im Import (Feld bleibt still leer); Fehlen beim Abgleich `G-05` manuell prüfen. | Art. 19 lit. a GPSR. https://gesetze.legal/eu/vo_eu_2023_988/19 |
| **C-05 Herstellerartikelnummer** (`mpn`) | nein, **erbeten** | wie C-04 | Modell- bzw. Typnummer wie auf dem Produkt. | – | Kein Hinweis im Import (Feld bleibt still leer); Fehlen beim Abgleich `G-05` manuell prüfen. | Art. 9 Abs. 5, Art. 19 lit. c GPSR. https://gesetze.legal/eu/vo_eu_2023_988/19 |
| **C-06 Artikelbezeichnung** (`title`) | ja | Pflichtspalte. | Inkl. Variantenmerkmal (Farbe/Größe). | – | Zeile abgelehnt. | wie C-01 |
| **C-07 Einkaufspreis netto** (`unitPrice`) | ja | Betrag eindeutig, > 0; mehrdeutige Werte abgelehnt. | Netto, EUR, je Stück, Dropshipping-Tarif. | – | Zeile abgelehnt; ohne Nachweis `price_list_unverified`. | wie C-01 |
| **C-08 Währung** (`currency`) | ja¹ | Nur `EUR`. | – | – | Zeile abgelehnt. | wie C-01 |
| **C-09 Versandkosten DE** (`shippingCostDe`) | nein, **erbeten** | Betrag je Stück. | Dropshipping-Versandkosten nach DE. | – | Ohne Nachweis `price_list_unverified`; fehlend `cost_unknown` und – weil die Lieferung nach DE dann als nicht angegeben gilt – `not_deliverable`. | wie C-01 |
| **C-10 Mindestbestellmenge / -wert** (`minOrderQuantity`, `minOrderValue`) | nein, **erbeten** | Ganze Zahl ≥ 1 bzw. Betrag. | MOQ/MOV, Dropshipping-Gebühr, Verpackungskosten (siehe `D-09`). | – | Fehlende Mindestbestellmenge: kein Import-Hinweis, nur Scout-Hinweis „Mindestabnahme unbekannt – vor Freigabe klären“; fehlender Mindestbestellwert: Import-Hinweis „bleibt fehlend“; erzwingt Vorratskauf: `stock_purchase_required`. | Vertraglich. https://www.gesetze-im-internet.de/bgb/__311.html |
| **C-11 Lagerbestand** (`stock`) | nein, **erbeten** | Ganze Zahl ≥ 0. | Bestand je Variante, Aktualisierungsrhythmus (`D-07`). | – | Ohne Nachweis `price_list_unverified`; unbekannt `not_deliverable`. | wie C-10 |
| **C-12 Versandland** (`shipsFrom`) | nein, **erbeten** | ISO-Code (z. B. `PL`) aus der EU-Liste bzw. der Liste bekannter Nicht-EU-Länder oder ein bekannter Ländername (z. B. „Polen“, „Tschechien“); unbekannte Länder oder Codes → Zeile abgelehnt. Empfehlung an den Lieferanten: ISO-Code verwenden. | Tatsächliches Abgangslager. | Außerhalb der EU: eigenes Onboarding. | Ohne Nachweis `price_list_unverified`. | wie C-10 |
| **C-13 Lieferzeit** (`deliveryDays` bzw. min/max) | nein, **erbeten** | Spanne in Tagen; „Wochen“ wird nicht umgedeutet. | Laufzeit nach DE inkl. Bearbeitung (`D-03`). | – | Ohne Nachweis `price_list_unverified`; unbekannt `not_deliverable`. | Art. 246a § 1 Abs. 1 Satz 1 Nr. 7 EGBGB. https://www.gesetze-im-internet.de/bgbeg/art_246a__1.html |
| **C-14 Dropshipping / Neutraler Versand** (`dropshipping`, `blindShipping`) | nein, **erbeten** | ja/nein. | Schriftliche Bestätigung (`D-01`). | – | Direktversand nicht belegt: `dropshipping_unavailable`. Fehlender Wert für Neutralen Versand: kein Import-Hinweis, nur der Scout-Hinweis zum neutralen Versand (z. B. „Neutraler Versand nicht bestätigt“). | wie C-10 |
| **C-15 Zahlungsbedingungen** (`paymentTerms`) | nein | Nur eindeutige Werte; sonst Zeile abgelehnt. | Schriftlich (`Z-01`). | – | Bis zum Beleg gilt Vorkasse. | siehe `Z-01` |
| **C-16 Stand und Quelle** (`supplierUpdatedAt`, `dataSource`¹) | nein, **erbeten** | Datum gültig; älter als 90 Tage oder in der Zukunft → Hinweis. Das Datum nur als Spalte `Stand` (kein fester Wert per Zuordnungsdatei). | Exportdatum, Herkunft (Portal, E-Mail). | – | Hinweis; veraltete Liste neu anfordern. Fehlt die Spalte `Stand`: Hinweis „Keine Angabe (bleibt ‚fehlend‘): Aktualisierungsdatum“, die 90-Tage-Prüfung entfällt. | wie C-10 |
| **C-17 GPSR-Produktdaten je SKU** (Hersteller mit Anschrift und E-Mail, verantwortliche Person in der EU, Modell/Typ, Warnhinweise auf Deutsch, Fotos mit Nutzungsrecht) | **für uns Pflicht** | Heute **nicht** im Import: unbekannte Spalten werden ignoriert und im Testlauf aufgelistet. Vollständigkeit kann der Agent in einer separaten Datei prüfen. | Strukturierte Produktdatei je SKU (separat von der Preisliste). | Inhalt bewerten (`PA-06`). | Kein Listing. | Art. 19 lit. a–d GPSR; § 6 Nr. 3 ProdSG. https://gesetze.legal/eu/vo_eu_2023_988/19 |

¹ kann statt als Spalte als feste Angabe in der Zuordnungsdatei stehen (`defaults`; möglich nur für `supplierName`,
`currency` und `dataSource`).

### 3.3 Musterzeile (synthetisch)

Nur zur Veranschaulichung – **keine echten Daten**. GTINs aus dem internen Bereich 200 (nie im Handel vergeben),
Prüfziffern gültig.

```csv
Lieferant;Artikelnummer;GTIN;Marke;Herstellerartikelnummer;Bezeichnung;EK netto;Währung;Versandkosten DE;Mindestbestellmenge;Mindestbestellwert;Bestand;Versandland;Lieferzeit;Dropshipping;Neutraler Versand;Zahlungsbedingungen;Stand;Quelle
Musterhandel Test GmbH (synthetisch);MT-STAND-SLV;2009990000012;Testmarke (synthetisch);TM-LS-01-SLV;Laptopständer Aluminium faltbar, Silber (synthetisch);9,99;EUR;3,50;1;0;100;PL;2-4;ja;ja;Vorkasse;2026-10-31;Synthetische Musterzeile
Musterhandel Test GmbH (synthetisch);MT-STAND-GRY;2009990000029;Testmarke (synthetisch);TM-LS-01-GRY;Laptopständer Aluminium faltbar, Space Grau (synthetisch);9,99;EUR;3,50;1;0;80;PL;2-4;ja;ja;Vorkasse;2026-10-31;Synthetische Musterzeile
```

Synthetische Dateien mit `.synthetisch.` im Namen oder mit `--synthetisch` importieren. Die Musterzeilen dienen nur dem
**Testlauf** (Format, Spalten, Prüfziffern). Mit diesen GTINs werden sie keinem Demo-Produkt zugeordnet (der Code kennt
nur die Platzhalter aus `DEMO_QUERIES`) und erscheinen auf `/lieferanten` nicht als Angebot, nur in der Zählung „ohne
Produktzuordnung“. Als `DEMO`/„Testdaten“ gekennzeichnet werden synthetische Angebote erst, wenn sie einem Produkt
zugeordnet sind. Auch synthetische Importe übernimmt nur ein Mensch mit `--apply --confirm`.

---

## 4. Dropshipping- und Versandbedingungen (schriftlich)

Alle Punkte gehören in den Rahmenvertrag bzw. eine schriftliche Service-Vereinbarung. Nachweisfelder in
`evidence.json`: `dropshipping.supported`, `dropshipping.blindShipping`, `dropshipping.orderChannel`
(`api`/`portal`/`email`), `fulfillment.tracking`, `fulfillment.deliveryDays`, `fulfillment.shipsFrom`,
`fulfillment.deliversToDestination`, `fulfillment.stock`, `pricing.shippingCost`.

| ID · Anforderung | 🤖 Automatisch prüfbar | 📨 Beim Lieferanten anfordern | 👤 Menschliche Prüfung | ⛔ Sperre bei Fehlen | Nachweisfeld | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- | --- |
| **D-01 Neutralversand mit Pflichtbeilagen** | Checkliste der Zusage vollständig (Label bleibt, Originalverpackung bleibt, deutsche Anleitung liegt bei, nichts überklebt). | Schriftliche Zusicherung: Neutral heißt nur Versandkarton ohne Werbung, Preise oder Lieferantenrechnung; Produktlabel, Originalverpackung, Hersteller-/Einführerangaben und Beilagen bleiben; deutsche Anleitung und Sicherheitsinfos liegen jeder Sendung bei; Lagerung/Transport ohne Beeinträchtigung der Sicherheit. | Testbestellung an eigene Adresse: Paketinhalt prüfen (S4). | Kein Listing; ohne Nachweis Hinweis „Neutraler Versand nicht bestätigt“. | `dropshipping.blindShipping`, `dropshipping.supported` | VO (EU) 2023/988 Art. 9 Abs. 5–7, Art. 11 Abs. 3–4, Art. 12 Abs. 1–3, Art. 16 Abs. 3. https://gesetze.legal/eu/vo_eu_2023_988/11 |
| **D-02 Transportrisiko bis Zustellung** | Klausel im Vertrag vorhanden. | Klausel: Gefahrübergang erst mit Zustellung beim Endkunden; Erstattung oder kostenlose Nachlieferung bei Verlust ohne Zustellnachweis. | Anwalt. Ohne Klausel trägt im B2B-Verhältnis eher wir das Risiko (§ 447 BGB bzw. Art. 67 CISG). | Keine Freigabe (S5). | – (kein Feld) | § 475 Abs. 2 i. V. m. § 447 BGB; Art. 67 CISG; § 311 Abs. 1 BGB. https://www.gesetze-im-internet.de/bgb/__447.html |
| **D-03 Service-Vereinbarung Versand** | Felder vorhanden (Cut-off, Bearbeitungszeit, Carrier, Laufzeit DE); Abgleich mit Testbestellung (Datum Bestellung → Zustellung). | Schriftliche SLA: Cut-off, Bearbeitungszeit, Carrier, Versicherung, Laufzeit nach DE, Vorgehen bei Teillieferung/Verzug, Meldefristen für Transportschäden. | Im Shop nur schriftlich zugesagte Lieferzeiten angeben. | Ohne Nachweis `price_list_unverified` (Lieferzeit), Lieferzeit unbekannt `not_deliverable`. | `fulfillment.deliveryDays`, `fulfillment.deliversToDestination` | § 475 Abs. 2 i. V. m. § 447 BGB; Art. 246a § 1 Abs. 1 Satz 1 Nr. 7 EGBGB; § 312j Abs. 1 BGB. Gefahrübergang: https://www.gesetze-im-internet.de/bgb/__475.html · Lieferzeit: https://www.gesetze-im-internet.de/bgbeg/art_246a__1.html |
| **D-04 Tracking und Zustellnachweis** | Trackingnummer je Sendung innerhalb der Frist vorhanden; Format plausibel. | Zusage: Trackingnummer je Sendung in verhandelter Frist (z. B. 2 Werktage), Zustellnachweis auf Anfrage; welche Nachweise der Lieferant nach seinem Recht von uns erwartet. | Gelangensbestätigung nur ausstellen, wenn Zustellung belegt ist. ⚠ rechtlich unsicher – fachlich klären: Ein reiner Tracking-Ausdruck erfüllt die Gelangensvermutung nach Art. 45a DVO 282/2011 nicht sicher (Steuerberater). | Hinweis „Sendungsverfolgung fehlt/nicht bestätigt“; keine Freigabe (S5). | `fulfillment.tracking` | Art. 45a DVO (EU) 282/2011; § 17a, § 17b UStDV (nur für deutsche Lieferer). https://eur-lex.europa.eu/eli/reg_impl/2011/282/oj |
| **D-05 Chargen-/Losnummer je Sendung** | Feld in Versandbestätigung bzw. Rückmeldedatei vorhanden. | Chargen- bzw. Losnummer je Endkundenlieferung (Versandbestätigung, API oder CSV-Rückmeldung). | – | Keine harte Sperre (gesetzlich nicht ausdrücklich verlangt, aber für gezielte Rückrufe nötig); offener Punkt bis S5. | – (kein Feld) | VO (EU) 2023/988 Art. 15 Abs. 2–5; Trinkflasche VO (EG) 1935/2004 Art. 17. https://gesetze.legal/eu/vo_eu_2023_988/15 |
| **D-06 Retouren und Widerruf** | Retourenrichtlinie vorhanden; Felder Adresse, Frist, Kosten. | Schriftliche Retourenrichtlinie für Widerrufsware: Rücknahmepflicht, Gutschriftsfrist, Kosten, Retourenadresse (möglichst in DE). | Widerrufsbelehrung, Muster-Widerrufsformular, Rücksendekosten und Widerrufsbutton (seit 19.06.2026) im Shop. ⚠ rechtlich unsicher – fachlich klären: Retourenadresse im Ausland verändert Kosten und Belehrung. | Keine Freigabe (S5). | – (kein Feld) | § 312g Abs. 1, § 355 Abs. 2, § 356a, § 357 Abs. 1, 4, 5 BGB; Art. 246a § 1 Abs. 2 EGBGB; RL (EU) 2023/2673. https://www.ihk.de/braunschweig/beratung-und-service/rechtsthemen/wirtschaftsrecht-von-a-bis-z/internet-und-recht2/widerrufs-button-verpflichtend-seit-juni-2026-7103310 |
| **D-07 Bestandsupdates** | Musterdatei lesbar, GTIN je Zeile, Rhythmus angegeben; Bestand im Testlauf plausibel. | Frequenz und Format der Bestandsupdates inkl. GTIN; Musterdatei. | Sicherheitspuffer im Shop festlegen. | Ohne Nachweis `price_list_unverified` (Bestand). | `fulfillment.stock` | Vertraglich (§ 311 Abs. 1 BGB). https://www.gesetze-im-internet.de/bgb/__311.html |
| **D-08 Bestellkanal** | Dokumentation vorhanden; Kanal ist `api`, `portal` oder `email`. Der Agent nutzt den Kanal **nie**. | Bestellkanal mit Bestellbestätigung und Fehlermeldung; API-Dokumentation oder Testzugang. | Bewertung; Testzugang nur ohne echte Bestellung. | Hinweis „Bestellweg fehlt/nicht bestätigt“. | `dropshipping.orderChannel` | wie D-07 |
| **D-09 MOQ, MOV, Gebühren** | Werte aus Preisliste vs. schriftlicher Gebührenliste vergleichen. | MOQ/MOV, Dropshipping-Gebühr, Verpackungskosten, Gebührenliste. | – | MOQ/MOV unbekannt: Hinweis; erzwungener Vorratskauf: `stock_purchase_required`. | `pricing.minOrderValue` | wie D-07 |
| **D-10 Preisänderungen** | Frist in Tagen vorhanden. | Ankündigungsfrist für Preisänderungen und Preisbindung für angenommene Bestellungen. | – | Keine Freigabe (S5); neue Preisliste macht widersprechende Preisnachweise ungültig. | `pricing.unitPrice` | wie D-07 |
| **D-11 Datenschutz bei Weitergabe der Kundenadressen** | Unterzeichneter AV-Vertrag vorhanden; Anlagen TOM und Unterauftragsverarbeiter vorhanden. | AV-Vertrag nach Art. 28 Abs. 3 DSGVO **oder** Begründung eigener Verantwortlichkeit; TOM, Unterauftragsverarbeiter, Löschfristen. | ⚠ rechtlich unsicher – fachlich klären: Auftragsverarbeiter oder eigener Verantwortlicher (Datenschutzberater). Datenschutzerklärung und Verarbeitungsverzeichnis ergänzen. | Keine Freigabe (S5); keine echten Kundendaten an den Lieferanten. | – (kein Feld) | Art. 5 Abs. 1 lit. c, Art. 13 Abs. 1 lit. e, Art. 28, Art. 30 DSGVO; EDSA-Leitlinien 07/2020. https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en |
| **D-12 Verpackung: Registrierung und Systembeteiligung** | LUCID-Nummer des Lieferanten im öffentlichen LUCID-Register prüfen und mit Datum dokumentieren (Web-Register; maschinenlesbarer Zugang nicht belegt) **[nur Web-Oberfläche → Mensch, datierter Screenshot]**. | LUCID-Registrierungsnummer, bestätigter Bevollmächtigter in DE, Nachweis der Systembeteiligung (Versand- und Verkaufsverpackung, Name des Systems), Zusage zur Aufrechterhaltung; wer erscheint als Absender auf dem Paket? | **Produktverpackung:** Wir sind als Erstbereitsteller in DE nach Art. 3 Abs. 1 Nr. 15 PPWR in der Regel selbst Hersteller. Deshalb vor dem Verkaufsstart eigene LUCID-Registrierung unter eigenem Namen und Systembeteiligung für die Verkaufsverpackung. **Versandverpackung:** ⚠ rechtlich unsicher – fachlich klären (ZSVR, schriftlich), ob Lieferant oder wir. Im Zweifel selbst registrieren und beteiligen. Bestehende Registrierung: Änderungsmeldung bis 12.11.2026. Neuregistrierungsfrist 12.09.2026 ist abgelaufen, also sofort registrieren (Fristen aus Sekundärquellen zu § 68 VerpackDG). Systembeteiligung über 31.12.2026 hinaus prüfen. | Kein Listing ohne eigene LUCID-Registrierung und Systembeteiligung für die Produktverpackung und ohne geklärte Zuordnung der Versandverpackung. Zusätzlich kein Listing ohne Nachweis des Lieferanten, soweit er Hersteller ist (Bereitstellungsverbot § 13 Abs. 3 VerpackDG). | – (kein Feld; nur als `safety.document`) | VO (EU) 2025/40 Art. 3 Abs. 1 Nr. 15, Art. 44, 45; VerpackDG §§ 5, 6, 7, 13, 68. https://www.gesetze-im-internet.de/verpackdg/__5.html · https://www.gesetze-im-internet.de/verpackdg/__68.html |
| **D-13 Verpackung: Materialien, Eigenmarke, Konformität** | Angaben je SKU und je Sendung vollständig. | Verpackungsmaterialien und Gewichte je SKU und je Sendung; Bestätigung neutraler Produkt- und Versandverpackung ohne unsere Marke; PPWR-Konformitätserklärung oder Bestätigung, dass der Lieferant als Erzeuger sie hat. | ⚠ rechtlich unsicher – fachlich klären: Geltungsdaten einzelner PPWR-Pflichten und Sprache der Erklärung. | Kein Listing ohne Bestätigung „keine Eigenmarke“. | – (kein Feld) | VerpackDG § 13 Abs. 1, 3, 4; VO (EU) 2025/40 Art. 3, 5, 16, 21, 38, 39. https://www.gesetze-im-internet.de/verpackdg/__13.html · https://eur-lex.europa.eu/eli/reg/2025/40/oj |
| **D-14 Beilage ElektroG-Herstellerinformation (LED-Streifen)** | Druckvorlage vorhanden; Zusage vorhanden. | Zusage, jedem Paket unser ElektroG-Informationsblatt (Druckvorlage von uns, Inhalt nach `PL-13`) beizulegen. | Prüfung in der Testbestellung. | Kein Listing des LED-Streifens. | – (kein Feld) | ElektroG § 18 Abs. 4. https://www.gesetze-im-internet.de/elektrog_2015/__18.html |

---

## 5. Zahlungsbedingungen

**Bezug zur Finanzierungsprüfung:** Muss eine Vorfinanzierung angenommen werden, meldet `funding.ts` bei
`FUNDING.verified = false` „Vorfinanzierung nötig – verfügbare Mittel nicht nachgewiesen“ (bei unbekannten Kosten
„Kosten unbekannt“). „Keine Vorfinanzierung“ gilt nur bei einem per Nachweis (in `evidence.json`) bestätigten, sofort
nutzbaren Zahlungsziel ≥ Auszahlungsdauer **und** einem Nachweis `payment.requiresBusinessVerification = false`. Ein
bestätigtes `true` (Zahlungsziel an Gewerbe-/USt-Prüfung geknüpft) führt weiter zur Vorfinanzierung. Alles andere gilt
für die Einkaufssperre als `vorkasse`. `FUNDING.verified` wird nur per Code-Änderung mit
Review und echtem Kontonachweis geändert – nicht im Onboarding.

| ID · Anforderung | 🤖 Automatisch prüfbar | 📨 Beim Lieferanten anfordern | 👤 Menschliche Prüfung | ⛔ Sperre bei Fehlen | Nachweisfeld | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- | --- |
| **Z-01 Zahlungsbedingungen schriftlich** | Wert eindeutig (Vorkasse oder Zahlungsziel in ganzen Tagen); Abgleich mit Preislistenspalte. | Zahlungsbedingungen schriftlich: Vorkasse oder Zahlungsziel, Voraussetzungen (Gewerbe-/USt-Prüfung), Kreditrahmen, Zahlungsarten (SEPA), Skonto, Verrechnung von Gutschriften. | Bewertung; Liquiditätsplanung (bei Vorkasse zahlen wir vor Ablauf der Widerrufsfrist). | Ohne Beleg: Vorfinanzierung angenommen; Einkaufssperre `vorkasse`; kein `NACHWEISE GEPRÜFT`. | `payment.terms`, `payment.requiresBusinessVerification` | § 271a Abs. 1 BGB; Art. 3 Abs. 3, 5 RL 2011/7/EU. https://www.gesetze-im-internet.de/bgb/__271a.html |
| **Z-02 Guthabenkonto / Vorkasse-Regeln** | Regeln vorhanden (Verrechnung, Rückzahlung bei Vertragsende, Absicherung). | Schriftliche Regeln für Guthaben bzw. Vorkasse. | Kein ungesichertes hohes Guthaben; Bonität (`L-08`). | Keine Freigabe (S5). | – | wie Z-01 |
| **Z-03 Bankdaten verifizieren** | Abgleich IBAN-Kontoinhaber mit Registername (Plausibilität). | Bankverbindung auf Firmenbriefpapier. | **Rückruf unter einer unabhängig bekannten Nummer** (nicht aus derselben E-Mail); Änderungen der Bankdaten immer erneut verifizieren. | Keine Freigabe (S5). | – | Sorgfalt (Recherche „Zahlungsbedingungen“). https://www.gesetze-im-internet.de/bgb/__271a.html |
| **Z-04 Rechnungsangaben** | Musterrechnung auf Pflichtangaben prüfen: beide Namen/Anschriften, beide USt-IdNr., Datum, fortlaufende Nummer, Menge, Bezeichnung (sinnvoll: GTIN und Lieferanten-Artikelnummer), Lieferdatum, Entgelt, Hinweis auf Steuerbefreiung; Ausstellung bis 15. des Folgemonats. | Musterrechnung, Rechnungsrhythmus, Format (PDF/XML), Währung EUR. | ⚠ rechtlich unsicher – fachlich klären: mögliche E-Rechnungspflicht im Sitzstaat (z. B. polnisches KSeF). Rechnungen aufbewahren, nicht im Repository. | Keine Freigabe (S5). | – | Art. 219a, 222, 223, 226 MwStSystRL; § 14b UStG, § 147 AO. https://eur-lex.europa.eu/eli/dir/2006/112/oj |
| **Z-05 Steuerfreie innergemeinschaftliche Lieferung** | Unsere und die Lieferanten-USt-IdNr. auf Rechnung/Vertrag vorhanden und bestätigt (`L-02`). | Bestätigung, dass der Lieferant steuerfrei unter unserer USt-IdNr. abrechnet und in seiner Zusammenfassenden Meldung meldet. | ⚠ rechtlich unsicher – fachlich klären (Steuerberater): Erwerbsbesteuerung in DE; bei Kleinunternehmerstatus (§ 19 UStG) andere Behandlung. Ohne unsere USt-IdNr. droht ausländische USt ohne Vorsteuerabzug. | Keine Freigabe (S5). | – | Art. 138 Abs. 1 lit. b, Abs. 1a MwStSystRL; § 1a, § 3d Satz 1, § 6a Abs. 1 Satz 1 Nr. 4, § 15 Abs. 1 Satz 1 Nr. 3 UStG. https://www.gesetze-im-internet.de/ustg_1980/__6a.html |
| **Z-06 Reihengeschäft: Lieferant versendet im eigenen Namen** | Klausel vorhanden. | Schriftlich: Der Lieferant beauftragt und bezahlt den Transport im eigenen Namen (Carrier-Vertrag auf den Lieferanten). | ⚠ rechtlich unsicher – fachlich klären (Steuerberater): Kette vor der ersten echten Bestellung prüfen lassen, insbesondere wer Versandlabels erzeugt und den Carrier bezahlt. Keine ausländische USt-IdNr. gegenüber dem Lieferanten verwenden. | Keine Freigabe (S5). | – | § 3 Abs. 6a Sätze 1, 2, 4, 5 UStG; § 3 Abs. 7 Satz 2 Nr. 2 UStG; Abschn. 3.14 UStAE; Art. 36a MwStSystRL. https://www.gesetze-im-internet.de/ustg_1980/__3.html |
| **Z-07 Kein OSS-Wechsel ohne Steuerberater** | Änderung des Versandmodells erkennen (eigener Carrier, eigenes Lager, Verkauf in andere EU-Länder) und als Sperrgrund melden. | – | Steuerberater vor jeder Modelländerung. | Änderung des Versandmodells bleibt gesperrt bis zur Klärung. | – | § 3c, § 18j UStG; § 3 Abs. 6a Sätze 4, 5 UStG; Art. 369a ff. MwStSystRL. https://www.bzst.de/DE/Unternehmen/Umsatzsteuer/One-Stop-Shop_EU/one_stop_shop_eu_node.html |
| **Z-08 Rückbuchungen und Nichtlieferung** | Nachweisfrist in Tagen vorhanden. | Klausel: Tracking, Zustellnachweis (ggf. Unterschrift/Abstellort) in fester Frist; Erstattung oder Nachlieferung bei Verlust ohne Zustellnachweis. | Streitfälle bei Zahlungsanbietern selbst fristgerecht bearbeiten. | Keine Freigabe (S5). | `fulfillment.tracking` | § 311 Abs. 1, § 447, § 475 Abs. 2 BGB; Art. 67 CISG. https://www.gesetze-im-internet.de/bgb/__447.html |
| **Z-09 Verzug nach anwendbarem Recht** | – | – | Verzugsfolgen hängen vom Vertragsstatut ab (deutsches Recht: 9 Prozentpunkte über Basiszinssatz und 40 EUR). Bei polnischem, tschechischem oder niederländischem Recht: dortige Umsetzung der RL 2011/7/EU, mindestens 8 Prozentpunkte über dem Referenzzinssatz und mindestens 40 EUR Pauschale. Die 60-Tage-Grenze (§ 271a BGB, Art. 3 Abs. 5 RL 2011/7/EU) schützt den Lieferanten als Gläubiger. Für uns zählt sie nur, weil längere Zahlungsziele unwirksam sein können. | – (Hinweis) | – | § 288 Abs. 2, 5 BGB; Art. 2 Nr. 6, Art. 3, Art. 6 RL 2011/7/EU. https://www.gesetze-im-internet.de/bgb/__271a.html |

---

## 6. Produktsicherheit je Kategorie

### 6.0 Nachweisfelder und ehrliche Grenzen

Die Nachweisdatei `.data/suppliers/evidence.json` kennt heute diese Felder (`EVIDENCE_FIELDS` in
`src/lib/suppliers/import/evidence.ts`): `identity.match`, `identity.gtin`, `safety.ceMarking`,
`safety.euResponsiblePerson`, `safety.safetyInformationDe`, `safety.document`, `pricing.*`, `fulfillment.*`,
`dropshipping.*`, `payment.terms`, `payment.requiresBusinessVerification`, `reliability.sampleTested`.

- **Eigene Sperrwirkung** haben `safety.ceMarking` (nur wenn das Produkt `ceRequired` hat), `safety.euResponsiblePerson`
  und `safety.safetyInformationDe`: Fehlen sie oder sind sie nur angegeben, wird das Angebot mit `safety_unclear`
  ausgeschlossen.
- **`safety.document`** (Text bis 300 Zeichen) wird gesammelt. Als **Pflichtunterlage** zählt es nur, wenn der Text mit
  einem Namen aus `requiredDocuments` des Produkts **beginnt** (`hasDocument` in `dashboard.ts`). Heute gibt es diese
  Namen nur für die Demo-Produkte: `Konformitätserklärung`, `Prüfbericht Funk/EMV (RED)`, `WEEE-Registrierungsnummer`,
  `Herstellerangaben (GPSR)`, `Warnhinweis Magnete/Kleinteile`, `Konformität Lebensmittelkontakt (LFGB/EU 1935/2004)`,
  `Kompatibilitätsangaben ohne Markenverletzung`. Offene Pflichtunterlagen verhindern `NACHWEISE GEPRÜFT`, **schließen das
  Angebot aber nicht aus** und sperren die Kalkulationsbasis nicht.
- **Kein eigenes Feld** haben u. a.: Rolle des Lieferanten, RoHS, Cybersicherheit, Ökodesign/EPREL, Batterie,
  LUCID, REACH-Prüfberichte, Lebensmittelkontakt-Einzelnachweise, Markenrecht, Versicherung, AV-Vertrag. Sie können als
  `safety.document` mit sprechendem Text erfasst werden, haben aber erst Sperrwirkung, wenn ihre Namen in
  `requiredDocuments` des echten Produkts stehen (Entwicklungsschritt, siehe 7.3). Bis dahin sperrt der **Mensch**
  (Prozessregel, nicht Code): keine Freigabe S5 → kein Shopify-Entwurf, kein Listing. Die Compliance-Stufe ist heute
  nur eine Dry-Run-Anzeige und sperrt keine Entwurfsanlage (siehe Legende „kein Listing“).

In den Tabellen: Spalte „Feld“ = Nachweisfeld bzw. Vorschlag für einen `requiredDocuments`-Namen (*kursiv* = heute
noch nicht im Code vorhanden).

### 6.1 Allgemein (GPSR) – gilt für alle fünf Produkte

> **Hinweis LED-Streifen (Harmonisierungsrecht):** Für den LED-Streifen (RED 2014/53/EU, RoHS, für das Netzteil
> LVD/EMV) gilt Kapitel II GPSR nur für Risiken, die das Spezialrecht nicht abdeckt (Art. 2 Abs. 1 UAbs. 3 lit. a).
> Art. 8–18 GPSR gelten nur, soweit das Spezialrecht keine Bestimmungen mit gleichem Ziel enthält (Art. 2 Abs. 1
> UAbs. 3 lit. b). Die Händlerprüfung richtet sich dort nach RED Art. 13, die Kennzeichnung nach RED Art. 10 Abs. 6–9
> und Art. 12 Abs. 3 (siehe `PL-01` bis `PL-06`). Art. 19, Art. 20 und Art. 35–37 GPSR gelten voll. Quelle:
> https://gesetze.legal/eu/vo_eu_2023_988/2

| ID · Nachweis | 🤖 | 📨 | 👤 | ⛔ | Feld | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- | --- |
| **PA-01 Rolle je SKU dokumentiert** | Vollständigkeit der Rollenerklärung (`L-03`). | Rollenerklärung je Artikel. | Plausibilität. | Kein Listing. | *Rolle Lieferant (GPSR)* als `safety.document` | VO (EU) 2023/988 Art. 3 Nr. 8–12, Art. 4, Art. 12, Art. 19. https://gesetze.legal/eu/vo_eu_2023_988/3 |
| **PA-02 Verantwortlicher Wirtschaftsakteur in der EU** | Name, Handelsname/Marke, Postanschrift, elektronische Adresse vorhanden; Anschrift in einem EU-Staat. | Angaben je Produkt; Foto oder Muster des Labels mit Anbringungsort. | Abgleich mit Label am Muster. | `safety_unclear` (Angebot ausgeschlossen); kein Listing. | `safety.euResponsiblePerson` | VO (EU) 2023/988 Art. 16 Abs. 1–3, Art. 19 lit. b; VO (EU) 2019/1020 Art. 4. https://gesetze.legal/eu/vo_eu_2023_988/16 |
| **PA-03 Kennzeichnung am Produkt (Vorab-Prüfung)** | Fotos vorhanden (Typenschild/Label, Verpackung); Modell- oder Chargennummer im Foto lesbar (OCR nur als Hinweis). | Je SKU Fotos von Typenschild/Label, Verpackung, Beipackzettel; bei Kennzeichnung nur auf Verpackung eine Begründung. | Prüfen: Identifikationsmerkmal, Hersteller- und ggf. Einführerangaben auf dem Produkt (Verpackung/Beilage nur, wenn am Produkt nicht möglich). | Kein Listing; Art. 12 Abs. 3: bei Zweifel nicht bereitstellen. Als Pflichtunterlage im Code heute nur bei Laptopständer, Kabelorganizer, Trinkflasche und Armbändern hinterlegt; beim LED-Streifen sperrt das Fehlen nur per Prozess (Mensch). | `safety.document`: `Herstellerangaben (GPSR) …` | VO (EU) 2023/988 Art. 12 Abs. 1–3 i. V. m. Art. 9 Abs. 5–7, Art. 11 Abs. 3–4; § 28 Abs. 2 Nr. 21 ProdSG. https://gesetze.legal/eu/vo_eu_2023_988/12 |
| **PA-04 Anleitung und Sicherheitsinformationen auf Deutsch** | PDF vorhanden, Sprache Deutsch (Spracherkennung als Hinweis). | Deutsche Bedienungs- und Sicherheitsanleitung als PDF und gedruckt; Zusage, dass sie jeder Sendung beiliegt. | Inhalt fachlich prüfen; Testbestellung. | `safety_unclear` (Angebot ausgeschlossen); kein Listing. | `safety.safetyInformationDe` | § 6 Nr. 1–5 ProdSG (in Kraft seit 19.2.2026); Art. 9 Abs. 7, Art. 11 Abs. 4 GPSR. https://www.buzer.de/6_ProdSG.htm |
| **PA-05 Technische Unterlagen und Risikoanalyse** | Bestätigung vorhanden und unterschrieben. | Bestätigung, dass technische Unterlagen und Risikoanalyse existieren und Behörden vorgelegt werden; Kopie oder Zusammenfassung der Risikoanalyse und Prüfberichte je Produkt. | Inhalt grob plausibilisieren (wir müssen sie nicht führen). | Kein Listing. | *Risikoanalyse (GPSR)* als `safety.document` | VO (EU) 2023/988 Art. 9 Abs. 2–3, Art. 11 Abs. 6, Art. 15 Abs. 1–2, Art. 16 Abs. 2. https://gesetze.legal/eu/vo_eu_2023_988/9 |
| **PA-06 Pflichtangaben im Online-Angebot** | Vollständigkeit der strukturierten Produktdaten (Hersteller, ggf. verantwortliche Person, Abbildung, Produktart, Identifikator, Warnhinweise DE). | Strukturierte Produktdaten je SKU (`C-17`); Fotos mit Nutzungsrechten. | Shopify-Metafelder für diese Angaben anlegen und vor Veröffentlichung prüfen (heute nicht vorhanden und nicht in der Schreib-Positivliste). ⚠ rechtlich unsicher – fachlich klären: ob Angaben per Link/Klick genügen (Kommissions-Leitlinien nicht ausgewertet). | Kein Listing. | – | Art. 19 lit. a–d GPSR; § 6 Nr. 3 ProdSG; § 28 Abs. 2 Nr. 26 ProdSG. https://gesetze.legal/eu/vo_eu_2023_988/19 |
| **PA-07 Produktidentifikator** | Siehe Abschnitt 7 (Prüfziffer, GS1). | Modell-/Typnummer wie auf dem Produkt (**gesetzlich verlangt** als Identifikationsmerkmal) **und** GTIN je Variante (**intern verlangt**, keine gesetzliche GTIN-Pflicht). | Abgleich GTIN, Modellnummer, Label-Foto (`G-05`); Nachweis `identity.gtin` erst nach Abschluss von `G-05`. ⚠ rechtlich unsicher – fachlich klären: ob die GTIN allein genügt – bis dahin beides angeben. | Keine Zuordnung zum Produkt; `identity_unconfirmed`. | `identity.gtin`, `identity.match` | Art. 9 Abs. 5, Art. 19 lit. c GPSR. https://gesetze.legal/eu/vo_eu_2023_988/19 |
| **PA-08 Rückverfolgbarkeit** | Bezugsquelle je SKU dokumentiert; Aufbewahrungsort außerhalb des Repositorys. | Charge/Los je Sendung (`D-05`). | Ablage 6 bzw. 10 Jahre sicherstellen. | Keine Freigabe (S5). | – | Art. 15 Abs. 2–5 GPSR; § 28 Abs. 2 Nr. 18, 22 ProdSG. https://gesetze.legal/eu/vo_eu_2023_988/15 |
| **PA-09 Gefährliches oder nicht konformes Produkt** | Safety-Gate-Abfrage zu Marke/Modell (öffentliches Portal; maschinenlesbarer Zugang vorab prüfen) – Treffer = Sperre und Meldung an Mensch. **[Schnittstelle vorab prüfen; bis zur Freigabe nur Web-Oberfläche]** | Informationspflicht des Lieferanten (`L-05`). | Hersteller/Einführer informieren, Korrekturmaßnahmen sicherstellen, Meldung über das Safety Business Gateway; Zugang vorab klären. ⚠ rechtlich unsicher – fachlich klären: wer intern das Gateway-Konto führt. | Sofort: kein Listing bzw. Verkaufsstopp durch Mensch (Prozess). Heute keine Code-Sperre für importierte Angebote (kein Nachweisfeld, `openIssues` immer leer); `safety_issue` ist nur bei Demo-Angeboten strukturell möglich. Ein Feld für bekannte Sicherheitsprobleme wäre ein eigener Entwicklungsschritt. | – | Art. 12 Abs. 4, Art. 27 GPSR. https://gesetze.legal/eu/vo_eu_2023_988/12 |
| **PA-10 Unfälle** | Stichwörter in Kundenanfragen als Hinweis markieren (Entscheidung durch Mensch). | Vertragliche Regelung, wer in welcher Frist meldet; Kontakt für Unfallmeldungen. | Kundenservice schulen, unverzüglich an Hersteller weiterleiten. | Keine Freigabe (S5) ohne Regelung. | – | Art. 20 Abs. 1–4 GPSR. https://gesetze.legal/eu/vo_eu_2023_988/20 |
| **PA-11 Internes Produktsicherheitsverfahren** | Existenz und Datum des internen Handbuchs. | – | Kurzes Handbuch: Onboarding-Checkliste, Musterprüfung, Beschwerdeerfassung, Rückruf- und Meldeablauf, Verantwortliche. | Keine Freigabe (S5) ohne Handbuch. | – | Art. 14, Art. 3 Nr. 13 GPSR. https://gesetze.legal/eu/vo_eu_2023_988/14 |
| **PA-12 Rückruf: Verbraucherinformation und Abhilfe** | – | Zusage, Rückrufanzeigen und Kundeninformationen bereitzustellen und Kosten bei Herstellermangel zu tragen; Kostentragung für Ersatz, Erstattung, Rücksendelabels. | Shopify-Bestelldaten so halten, dass Käufer je SKU/Charge ermittelt werden können (DSGVO); Regress vertraglich absichern. | Keine Freigabe (S5). | – | Art. 35 Abs. 1, 4, Art. 36 Abs. 1–3, Art. 37 Abs. 1–5 GPSR; DVO (EU) 2024/1435. https://gesetze.legal/eu/vo_eu_2023_988/36 |
| **PA-13 Muster- bzw. Wareneingangsprüfung** | Checkliste vollständig ausgefüllt, Datum, Fotos vorhanden. | Möglichst physisches Muster vor dem Go-live. | Dokumentierte Prüfung je SKU (S4). Gesetz verlangt nur, dass wir uns „vergewissern“; das Muster ist Empfehlung. | Hinweis „Geprüftes Muster fehlt“; kein Listing bis S4. | `reliability.sampleTested` | Art. 12 Abs. 1–3 GPSR. https://eur-lex.europa.eu/eli/reg/2023/988/oj/deu |

Hinweis Sanktionen: Seit 19.2.2026 enthält § 28 Abs. 2 ProdSG 32 Bußgeldtatbestände (bis 10.000 EUR, in Fällen des
Abs. 3 bis 100.000 EUR), § 29 ProdSG Strafvorschriften (https://www.buzer.de/28_ProdSG.htm). Vor Go-live die interne
GPSR-Checkliste je SKU abhaken. ⚠ rechtlich unsicher – fachlich klären: Ob eine EU-Änderung der GPSR (z. B. im
Rahmen eines Omnibus-Pakets) beschlossen ist, wurde nicht verifiziert.

### 6.2 LED-Lichtstreifen 5 m mit App-Steuerung

Vorab je SKU klären: **WLAN oder nur Bluetooth? Netzteil (USB oder Stecker)? Fernbedienung mit Knopfzelle?** Davon
hängen Cybersicherheit, Netzteil-Ökodesign und Batterierecht ab. ⚠ rechtlich unsicher – fachlich klären: Lieferumfang je
SKU.

| ID · Nachweis | 🤖 | 📨 | 👤 | ⛔ | Feld | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- | --- |
| **PL-01 EU-Konformitätserklärung (RED, RoHS, ggf. Ökodesign)** | PDF vorhanden, unterschrieben, Datum, Modellnummer = SKU-Modellnummer, Normen mit Ausgabestand, Inhalte nach Anhang VI RED vollständig. | Unterschriebene EU-Konformitätserklärung je SKU; vereinfachte Erklärung (Anhang VII) liegt jedem Gerät bei. | Fachliche Prüfung der Erklärung. | `Konformitätserklärung` offen → kein `NACHWEISE GEPRÜFT`; kein Listing. | `safety.document`: `Konformitätserklärung …` | RL 2014/53/EU Art. 10 Abs. 9, Art. 18, Anhänge VI, VII; RL 2011/65/EU Art. 13. https://eur-lex.europa.eu/eli/dir/2014/53/oj/deu |
| **PL-02 CE-Kennzeichnung auf Produkt und Netzteil** | Foto vorhanden (Bildprüfung nur als Hinweis). | Fotos von Typenschild und Verpackung. | Am Muster prüfen (Händlerpflicht RED Art. 13). | `safety_unclear` (CE nicht belegt) – Angebot ausgeschlossen. | `safety.ceMarking` | RL 2014/53/EU Art. 13; VO (EU) 2023/988 Art. 2 Abs. 1. https://eur-lex.europa.eu/eli/dir/2014/53/oj/deu |
| **PL-03 Prüfberichte Sicherheit, EMV, Funk, Exposition** | Modell-, Hardware- und Firmware-Version im Bericht = SKU; Labor akkreditiert (Akkreditierung bei der zuständigen nationalen Stelle des Labors prüfen, nicht nur DAkkS) **[nur Web-Oberfläche → Mensch, datierter Screenshot]**; kein reines Modul-/Chipsatz-Zertifikat. | Prüfberichte eines akkreditierten Labors zu genau diesem Modell; Normenliste mit Ausgabestand. | Fachliche Bewertung (Prüflabor). | `Prüfbericht Funk/EMV (RED)` offen; kein Listing. | `safety.document`: `Prüfbericht Funk/EMV (RED) …` | RL 2014/53/EU Art. 3 Abs. 1 lit. a, b, Abs. 2, Art. 13, Art. 17. https://eur-lex.europa.eu/eli/dir/2014/53/oj/deu |
| **PL-04 Cybersicherheit (RED Art. 3 Abs. 3 lit. d, ggf. e)** | Bericht nach EN 18031-1/-2 (ggf. -3) vorhanden, Modell passt; Angabe zur Passwort-Einschränkung vorhanden; sonst Bescheinigung einer benannten Stelle (NANDO-Datenbank **[nur Web-Oberfläche → Mensch, datierter Screenshot]**). | Prüfbericht EN 18031 bzw. EU-Baumusterprüfbescheinigung; WLAN/Cloud oder nur Bluetooth; App-Name, Sitz von App- und Cloud-Anbieter, Datenschutzerklärung, Update-/Supportzeitraum. | ⚠ rechtlich unsicher – fachlich klären: ob ein reiner Bluetooth-Streifen ohne eigene Internetanbindung erfasst ist (Prüflabor/Hersteller). Shop-Hinweis zur Dritt-App mit Cloud klären. | Kein Listing ohne Nachweis zu lit. d (und ggf. lit. e). | *Cybersicherheit (RED)* als `safety.document` | Delegierte VO (EU) 2022/30 (gilt bis 11.12.2027); Durchführungsbeschluss (EU) 2025/138; Delegierte VO (EU) 2026/339; VO (EU) 2024/2847. https://eur-lex.europa.eu/eli/reg_del/2026/339/oj/eng |
| **PL-05 RoHS** | RoHS-Angabe in der Konformitätserklärung; Bericht zum Modell vorhanden. | RoHS-Prüfbericht (z. B. IEC 62321) oder technische Dokumentation nach EN IEC 63000 für Streifen, Controller, Netzteil, Fernbedienung. | Archivieren. | Kein Listing. | *RoHS-Nachweis* als `safety.document` | RL 2011/65/EU Art. 4, 7, 13, Anhänge II, VI; ElektroStoffV. https://eur-lex.europa.eu/eli/dir/2011/65/oj/deu |
| **PL-06 Begleitunterlagen und Kennzeichnung (RED)** | Fotos vorhanden: Typ-/Seriennummer am Gerät, Herstellerangaben, ggf. Einführer; Anleitung mit Frequenzbändern und max. Sendeleistung. | Fotos von Typenschild, Verpackung, deutscher Anleitung; Zusage zu Beilagen beim Neutralversand (`D-01`). | Prüfung am Muster. | `safety_unclear` ohne deutsche Sicherheitsinfos; kein Listing. | `safety.safetyInformationDe` | RL 2014/53/EU Art. 10 Abs. 6–9, Art. 12 Abs. 3; FuAG. https://eur-lex.europa.eu/eli/dir/2014/53/oj/deu |
| **PL-07 Ökodesign Lichtquelle** | Messbericht vorhanden (Lichtstrom, Leistung, Effizienz, Psb/Pnet ≤ 0,5 W); Foto der Verpackungsangaben. | Konformitätsbestätigung VO 2019/2020, Messbericht, Werte für 50-cm-Referenz. | ⚠ rechtlich unsicher – fachlich klären: Lichtquelle oder enthaltendes Produkt; Grenzwerte im konsolidierten Text gegenprüfen. | Kein Listing ohne Ökodesign-Nachweis. | *Ökodesign Lichtquelle* als `safety.document` | VO (EU) 2019/2020 Art. 2 Nr. 1, 4, Anhang II Nr. 1, 3, Anhang III Nr. 2 lit. c, Anhang IV. https://energy-efficient-products.ec.europa.eu/faqs-0/are-light-stripsstringschains-including-decorative-ones-and-christmas-scope-eu-ecodesign-if-yes-how_en |
| **PL-08 Energielabel und EPREL** | EPREL-Registriernummer in der öffentlichen EPREL-Datenbank nachschlagen (Modell, Registrant, Klasse) **[Schnittstelle vorab prüfen; bis zur Freigabe nur Web-Oberfläche]**; Label-Datei vorhanden. | EPREL-Nummer, Label (PNG/PDF), Link zum Produktdatenblatt, Name des Registranten; ggf. Begründung „enthaltendes Produkt“. | EPREL-Registrierung ist Pflicht des Lieferanten im Sinne von Art. 3 und 4 VO (EU) 2017/1369 (Hersteller, Bevollmächtigter oder Einführer), vor dem Inverkehrbringen – nicht unsere. Wir sind Händler (Art. 5) und stellen im Fernabsatz Label und Produktdatenblatt bereit (Label nahe am Preis, verschachtelte Anzeige zulässig). Würden wir selbst Einführer oder Lieferant, läge die Registrierung bei uns. In modellbezogener Werbung Klasse und Spektrum (Werbung ist gesperrt). ⚠ rechtlich unsicher – fachlich klären: Einstufung Lichtquelle/enthaltendes Produkt, Fundstelle im Anhang der VO 2019/2015. | Kein Listing ohne EPREL-Eintrag. | *EPREL-Eintrag* als `safety.document` | VO (EU) 2017/1369 Art. 3–6, 12; Delegierte VO (EU) 2019/2015 Art. 3, 4, Anhänge III, VII/VIII. https://eur-lex.europa.eu/eli/reg_del/2019/2015/oj/deu |
| **PL-09 Netzteil** | Datenblatt mit Effizienz-, Nulllast- und Standbywerten; Typenschild-Foto; Konformitätserklärung vorhanden. | Datenblatt, Typenschild-Foto, Konformitätserklärung, Sicherheitsprüfbericht (z. B. EN 61347-1/-2-13 oder EN 61558/EN 62368-1); Netzteil im Lieferumfang ja/nein, USB oder Stecker. | ⚠ rechtlich unsicher – fachlich klären: Einordnung eines USB-Netzteils (VO 2019/1782 oder Betriebsgerät nach VO 2019/2020). Lieferumfang korrekt auf der Produktseite. | Kein Listing. | *Netzteil-Nachweis* als `safety.document` | VO (EU) 2019/1782 Art. 1 Abs. 2 lit. d, Art. 2 Nr. 1, 7; VO (EU) 2019/2020 Anhang II; RL 2014/35/EU, 2014/30/EU, 2011/65/EU. https://eur-lex.europa.eu/eli/reg/2019/1782/oj/deu |
| **PL-10 ElektroG: Registrierung stiftung ear** | WEEE-Reg.-Nr. im öffentlichen Verzeichnis der stiftung ear auf **Marke und Geräteart** prüfen; datierten Screenshot ablegen (Web-Verzeichnis; maschinenlesbarer Zugang nicht belegt) **[nur Web-Oberfläche → Mensch, datierter Screenshot]**. Ausländische Registrierungen (z. B. PL BDO) nicht akzeptieren. Eine Registrierung des Markeninhabers ist nur ein Hinweis, keine Freigabe. | Marke auf dem Gerät, Name des Markeninhabers, WEEE-Reg.-Nr. für DE mit Geräteart; bei ausländischem Markeninhaber Name des Bevollmächtigten in DE. | ⚠ rechtlich unsicher – fachlich klären: Sind wir als Erstanbieter von EU-Ware nach § 3 Nr. 9 lit. c selbst Hersteller, auch wenn der Markeninhaber registriert ist? Schriftlich bei der stiftung ear. Im Zweifel selbst registrieren (Garantienachweis, Mengenmeldungen); Reg.-Nr. in Shop und Rechnungen. | Kein Listing, bis entweder unsere eigene WEEE-Registrierung (Marke, Geräteart, Garantienachweis nach § 7) vorliegt oder die stiftung ear schriftlich bestätigt hat, dass die Registrierung des Markeninhabers uns entlastet. | `safety.document`: `WEEE-Registrierungsnummer …` | ElektroG § 3 Nr. 9–11, § 6 Abs. 1–3, §§ 7, 8. https://www.gesetze-im-internet.de/elektrog_2015/__3.html |
| **PL-11 ElektroG: Gerätekategorie** | Kategorie/Geräteart im ear-Verzeichnis mit Lieferantenangabe vergleichen. | Kategorie und Geräteart für Streifen, Netzteil, Fernbedienung. | ⚠ rechtlich unsicher – fachlich klären: Kategorie 3 (Lampen) oder 5 (Kleingeräte/Leuchten); Netzteil und Fernbedienung separat? (stiftung ear) | Kein Listing bis geklärt (falsche Geräteart = nicht ordnungsgemäß registriert). | – | ElektroG § 2, Anlage 1, § 6 Abs. 1–2. https://stiftung-ear.de/en/topics/elektrog/producers-ar/registration/possible-obligated-parties |
| **PL-12 ElektroG: Kennzeichnung** | Fotos vorhanden: durchgestrichene Mülltonne, Marke/Hersteller auf Gerät und Verpackung. | Fotos der Kennzeichnung. | Prüfung am Muster; sind wir Hersteller, liegt die Pflicht bei uns (Marke genügt, wenn wir genau sie registrieren). | Kein Listing. | – | ElektroG § 9 Abs. 1, 2, Anlage 3; RL 2012/19/EU Art. 14 Abs. 4, Art. 15 Abs. 2. https://www.gesetze-im-internet.de/elektrog_2015/__9.html |
| **PL-13 ElektroG: Rücknahme und Information** | – | Zusage Beilage Informationsblatt (`D-14`). | Eigene Lager-/Versandfläche dokumentieren (unter 400 m²: keine Rücknahmepflicht). ⚠ rechtlich unsicher – fachlich klären: ob Flächen des Lieferanten mitzählen (IHK/stiftung ear). Infos auch im Shop. Informationsblatt nach § 18 Abs. 4 mit Rückgabepflicht, Rückgabemöglichkeiten, Löschung personenbezogener Daten, Symbol und Risiken lithiumhaltiger Batterien. Als Hersteller jährlich Angaben zur Zielerfüllung veröffentlichen, auch auf der Website. | Kein Listing ohne Informationsblatt. | – | ElektroG § 17 Abs. 1–2, § 18 Abs. 3–4, § 18a, Anlage 3a (Fassung BGBl. 2025 I Nr. 286). https://www.gesetze-im-internet.de/elektrog_2015/__18.html |
| **PL-14 Knopfzelle: EU-Batterieverordnung** | Fotos prüfen: Sammelsymbol seit 18.8.2025 Pflicht (Art. 13 Abs. 4). Auf der Zelle; ist es dort kleiner als 0,47 × 0,47 cm, ersatzweise mindestens 1 × 1 cm auf der Verpackung. Ggf. Cd/Pb nach Art. 13 Abs. 5. | Typ, Chemie, Marke der Knopfzelle; beigelegt oder eingesetzt; Fotos der Kennzeichnung; Konformitätserklärung des Batterieherstellers; Lieferung ohne Batterie möglich? Bestätigung, dass die Knopfzelle vom Endnutzer entnommen und ersetzt werden kann (Art. 11, ab 18.2.2027), und Plan für den QR-Code (Art. 13 Abs. 6, ab 18.2.2027). | Gesichert: Sammelsymbol (Art. 13 Abs. 4, 5), Entnehmbarkeit (Art. 11) und QR-Code (Art. 13 Abs. 6) ab 18.2.2027. ⚠ rechtlich unsicher – fachlich klären (nur diese Punkte): ob CE/Konformitätserklärung (Art. 17–20) für Knopfzellen schon gilt; Geltungsbeginn Art. 13 Abs. 1/3. Ohne Batterie: „Batterie nicht enthalten“. | Kein Listing mit Batterie ohne Klärung. | *Batterie-Nachweis* als `safety.document` | VO (EU) 2023/1542 Art. 3 Abs. 1 Nr. 47, Art. 6, Anhang I, Art. 11, Art. 13, Art. 55–57. https://eur-lex.europa.eu/eli/reg/2023/1542/oj/deu |
| **PL-15 Knopfzelle: BattDG-Registrierung** | Batterie-Reg.-Nr. im öffentlichen Batterieregister der stiftung ear prüfen (Marke, Kategorie Gerätebatterie); Web-Verzeichnis, maschinenlesbarer Zugang nicht belegt **[nur Web-Oberfläche → Mensch, datierter Screenshot]**. | Reg.-Nr., Name der OfH bzw. des Bevollmächtigten; sonst Marke und Chemie für unsere Registrierung. | ⚠ rechtlich unsicher – fachlich klären: ob wir als Erstbereitsteller selbst Batteriehersteller sind (voraussichtlich ja) und ob eine fremde DE-Registrierung entlastet. Sonst vor Verkaufsstart selbst registrieren, OfH beitreten; Batterie-Hinweistext in Shop und Beilage. | Kein Listing mit Batterie. | – | BattDG; VO (EU) 2023/1542 Art. 3 Abs. 1 Nr. 47, Art. 55–57, 62. https://www.umweltbundesamt.de/themen/battdg-in-kraft-getreten-uba-beleiht-erneut |
| **PL-16 Knopfzelle: Kinderschutz** | – | Nachweis gesichertes Batteriefach und Warnhinweise; Prüfbericht. | ⚠ rechtlich unsicher – fachlich klären: einschlägige Norm (z. B. EN IEC 62368-1) nicht verifiziert – Fachprüfung Elektro-/Batterierecht. | Kein Listing mit Fernbedienung. | – | VO (EU) 2023/988 Art. 9 Abs. 2 (Recherche „Technische Unterlagen“); VO (EU) 2023/1542. https://gesetze.legal/eu/vo_eu_2023_988/9 |

### 6.3 Faltbarer Aluminium-Laptopständer

Keine CE-Kennzeichnung (`ceRequired: false`), allgemeines Sicherheitsgebot der GPSR. Farbvarianten = eigene GTIN je
Variante (Abschnitt 7).

| ID · Nachweis | 🤖 | 📨 | 👤 | ⛔ | Feld | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- | --- |
| **PS-01 Risikoanalyse und Herstellerangaben** | Unterlage vorhanden, Modell passt. | Risikoanalyse bzw. Zusammenfassung nach Art. 9 Abs. 2; Herstellerangaben (`PA-02`, `PA-03`). | Plausibilität. | `Herstellerangaben (GPSR)` offen; kein Listing. | `safety.document`: `Herstellerangaben (GPSR) …` | GPSR Art. 5, Art. 6 Abs. 1 lit. a, d, Art. 8 Abs. 1, Art. 9 Abs. 2. https://eur-lex.europa.eu/eli/reg/2023/988/oj/deu |
| **PS-02 Traglast und Stabilität** | Max. Traglast angegeben; Prüfbericht/Protokoll vorhanden. | Maximale Traglast; Belastungs- bzw. Stabilitätstest (Prüfbericht oder Herstellerprotokoll); Bestätigung entgrateter Kanten. | Muster: Standfestigkeit mit 15–17-Zoll-Laptop, Kanten, Quetschstellen. ⚠ rechtlich unsicher – fachlich klären: keine produktspezifische Norm gefunden (Stand der Technik). | Kein Listing. | `reliability.sampleTested` | wie PS-01 |
| **PS-03 Anleitung und Warnhinweise auf Deutsch** | PDF vorhanden, Deutsch. | Montage- und Gebrauchsanleitung auf Deutsch (PDF und Druck). | Warnhinweise („Quetschgefahr beim Verstellen“, „max. X kg“) im Angebot. | `safety_unclear`; kein Listing. | `safety.safetyInformationDe` | GPSR Art. 9 Abs. 7; § 6 Nr. 1 ProdSG. https://eur-lex.europa.eu/eli/reg/2023/988/oj/deu |
| **PS-04 REACH-Bestätigung** | Erklärung vorhanden, Datum und Kandidatenlisten-Stand angegeben. | REACH-Bestätigung (SVHC, Anhang XVII). | Plausibilität. | Kein Listing. | *REACH-Erklärung* als `safety.document` | GPSR Art. 9 Abs. 2 (Recherche „Technische Unterlagen“); REACH Art. 33. https://gesetze.legal/eu/vo_eu_2023_988/9 |

### 6.4 Magnetische Kabelorganizer (10er-Pack)

| ID · Nachweis | 🤖 | 📨 | 👤 | ⛔ | Feld | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- | --- |
| **PM-01 Kein Spielzeug** | Produkttexte und Bilder auf Spiel-Claims, Kinderbilder, Figurenformen prüfen (Hinweis an Mensch). | Bestätigung des Verwendungszwecks (kein Spielzeug), Verpackung/Unterlagen weisen es nicht als Spielzeug aus; falls doch Spielzeug: EU-Konformitätserklärung, EN-71-Berichte, CE → eigenes Onboarding. | Einstufung; nur als Kabelmanagement/Schreibtischzubehör beschreiben, keine verspielten Varianten. | Kein Listing bei Spielzeugeinstufung ohne Spielzeug-Nachweise. | – | RL 2009/48/EG Art. 2 Abs. 1 (umgesetzt durch die 2. ProdSV), maßgeblich bis zur Geltung der VO (EU) 2025/2509 (veröffentlicht 12.12.2025, Geltung im Wesentlichen ab 1.8.2030); GPSR Art. 6 Abs. 1 lit. e, f ii. https://eur-lex.europa.eu/eli/dir/2009/48/oj |
| **PM-02 Verschluckungsrisiko Magnete** | Spezifikation vollständig (Material, Maße, Anzahl je Clip, ggf. Flussindex, Befestigungsart). | Magnetspezifikation; Befestigung (eingegossen/geklebt/gesteckt); Prüfbericht oder Bestätigung zu Fall-/Zugversuch bzw. Ablösesicherheit (angelehnt an EN 71-1); Risikoanalyse zum Verschlucken. | Muster: Lösen sich Magnete, wie groß sind sie? ⚠ rechtlich unsicher – fachlich klären: keine EU-Vorgabe für Magnete in Nicht-Spielzeug gefunden; EN 71-1 Abschnitt 4.23 nur Orientierung, nicht am Normtext geprüft. | Kein Listing bei frei zugänglichen, leicht lösbaren kleinen starken Magneten. | `reliability.sampleTested`; *Risikoanalyse Magnete* als `safety.document` | GPSR Art. 5, Art. 6 Abs. 1 lit. a, e, f ii, Art. 8 Abs. 1 lit. g. https://eur-lex.europa.eu/eli/reg/2023/988/oj/deu |
| **PM-03 Warnhinweis auf Deutsch** | Warnhinweistext vorhanden; Foto der Einzelverpackung mit Hinweis. | Herstellertext des Warnhinweises auf Deutsch; Fotos; Bestätigung, dass er auf jeder Einzelverpackung steht. | Gut sichtbar auf der Produktseite (nicht nur im Tab „Details“). ⚠ rechtlich unsicher – fachlich klären: kein gesetzlicher Pflichtwortlaut gefunden; unser Text ist Empfehlung. | `Warnhinweis Magnete/Kleinteile` offen; `safety_unclear` ohne deutsche Sicherheitsinfos; kein Listing. | `safety.document`: `Warnhinweis Magnete/Kleinteile …`; `safety.safetyInformationDe` | GPSR Art. 6 Abs. 1 lit. d, Art. 9 Abs. 7, Art. 19 lit. d; § 6 Nr. 1, 3 ProdSG. https://www.gesetze-im-internet.de/prodsg_2021/__6.html |
| **PM-04 Kunststoff-/Silikonteile: PAK, SVHC (vorsorglich)** | Bericht/Erklärung vorhanden und Material passend. | PAK-Prüfbericht bzw. SVHC-Erklärung für Silikon- oder Kunststoffteile mit Hautkontakt. | Plausibilität. | Kein Listing ohne Nachweis, sofern solche Teile vorhanden. | *REACH-Erklärung* als `safety.document` | REACH Anhang XVII Eintrag 50; Art. 33. https://eur-lex.europa.eu/eli/reg/2013/1272/oj |

### 6.5 Isolierte Edelstahl-Trinkflasche 750 ml

⚠ rechtlich unsicher – fachlich klären: Ob VO (EG) 1935/2004 im Sinne von Art. 2 GPSR als Harmonisierungsrecht gilt,
ist nicht abschließend geklärt. Sicher ist: Für mechanische, thermische und Verschluss-Risiken gilt die GPSR voll
(https://gesetze.legal/eu/vo_eu_2023_988/2).

| ID · Nachweis | 🤖 | 📨 | 👤 | ⛔ | Feld | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- | --- |
| **PF-01 Konformität Lebensmittelkontakt (Fertigartikel)** | Erklärung vorhanden, bezeichnet den Artikel; Stückliste der lebensmittelberührenden Materialien vollständig. | Bestätigung VO 1935/2004 für alle lebensmittelberührenden Teile; Stückliste (Stahlsorte, Kunststofftyp, Silikon, Dichtungen, Innenbeschichtung). | Fachliche Prüfung. | `Konformität Lebensmittelkontakt (LFGB/EU 1935/2004)` offen; kein Listing. | `safety.document`: `Konformität Lebensmittelkontakt (LFGB/EU 1935/2004) …` | VO (EG) 1935/2004 Art. 3 Abs. 1; LFGB §§ 30, 31 Abs. 1. https://eur-lex.europa.eu/eli/reg/2004/1935/oj |
| **PF-02 Kennzeichnung (Art. 15) auf Deutsch** | Fotos vorhanden: EU-Hersteller/-Verkäufer mit Anschrift, Charge/Los, Verwendungshinweise. | Fotos von Etikett, Verpackung, Boden-/Deckelprägung; fehlt Deutsch, vor Versand beilegen. | Muster prüfen; Hinweise auch im Shop. | `safety_unclear` ohne deutsche Hinweise; kein Listing. | `safety.safetyInformationDe` | VO (EG) 1935/2004 Art. 15 Abs. 1 lit. a–d, Abs. 2, 5, 7; § 10 Abs. 4 BedGgstV. https://www.gesetze-im-internet.de/bedggstv/__10.html |
| **PF-03 Rückverfolgbarkeit Lebensmittelkontakt** | Bezugsquelle dokumentiert. | Zusage Charge/Los je Versand; Name/Anschrift des Herstellers bzw. EU-Importeurs. | Rückrufprozess. | Keine Freigabe (S5). | – | VO (EG) 1935/2004 Art. 17 Abs. 1–3. https://eur-lex.europa.eu/eli/reg/2004/1935/oj |
| **PF-04 Gute Herstellungspraxis (GMP)** | Bestätigung vorhanden. | Herstellerbestätigung GMP nach VO 2023/2006; Zusage zur Vorlage der Dokumentation (Audit/Zertifikat nicht unterstellen). | – | Kein Listing. | *GMP-Bestätigung* als `safety.document` | VO (EG) 2023/2006 Art. 2, 4–7. https://eur-lex.europa.eu/eli/reg/2006/2023/oj |
| **PF-05 Kunststoffteile (VO 10/2011)** | Erklärung nach Anhang IV vorhanden, nennt Fassung VO 2025/351; Migrationsbericht mit Labor, Datum, Artikel, Verwendungsbedingungen. | Konformitätserklärung je Kunststoffteil bzw. Fertigartikel; Migrationsprüfbericht (bei Wiederverwendung Dreifachprüfung); Gebrauchshinweise für Wiederverwendungsartikel auf Deutsch. | Prüfen, ob Bedingungen (heiß, Spülmaschine, Kohlensäure) abgedeckt sind; Shop-Aussagen nur im Rahmen der Erklärung. ⚠ rechtlich unsicher – fachlich klären: Art. 14a stammt aus Sekundärquelle; Laborakkreditierung und Alter des Berichts. | Kein Listing. | *Kunststoff-Konformität (VO 10/2011)* als `safety.document` | VO (EU) 10/2011 Art. 3a, 5, 11, 12, 14a, 15, 16, Anhänge IV, V; VO (EU) 2025/351. https://eur-lex.europa.eu/eli/reg/2025/351/oj |
| **PF-06 Bisphenol-Verbot** | Erklärung nach Anhang III vorhanden und bezeichnet den Artikel („BPA-free“ genügt nicht); Herstellungsdatum/Charge vorhanden. | Konformitätserklärung nach Art. 8 Abs. 1 und Anhang III VO 2024/3190 für Kunststoff-, Silikon- und Beschichtungsteile; Herstellungsdatum bzw. Charge. | Keine Restbestände aus der Übergangszeit (Verbleib nur bis 20.07.2027). Mit „BPA-frei“ zurückhaltend. | Kein Listing. | *Bisphenol-Erklärung* als `safety.document` | VO (EU) 2024/3190 Art. 1 Abs. 2, Art. 3, Art. 8 Abs. 1, Anhang III, Art. 12; VO (EU) 2026/250; § 10 Abs. 5 BedGgstV. https://eur-lex.europa.eu/eli/reg/2024/3190/oj |
| **PF-07 Silikonteile (BfR XV)** | Bericht vorhanden, Labor, Datum, Prüfpunkte (flüchtige Bestandteile ≤ 0,5 %, Gesamtmigration, Peroxide). | Prüfbericht eines akkreditierten Labors nach BfR-Empfehlung XV; Erklärung Art. 3 VO 1935/2004. | Bewertung (BfR-Empfehlung ist unverbindlich, aber Maßstab der Überwachung). | Kein Listing. | *Silikon BfR XV* als `safety.document` | VO (EG) 1935/2004 Art. 3; LFGB § 31; BfR-Empfehlung XV. https://empfehlungen.bfr.bund.de/ |
| **PF-08 Edelstahl-Innenbehälter** | Materialzertifikat und Freisetzungsbericht vorhanden. | Stahlsorte mit Materialzertifikat; Prüfbericht Metallfreisetzung nach EDQM-Leitfaden 2024; Innenbeschichtung ja/nein. | Aussagen wie „18/8“ nur mit Beleg. ⚠ rechtlich unsicher – fachlich klären: Innenbeschichtung, Lacke oder Klebstoffe im Lebensmittelkontakt; bleihaltiges Lot am Vakuumverschluss (Lieferanten fragen). | Kein Listing. | *Edelstahl-Freisetzung* als `safety.document` | VO (EG) 1935/2004 Art. 3; LFGB § 31; CM/Res(2020)9; EDQM-Leitfaden. https://www.edqm.eu/en/metals-and-alloys-used-in-food-contact-materials-and-articles |
| **PF-09 Siloxane in Silikonteilen (SVHC)** | SVHC-Erklärung vorhanden, Listenstand angegeben. | SVHC-Erklärung gegen aktuelle Kandidatenliste (D4, D5, D6). | Prozess für Verbraucheranfragen (45 Tage, kostenlos). | Kein Listing. | *REACH-Erklärung* als `safety.document` | REACH Art. 33 Abs. 1, 2. https://eur-lex.europa.eu/eli/reg/2024/1328/oj |

### 6.6 Silikon-Uhrenarmbänder (3er-Pack)

| ID · Nachweis | 🤖 | 📨 | 👤 | ⛔ | Feld | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- | --- |
| **PU-01 Nickelfreisetzung der Metallteile** | Bericht nach EN 1811 (ggf. EN 12472) vorhanden; Labor; Datum (Richtwert: nicht älter als ca. 1–2 Jahre, Empfehlung). | Prüfbericht zu Schließe, Dorn, Adapter je Modell bzw. Charge; Materialangabe. | Bewertung. | Kein Listing von Armbändern mit Metallteilen ohne Nachweis. | *Nickel EN 1811* als `safety.document` | REACH Anhang XVII Eintrag 27. https://eur-lex.europa.eu/eli/reg/2009/552/oj |
| **PU-02 PAK** | Bericht vorhanden, 8 PAK, je Farbe/Materialcharge. | PAK-Prüfbericht (Eintrag 50) oder belastbare Konformitätserklärung mit Prüfdaten. | Bewertung. | Kein Listing. | *PAK-Nachweis* als `safety.document` | REACH Anhang XVII Eintrag 50 Abs. 5, 6. https://eur-lex.europa.eu/eli/reg/2013/1272/oj |
| **PU-03 Material und Phthalate** | Materialerklärung je Bauteil vorhanden. | Ist das Armband 100 % Silikonkautschuk? Beschichtungen, Drucke? Falls andere Polymere: Phthalat-Prüfbericht. | ⚠ rechtlich unsicher – fachlich klären: tatsächliches Material („Silikon“ ist oft TPU/TPE). | Kein Listing. | *Materialerklärung* als `safety.document` | REACH Anhang XVII Eintrag 51 Abs. 3, Abs. 5 lit. a (Fassung VO (EU) 2018/2005, gilt seit 7.7.2020). Eintrag 52 ist für Uhrenarmbänder nicht einschlägig. https://eur-lex.europa.eu/eli/reg/2018/2005/oj |
| **PU-04 SVHC / Siloxane D4–D6** | Erklärung vorhanden, Listenstand. | SVHC-Erklärung je Artikel; bei > 0,1 % je Teil-Erzeugnis Stoffname und Hinweise. | Prozess für Verbraucheranfragen (45 Tage). ⚠ rechtlich unsicher – fachlich klären: unsere Lesart, dass Eintrag 70 fertige Erzeugnisse nicht erfasst (ECHA-Q&A/Fachberatung). | Kein Listing. | *REACH-Erklärung* als `safety.document` | REACH Art. 33 Abs. 1, 2; Anhang XVII Eintrag 70; EuGH C-106/14. https://eur-lex.europa.eu/eli/reg/2024/1328/oj |
| **PU-05 Bedarfsgegenstand mit Körperkontakt** | – | Bestätigung der stofflichen Unbedenklichkeit (REACH-Berichte oben, ggf. Farbechtheit/Migration). | Muster: Geruch, Abfärben, klebrige Oberfläche (Indizien); Reklamationen erfassen. | Kein Listing. | `reliability.sampleTested` | LFGB § 2 Abs. 6 S. 1 Nr. 6, § 30 Nr. 2. https://www.gesetze-im-internet.de/lfgb/__30.html |
| **PU-06 Markenrecht bei Kompatibilitätsangabe** | Produkttexte, Alt-Texte und Bilder auf fremde Logos, „Original“, „offiziell“ prüfen (Hinweis). | Bestätigung: keine fremden Marken/Logos auf Armband, Adapter, Verpackung; verbindliche Kompatibilitätsliste; Fotos ohne Logos mit Nutzungsrechten. | Textvorlage festlegen („passend für [Marke] [Modell]“, Hinweis „kein Originalzubehör“). ⚠ rechtlich unsicher – fachlich klären: Markenname am Titelanfang (Anwalt). | `Kompatibilitätsangaben ohne Markenverletzung` offen; kein Listing. | `safety.document`: `Kompatibilitätsangaben ohne Markenverletzung …` | UMV Art. 14 Abs. 1 lit. c, Abs. 2; § 23 MarkenG; EuGH C-228/03, C-334/22. https://curia.europa.eu/jcms/jcms/p1_4273655/hr |

---

## 7. GTIN je Shopify-Variante

### 7.1 Anforderungen

| ID · Anforderung | 🤖 Automatisch prüfbar | 📨 Beim Lieferanten anfordern | 👤 Menschliche Prüfung | ⛔ Sperre bei Fehlen oder Konflikt | Rechtsgrundlage · Quelle |
| --- | --- | --- | --- | --- | --- |
| **G-01 Eine GTIN je Variante** | Jede Shopify-Variante (Farbe, Größe, Set) hat genau eine GTIN; keine GTIN für zwei Varianten. | GTIN je Variante. Die GTIN muss die verkaufte Verbrauchereinheit bezeichnen, beim Mehrfachpack (10er-Pack, 3er-Pack) also das Pack (Datenqualitätsregel nach GS1, keine Rechtsanforderung). | Bei GTIN-14 mit Indikatorziffer ungleich 0 (nach Normalisierung, `G-07`) bzw. einer Umkarton- oder Einzelteil-GTIN: Bestätigung durch Lieferant und Mensch. | Variante ohne GTIN: keine Zuordnung, kein Listing der Variante. Umkarton-/Einzelteil-GTIN statt Pack-GTIN → Sperre bis zur Bestätigung durch den Lieferanten und einen Menschen. Solange es kein Variantenmodell gibt (7.3 Schritt 1), gilt die Sperre für das **ganze Produkt**: Fehlt einer Variante die GTIN oder die Zuordnung zur Lieferanten-Artikelnummer, oder hat sie einen GTIN-Konflikt, gibt es keine Freigabe S5 für das Produkt und damit für keine Variante einen Entwurf (Prozessregel). Ausnahme nur, wenn ein Mensch die Variante vorher dokumentiert aus dem Produkt entfernt. | Interne Anforderung (Zuordnung je Variante). Keine gesetzliche GTIN-Pflicht. Art. 9 Abs. 5 und Art. 19 lit. c GPSR verlangen ein Identifikationsmerkmal bzw. Produktidentifikatoren, z. B. die Modell- oder Typnummer. Die GTIN ist möglich, aber nicht vorgeschrieben. ⚠ rechtlich unsicher – fachlich klären: ob die GTIN allein genügt. Bis dahin Modell/Typ und GTIN angeben. https://gesetze.legal/eu/vo_eu_2023_988/19 |
| **G-02 Quelle nur Hersteller/Lieferant** | Herkunft der GTIN protokolliert (Datei, Zeile, Datum). GTINs aus dem internen Bereich 200–299 sind für echte Produkte **unzulässig** (nur Demo/Test). | Echte GTIN mit GS1-Herkunft (Firmenpräfix des Markeninhabers). | – | Selbst erzeugte oder geschätzte GTIN: nie verwenden; Zeile gesperrt. | wie G-01 |
| **G-03 Prüfziffer** | Ja – heute schon im Import (`values.ts`): falsche Prüfziffer → Zeile abgelehnt. | – | – | Zeile abgelehnt. | wie G-01 |
| **G-04 GS1-Prüfung** | GTIN über Verified by GS1 bzw. GEPIR abfragen (Lizenzinhaber, Marke, ggf. Produktdaten); Nutzungsbedingungen und Zugang vorab prüfen; heute nicht angebunden (Netzwerkzugriff ist gesperrt) **[Schnittstelle vorab prüfen; bis zur Freigabe nur Web-Oberfläche]**. | – | Bei Abweichung Lizenzinhaber ↔ Marke: Rückfrage. | Abweichung: Sperre bis Klärung. | Sorgfalt (Recherche „Produktidentifikator“). https://gesetze.legal/eu/vo_eu_2023_988/19 |
| **G-05 Abgleich Modell/Typ, Foto, Marke** | Vergleich GTIN ↔ Herstellerartikelnummer ↔ Marke ↔ Bezeichnung zwischen Preisliste, Produktdaten und Label-Foto (OCR nur Hinweis). | Modell-/Typnummer wie auf dem Produkt; Label-Foto je Variante. | Abgleich am Foto bzw. Muster; Ergebnis als `identity.match` = `exact`. Ein Nachweis `identity.gtin` darf erst angelegt werden, wenn G-05 abgeschlossen ist (GTIN, Herstellerartikelnummer bzw. Typ, Marke und Label-Foto stimmen überein; Name und Datum dokumentiert). Der Agent bereitet keinen Entwurf für `identity.gtin` vor, solange G-05 offen ist. ⚠ rechtlich unsicher – fachlich klären (`O-03`): Bis dahin gilt die GTIN allein nicht als Identitätsnachweis. | `identity_unconfirmed` bzw. `identity_mismatch` (ausgeschlossen). Achtung Code: Ein bestätigter Nachweis `identity.gtin`, der zur Produkt-GTIN passt, hebt `identity_unconfirmed` schon auf, auch ohne `identity.match = exact` (`eligibility.ts`) – daher die Reihenfolge oben. | Art. 9 Abs. 5 GPSR. https://gesetze.legal/eu/vo_eu_2023_988/19 |
| **G-06 Zuordnung Shopify-SKU ↔ GTIN ↔ Lieferanten-Artikelnummer** | Zuordnungstabelle vollständig, jede Beziehung 1 : 1. | Lieferanten-Artikelnummer je Variante. | Zuordnung bestätigen. | Lücke: `variantsWithoutSupplierSku` (Kopplung offen) – nur Anzeige, keine Code-Sperre; keine Automatisierung. Lücke = keine Freigabe S5 für das Produkt (ganzes Produkt gesperrt, siehe `G-01`). | Vertraglich (§ 311 Abs. 1 BGB). https://www.gesetze-im-internet.de/bgb/__311.html |
| **G-07 Dubletten und Konflikte** | Vor jedem Vergleich alle GTINs auf 14 Stellen mit führenden Nullen normalisieren. Konflikt = dieselbe GTIN für verschiedene Artikelnummern oder Varianten **desselben** Lieferanten, oder dieselbe GTIN für verschiedene Shopify-Varianten; außerdem: eine SKU mit mehreren GTINs; Shopify-Barcode ≠ Lieferanten-GTIN; GTIN-Änderung in neuer Preisliste. Dieselbe GTIN bei verschiedenen Lieferanten ist zulässig, braucht aber je Angebot einen eigenen Nachweis. Im Import heute nur Hinweis „mögliche Dublette“ (gleiche GTIN, gleicher Lieferant, verschiedene Artikelnummern), keine Sperre. | Klärung durch Lieferant. | Entscheidung. | Alle betroffenen Varianten gesperrt – solange es kein Variantenmodell gibt, das ganze Produkt (siehe `G-01`); GTIN-Änderung = Artikeländerung, frühere Identitäts-, Sicherheits- und Musternachweise gelten nicht mehr. Erscheint der Hinweis „mögliche Dublette“ im Testlauf, meldet der Agent Sperrgrund G-07. Er schlägt keine Übernahme mit `--apply` vor, bis ein Mensch den Konflikt mit dem Lieferanten geklärt hat. | wie G-01 |

### 7.2 Was der heutige Code kann – und was nicht

- **Eine GTIN je Produkt:** `DEMO_QUERIES` in `src/lib/suppliers/demo/demo-suppliers.ts` hat je Produkt **eine** GTIN
  (Platzhalter aus Bereich 200). Angebote werden **nur über diese GTIN** zugeordnet (`priceListQuotesFor`). Eine
  importierte Zeile für eine andere Variante (andere GTIN) erscheint bei **keinem** Produkt.
- **Echte GTINs werden heute nicht bewertet:** Der Code kennt nur die Platzhalter-GTINs der Demo-Produkte. Echte GTINs
  werden im Testlauf als „unbekannte GTIN – gespeichert, aber nicht bewertet“ gemeldet und erscheinen auf
  `/lieferanten` bei keinem Produkt (nur in der Zählung „ohne Produktzuordnung“). Eine Bewertung echter Angebote setzt
  Entwicklungsschritt 7.3 Nr. 1–2 voraus (echte Produkt-Stammdaten mit echter GTIN in `.data/`).
- **Nachweise je GTIN:** `evidence.json` bindet jeden Nachweis an `offerKey` + `productGtin`. Für Varianten mit eigener
  GTIN bräuchte jede Variante eigene Nachweise – der Scout wertet heute aber nur die Produkt-GTIN aus.
- **Shopify-Varianten** haben SKUs (`src/lib/shopify/listings.ts`, z. B. `DEMO-STAND-SLV`, `DEMO-STAND-GRY`), aber
  keine GTIN.
- **Kein Barcode-Lesen:** Die Shopify-Leseabfrage (`src/lib/shopify/graphql.ts`) liest das Feld `barcode` nicht.
- **Keine Zuordnung SKU → Lieferanten-Artikelnummer:** `supplierSkuByShopifySku` in `src/lib/suppliers/links.ts` ist
  vorgesehen, aber leer; die Lücke wird als `variantsWithoutSupplierSku` angezeigt.
- **Kein automatisches Schreiben:** Barcode-Schreiben ist **nicht** in der Shopify-Schreib-Positivliste
  (`src/lib/shopify/write-operations.ts`). GTINs kommen heute nur **manuell** nach Shopify. Eine automatische Pflege
  bräuchte eine eigene, ausdrückliche Freigabe.
- **Prüfziffer und Dubletten im Import:** Prüfziffer: Fehler → Zeile abgelehnt (`values.ts`). Dieselbe
  Lieferanten-Artikelnummer mit widersprüchlichen Werten → abgelehnt (`plan.ts`). Dieselbe GTIN unter verschiedenen
  Artikelnummern → **nur Hinweis, keine Sperre im Code**.
- **Keine GTIN-Normalisierung:** Der Import ergänzt nur 12 Stellen zu 13; eine 14-stellige GTIN mit führender Null
  und dieselbe GTIN-13 gelten im Code als verschieden. Vergleiche nach `G-07` daher heute manuell normalisieren.
- **Keine Sperre je Variante:** Ein Shopify-Entwurf enthält alle Varianten aus `listings.ts`; einen Filter je Variante
  nach GTIN oder Konflikt gibt es nicht. Variantensperren wirken deshalb heute nur auf das ganze Produkt (`G-01`).

### 7.3 Entwicklungsschritte für die Automatisierung (nur Plan, nicht umgesetzt)

1. **Variantenmodell:** `ProductQuery` um Varianten erweitern (je Variante GTIN, Shopify-SKU, Variantenmerkmal);
   Zuordnung im Scout je Varianten-GTIN statt je Produkt.
2. **Echte Produkt-Stammdaten** getrennt von den Demo-Daten (lokal in `.data/`, nicht im Repository), inkl.
   produktspezifischer `requiredDocuments`-Namen aus Abschnitt 6 (z. B. EPREL, Batterie, REACH), damit fehlende
   Unterlagen sichtbar sperren.
3. **Zuordnungsdatei** Shopify-SKU ↔ GTIN ↔ Lieferanten-Artikelnummer in `.data/suppliers/` und Befüllung von
   `supplierSkuByShopifySku`.
4. **Konfliktprüfung** (`G-07`) als reine Funktion mit Tests: Dubletten, Mehrfach-GTIN, Bereich 200–299 bei echten
   Produkten, GTIN-Änderungen → Sperre mit Grund.
5. **Shopify-Leseabfrage** um `barcode` erweitern (nur lesen) und Abgleich Shopify-Barcode ↔ Lieferanten-GTIN als
   Abweichungsmeldung (wie die Kostenabweichung).
6. **Import erweitern:** optionale Spalten für Variantenmerkmal, Modell-/Typnummer und GPSR-Produktdaten (`C-17`),
   weiterhin als „vom Lieferanten angegeben“.
7. **Nachweise je Variante:** `evidence.json` je Varianten-GTIN auswerten; Sammelnachweise für alle Varianten nur,
   wenn ein Mensch sie ausdrücklich je GTIN einträgt.
8. **GS1-Abfrage** als eigener Adapter erst nach Netzwerk- und Kostenfreigabe (`paid`/`network`, Sicherheitstest
   `NETWORK_ALLOWED`) und Prüfung der Nutzungsbedingungen.
9. **Barcode-Schreiben in Shopify** nur als eigener Auftrag mit eigener Freigabe und Erweiterung der Positivliste –
   nicht Teil dieses Onboardings.

---

## 8. Erste echte Preisliste – nur im Testlauf

Befehle unter **Windows-PowerShell** mit `npm.cmd` (unter PowerShell kann `npm` durch die Ausführungsrichtlinie
blockiert sein). Pfade in Anführungszeichen.

1. **Datei außerhalb des Repositorys ablegen**, z. B. in einem internen Ordner wie
   `D:\Intern\Lieferanten\<lieferant>\preisliste-<datum>.csv` (Beispielpfad). Nie in den Projektordner außer
   `.data/suppliers/`, nie in Git, nie per Chat an Dritte.
2. **Kodierung prüfen:** UTF-8. Bei Excel-Export „CSV UTF-8“ wählen.
3. **Testlauf** (schreibt nichts):
   ```powershell
   npm.cmd run suppliers:import -- "D:\Intern\Lieferanten\<lieferant>\preisliste-<datum>.csv"
   ```
   Bei abweichenden Spaltenköpfen zusätzlich eine Zuordnungsdatei (ebenfalls außerhalb des Repositorys):
   ```powershell
   npm.cmd run suppliers:import -- "D:\Intern\...\preisliste.csv" --mapping "D:\Intern\...\zuordnung.json"
   ```
4. **Testlauf lesen:** Strukturfehler (Datei wird nicht übernommen), abgelehnte Zeilen mit Grund, ignorierte Spalten,
   Hinweise (fehlende Angaben, Alter der Liste, unbekannte GTIN, mögliche Dublette → Sperrgrund `G-07`), Dubletten,
   Änderungen je Feld, **Bestätigungscode**. `offerKey` erscheint im Testlauf nur bei Zeilen mit Hinweis oder Fehler und
   bei geänderten Angeboten. Sonst ergibt er sich als `<Lieferanten-Kennung>::<Lieferanten-Artikelnummer>` (Kennung =
   Lieferantenname klein, Umlaute umgeschrieben, Sonderzeichen → `-`). Fehler an den Lieferanten zurückgeben, nicht
   selbst korrigieren oder raten.
5. **GTIN-Abgleich** je Variante nach Abschnitt 7 (welche Zeilen passen zu welchem Produkt bzw. welcher Variante?).
6. **Menschliche Freigabe** der Übernahme (Name, Datum, Testlauf-Ergebnis). Erst danach:
   ```powershell
   npm.cmd run suppliers:import -- "D:\Intern\...\preisliste.csv" --apply --confirm <CODE>
   ```
   Der Code passt nur zum genauen Dateiinhalt, zur Zuordnung, zur Testdaten-Markierung und zum aktuellen Speicherstand.
   Hat sich etwas geändert: neuer Testlauf. Nie zwei Importe gleichzeitig.
7. **Nachweise erfassen** (Mensch): Einträge in `.data/suppliers/evidence.json` mit `offerKey`, `productGtin`, `field`,
   `value`, `document`, `checkedBy`, `checkedAt` (nicht in der Zukunft), `note`. Nur aus geprüften Unterlagen der
   Abschnitte 4–6. Ein Nachweis `identity.gtin` darf erst angelegt werden, wenn `G-05` abgeschlossen ist (GTIN,
   Herstellerartikelnummer bzw. Typ, Marke und Label-Foto stimmen überein; Name und Datum dokumentiert). Der Agent
   bereitet keinen Entwurf für `identity.gtin` vor, solange `G-05` offen ist. ⚠ rechtlich unsicher – fachlich klären
   (`O-03`): Bis dahin gilt die GTIN allein nicht als Identitätsnachweis.
8. **Status prüfen:**
   ```powershell
   npm.cmd run suppliers:import -- --status
   ```
   `--status` zeigt Speicherstand, letzte Importe und verworfene Nachweise mit Grund. Widersprüche, veraltete Nachweise
   und nicht mehr aktuelle Angebote zeigt nur `/lieferanten` (Entwicklungsserver), und nur für Angebote, die einem
   Produkt zugeordnet sind. Die Kennzeichnung (`ECHTE QUELLE, UNGEPRÜFT` bzw. `NACHWEISE GEPRÜFT`, `AUSGESCHLOSSEN` mit
   Gründen) ist für echte Angebote erst nach 7.3 Nr. 2 sichtbar; bis dahin nur die Zählung „ohne Zuordnung“.
9. **Rückgängig machen** (Mensch, lokal): Den Sicherungspfad aus der Ausgabe des `--apply`-Laufs notieren („Sicherung
   des vorigen Stands: …“, Datei `.data/suppliers/backups/offers-imp-<Zeitstempel>.json` = Stand **vor** diesem
   Import). `--status` zeigt nur Datum und Dateiname des Imports, nicht die Import-ID. Aktuelle
   `.data/suppliers/offers.json` zusätzlich sichern, dann die notierte Sicherungsdatei über `offers.json` kopieren
   (spätere Importe gehen dabei verloren) und `--status` erneut prüfen.
10. **Keine Builds mit echten Daten weitergeben:** `npm run build` erzeugt `/lieferanten` statisch – Preise stünden im
    Build-Artefakt (siehe PRODUKTIONSANFORDERUNGEN.md, Punkt 2).

| Der Agent darf automatisch | Der Agent darf nie |
| --- | --- |
| Testlauf (Schritt 3) ausführen und auswerten; Kodierung, Spalten, Pflichtfelder, Prüfziffern, Dubletten, Datum, Abgleich mit Produktdaten prüfen; `--status` lesen; Entwürfe für Nachweiseinträge in einer separaten Datei vorbereiten; Sperrgründe melden. | `--apply` ausführen (auch nicht mit vorhandenem Code); `evidence.json` als geprüft befüllen; Dateien ins Repository kopieren oder committen; Preise in Chat, Issues, PRs oder Logs außerhalb von `.data/` schreiben; Sicherungen zurückspielen; Shopify schreiben; Builds mit echten Daten erzeugen und teilen. |

---

## 9. Automatische Sperrregeln (Gesamtübersicht)

| Bedingung | Sperre (Code bzw. Prozess) | Wer hebt sie auf |
| --- | --- | --- |
| Preisliste ohne Nachweis für Einkaufspreis, Versandkosten, Versandland, Lieferung nach DE, Lieferzeit oder Bestand (außerhalb EU zusätzlich Importkosten) | `price_list_unverified` → `AUSGESCHLOSSEN`, keine Kalkulationsbasis | Mensch: Nachweise in `evidence.json` nach Prüfung |
| Angebot fehlt in der neuesten Liste des Lieferanten oder wurde dort abgelehnt | `price_list_outdated` → keine Kalkulationsbasis | Lieferant: korrigierte Liste; Mensch: Testlauf und `--apply` |
| Nachweis widerspricht aktueller Preisliste (Preis, Bestand, Zahlungsbedingung geändert) | Nachweis nicht angewendet, Angabe „vom Lieferanten angegeben“ | Mensch: neu prüfen und Nachweis aktualisieren |
| Zwei Nachweise zum selben Feld mit unterschiedlichem Wert | Keiner gilt | Mensch: alten Eintrag entfernen |
| Artikeländerung (Bezeichnung, Marke, Herstellernummer, GTIN) | Identitäts-, Sicherheits- und Musternachweise bis zum Änderungstag ungültig | Mensch: erneut prüfen (ggf. neues Muster) |
| GTIN fehlt, ist unbekannt oder weicht ab | Keine Zuordnung zum Produkt bzw. `identity_mismatch` / `identity_unconfirmed` | Lieferant liefert GTIN; Mensch bestätigt `identity.match` |
| GTIN-Konflikt (Dublette, Mehrfachzuordnung, Bereich 200–299 bei Echtware) | Solange es kein Variantenmodell gibt (7.3 Schritt 1): **ganzes Produkt** gesperrt – keine Freigabe S5, für keine Variante ein Entwurf; Ausnahme nur, wenn ein Mensch die Variante vorher dokumentiert aus dem Produkt entfernt (heute Prozess; im Import nur Hinweis „mögliche Dublette“; künftig Code nach 7.3 Schritt 4) | Mensch nach Klärung mit Lieferant |
| CE (falls nötig), verantwortliche Person in der EU oder deutsche Sicherheitshinweise nicht belegt | `safety_unclear` → `AUSGESCHLOSSEN` | Mensch: Nachweise nach Abschnitt 6 |
| Bekanntes Sicherheitsproblem, Safety-Gate-Treffer, Rückruf | Prozess: Verkaufsstopp durch Mensch; Meldeablauf nach `PA-09`. Code-Sperre `safety_issue` nur bei Demo-Angeboten (für importierte Angebote kein Nachweisfeld) | Verantwortliche Person für Produktsicherheit nach Abschluss der Korrekturmaßnahmen |
| Pflichtunterlage aus `requiredDocuments` offen | Kein `NACHWEISE GEPRÜFT`, Hinweis „… fehlt“ (kein Ausschluss) | Mensch: `safety.document` mit passendem Namen |
| Unterlage ohne eigenes Feld fehlt (z. B. EPREL, Batterie, LUCID, REACH, Lebensmittelkontakt-Einzelnachweise) | Prozess (Mensch): keine Freigabe S5 → kein Shopify-Entwurf, kein Listing. Die Compliance-Stufe ist nur Dry-Run-Anzeige und sperrt keinen Entwurf | Mensch: Freigabe S5 nach Prüfung der Unterlage; eine technische Sperre gibt es erst nach einer Code-Erweiterung mit Review |
| Direktversand nicht belegt | `dropshipping_unavailable` | Mensch: Nachweis `dropshipping.supported` |
| Neutralversand, Bestellweg, Tracking nicht belegt | Hinweise; keine Freigabe S5 | Mensch: Nachweise und Testbestellung |
| Mindestabnahme erzwingt Vorratskauf | `stock_purchase_required` | Lieferant: andere Konditionen |
| Zahlungsbedingung fehlt, unbestätigt oder an Prüfung geknüpft | Vorfinanzierung angenommen; Einkaufssperre `vorkasse` | Mensch: Nachweis `payment.terms` und `payment.requiresBusinessVerification` |
| Kein Kontonachweis | `FUNDING.verified = false` → bei angenommener Vorfinanzierung „Vorfinanzierung nötig – verfügbare Mittel nicht nachgewiesen“ | Mensch per Code-Änderung mit Review und Kontonachweis – nicht im Onboarding |
| Jede Kaufentscheidung | `purchaseApproved: false`, `autoPurchaseEnabled: false` | Nur bewusste Code-Änderung mit Review – nicht im Onboarding |
| Muster nicht geprüft | Hinweis „Geprüftes Muster fehlt“; kein Listing bis S4 | Mensch nach Musterprüfung (`reliability.sampleTested`) |
| USt-IdNr. nicht bestätigt, Rolle unklar, Vertrag/AV-Vertrag/Versicherung fehlt | Keine Freigabe S5 | Mensch (ggf. mit Steuerberater/Anwalt) |
| ⚠-Punkt betrifft den Artikel und ist ungeklärt | Keine Freigabe S5 für diesen Artikel | Fachstelle (Abschnitt 10), dann Mensch |
| Änderung des Versandmodells (eigener Carrier, eigenes Lager, andere EU-Länder) | Gesperrt | Steuerberater, dann Mensch |
| Werbung, Veröffentlichung | `realAdsEnabled: false`; Veröffentlichen nicht in der Schreib-Positivliste | Nur bewusste Code-Änderung mit Review bzw. menschliche Entscheidung in Shopify – nicht im Onboarding |

---

## 10. Offene rechtliche Fragen und Unsicherheiten

| Nr. | Frage | Betrifft | Wer klärt |
| --- | --- | --- | --- |
| O-01 | Rolle des konkreten Großhändlers je Artikel (Hersteller, Einführer, Händler)? | alle | Lieferant (schriftlich), dann wir |
| O-02 | Kommissions-Leitlinien zur GPSR (November 2025) nicht ausgewertet: Fulfilment, Fernabsatz, ob Art.-19-Angaben per Link/Klick genügen | alle | IHK / Anwalt |
| O-03 | Genügt die GTIN allein als Produktidentifikator nach Art. 19 lit. c, oder zusätzlich Modell/Typ? (bis dahin beides) | alle | IHK / Anwalt |
| O-04 | Nr. 19 in § 28 Abs. 2 ProdSG im BGBl.-Text gegenprüfen; ist eine EU-Änderung der GPSR beschlossen? | alle | Anwalt |
| O-05 | Löst ein Shop-Logo nur auf dem Versandkarton die Herstellerstellung aus? Planen wir Branding? | alle | Anwalt |
| O-06 | Wer führt das Safety-Business-Gateway-Konto, wer ist intern für Unfall- und Rückrufmeldungen zuständig? | alle | Geschäftsführung |
| O-07 | WEEE: Sind wir als Erstanbieter von EU-Ware selbst Hersteller trotz Registrierung des Markeninhabers? | LED | stiftung ear (schriftlich) |
| O-08 | Gerätekategorie und Geräteart des LED-Streifens; Netzteil und Fernbedienung separat? | LED | stiftung ear |
| O-09 | Fällt ein reiner Bluetooth-Streifen unter RED Art. 3 Abs. 3 lit. d? | LED | Prüflabor / Hersteller |
| O-10 | Lichtquelle mit Energielabel/EPREL oder enthaltendes Produkt? Wer ist EPREL-Registrant? 50-cm-Referenz? Fundstellen im konsolidierten EUR-Lex-Text | LED | Hersteller / Fachberatung |
| O-11 | Einordnung eines USB-Netzteils (VO 2019/1782 oder Betriebsgerät nach VO 2019/2020)? | LED | Fachberatung |
| O-12 | ElektroG: Zählen Flächen des ausländischen Lieferanten für die 400-m²-Schwelle? | LED | IHK / stiftung ear |
| O-13 | Batterie: Sind wir für eine beigelegte Knopfzelle Batteriehersteller (voraussichtlich ja)? Entlastet eine fremde DE-Registrierung? Gelten CE/Konformitätserklärung nach Art. 17–20 BattVO schon? Geltungsbeginn der Kennzeichnung nach Art. 13 Abs. 1/3? | LED | stiftung ear / Fachberatung |
| O-14 | Kinderschutz bei Knopfzellen: einschlägige Norm (z. B. EN IEC 62368-1)? | LED | Fachprüfung Elektro-/Batterierecht |
| O-15 | Lieferumfang je SKU (USB/Stecker-Netzteil, Fernbedienung, WLAN/Bluetooth) | LED | Lieferant |
| O-16 | Verpackung: Wer ist im grenzüberschreitenden Dropshipping Hersteller der Versandverpackung (PPWR/VerpackDG)? Macht schon ein Versandlabel zum Erzeuger? Prüf- bzw. Vertriebsverbotspflichten für uns? | alle | ZSVR (schriftlich) |
| O-17 | Sind wir bereits in LUCID registriert? Wenn ja: Änderungsmeldung bis 12.11.2026; wenn nein: Neuregistrierungsfrist 12.09.2026 abgelaufen, sofort vor dem ersten Inverkehrbringen registrieren (Fristen aus Sekundärquellen zu § 68 VerpackDG, siehe `D-12`); Systembeteiligung über 31.12.2026 hinaus | alle | wir / ZSVR |
| O-18 | PPWR: Geltungsdaten einzelner Pflichten (Konformitätsbewertung, Leerraum, Kennzeichnung), Sprache der Konformitätserklärung | alle | Fachberatung / IHK |
| O-19 | Trinkflasche: Ist VO 1935/2004 Harmonisierungsrecht im Sinne von Art. 2 GPSR? | Flasche | Fachberatung |
| O-20 | Trinkflasche: Innenbeschichtung, Lacke, Klebstoffe im Lebensmittelkontakt? Bleihaltiges Lot am Vakuumverschluss? | Flasche | Lieferant / Hersteller |
| O-21 | Trinkflasche: Deckt der Migrationsbericht den Fertigartikel und die beworbenen Bedingungen ab? Alter, Labor, Akkreditierung? Art. 14a VO 10/2011 im EUR-Lex-Text gegenprüfen; Artikelnummer der Erklärungspflicht in VO 2024/3190 | Flasche | Fachberatung / Lebensmittelchemiker |
| O-22 | Magnete: Flussindex und Unlösbarkeit; EN 71-1 Abschnitt 4.23 am Normtext; gesetzlicher Warnhinweis für Nicht-Spielzeug? | Kabelorganizer | Prüflabor / Fachberatung |
| O-23 | Armbänder: tatsächliches Material (Silikonkautschuk oder TPU/TPE)? | Armbänder | Lieferant, Prüfbericht |
| O-24 | Siloxane: Erfasst Eintrag 70 Anhang XVII fertige Erzeugnisse nicht? (ECHA-Q&A) | Armbänder, Flasche | Fachberatung |
| O-25 | Markenrecht: Markenname am Titelanfang zulässig? | Armbänder | Anwalt |
| O-26 | Laptopständer: einschlägige Norm für Stabilitätsprüfung als Stand der Technik? | Laptopständer | Prüflabor |
| O-27 | Wer beauftragt und bezahlt den Carrier, erzeugen wir Versandlabels (z. B. über eine Shopify-App)? Umsatzsteuerliche Zuordnung | alle | Steuerberater |
| O-28 | Regelbesteuerung mit USt-IdNr. oder Kleinunternehmer (§ 19 UStG)? | alle | Steuerberater |
| O-29 | Akzeptiert der Lieferant deutsches Recht ohne CISG und deutschen Gerichtsstand? | alle | Lieferant / Anwalt |
| O-30 | Lieferant bei Kundenadressen Auftragsverarbeiter oder eigener Verantwortlicher? | alle | Datenschutzberater |
| O-31 | Nationale E-Rechnungspflicht im Sitzstaat (z. B. KSeF)? | alle | Steuerberater |
| O-32 | Deutsche Retourenadresse oder Rücksendung ins Ausland? | alle | Lieferant |
| O-33 | Gelangensnachweis: Welche Nachweise erwartet der Lieferant nach seinem Recht von uns? | alle | Lieferant / Steuerberater |
| O-34 | Neue Produkthaftungsrichtlinie (EU) 2024/2853: Stand der deutschen Umsetzung | alle | Anwalt |

---

## 11. Quellenverzeichnis

### Rechtsquellen (aus der geprüften Recherche)

**Produktsicherheit (GPSR, ProdSG)**
- VO (EU) 2023/988 (GPSR), Art. 2, 3, 9, 11, 12, 13, 14, 15, 16, 19, 20, 35–37: https://eur-lex.europa.eu/eli/reg/2023/988/oj/deu ·
  Einzelartikel: https://gesetze.legal/eu/vo_eu_2023_988/2 · /3 · /9 · /11 · /12 · /13 · /14 · /15 · /16 · /19 · /20 · /36 · /37 (jeweils `https://gesetze.legal/eu/vo_eu_2023_988/<Nr>`)
- § 6 ProdSG: https://www.buzer.de/6_ProdSG.htm · https://www.gesetze-im-internet.de/prodsg_2021/__6.html
- §§ 28, 29 ProdSG: https://www.buzer.de/28_ProdSG.htm
- VO (EU) 2019/1020 (Marktüberwachung): https://eur-lex.europa.eu/eli/reg/2019/1020/oj/deu

**Elektro, Funk, Energie, Batterie**
- RL 2014/53/EU (RED): https://eur-lex.europa.eu/eli/dir/2014/53/oj/deu
- Delegierte VO (EU) 2026/339: https://eur-lex.europa.eu/eli/reg_del/2026/339/oj/eng
- RL 2011/65/EU (RoHS): https://eur-lex.europa.eu/eli/dir/2011/65/oj/deu
- VO (EU) 2019/2020, FAQ der Kommission zu Lichtstreifen: https://energy-efficient-products.ec.europa.eu/faqs-0/are-light-stripsstringschains-including-decorative-ones-and-christmas-scope-eu-ecodesign-if-yes-how_en
- Delegierte VO (EU) 2019/2015 (Energielabel Lichtquellen): https://eur-lex.europa.eu/eli/reg_del/2019/2015/oj/deu
- VO (EU) 2019/1782 (externe Netzteile): https://eur-lex.europa.eu/eli/reg/2019/1782/oj/deu
- ElektroG § 3: https://www.gesetze-im-internet.de/elektrog_2015/__3.html · § 9: https://www.gesetze-im-internet.de/elektrog_2015/__9.html · § 18: https://www.gesetze-im-internet.de/elektrog_2015/__18.html
- stiftung ear, mögliche Verpflichtete: https://stiftung-ear.de/en/topics/elektrog/producers-ar/registration/possible-obligated-parties
- VO (EU) 2023/1542 (Batterien): https://eur-lex.europa.eu/eli/reg/2023/1542/oj/deu
- BattDG (UBA): https://www.umweltbundesamt.de/themen/battdg-in-kraft-getreten-uba-beleiht-erneut

**Verpackung**
- VO (EU) 2025/40 (PPWR): https://eur-lex.europa.eu/eli/reg/2025/40/oj
- VerpackDG § 5: https://www.gesetze-im-internet.de/verpackdg/__5.html · § 13: https://www.gesetze-im-internet.de/verpackdg/__13.html · § 68: https://www.gesetze-im-internet.de/verpackdg/__68.html
- BMUKN zum Anpassungsgesetz: https://www.bundesumweltministerium.de/gesetz/gesetz-zur-anpassung-des-verpackungsrechts-und-anderer-rechtsbereiche-an-die-verordnung-eu-2025-40

**Lebensmittelkontakt, Bedarfsgegenstände, Chemikalien**
- VO (EG) 1935/2004: https://eur-lex.europa.eu/eli/reg/2004/1935/oj
- § 10 BedGgstV: https://www.gesetze-im-internet.de/bedggstv/__10.html
- VO (EG) 2023/2006 (GMP): https://eur-lex.europa.eu/eli/reg/2006/2023/oj
- VO (EU) 2025/351 (Änderung VO 10/2011): https://eur-lex.europa.eu/eli/reg/2025/351/oj
- VO (EU) 2024/3190 (Bisphenole): https://eur-lex.europa.eu/eli/reg/2024/3190/oj
- BfR-Empfehlungen: https://empfehlungen.bfr.bund.de/
- EDQM Metalle und Legierungen: https://www.edqm.eu/en/metals-and-alloys-used-in-food-contact-materials-and-articles
- REACH Eintrag 27 (VO 552/2009): https://eur-lex.europa.eu/eli/reg/2009/552/oj · Eintrag 50 (VO 1272/2013): https://eur-lex.europa.eu/eli/reg/2013/1272/oj · Eintrag 51 (VO 2018/2005): https://eur-lex.europa.eu/eli/reg/2018/2005/oj · Eintrag 70 (VO 2024/1328): https://eur-lex.europa.eu/eli/reg/2024/1328/oj
- LFGB § 30: https://www.gesetze-im-internet.de/lfgb/__30.html
- RL 2009/48/EG (Spielzeug): https://eur-lex.europa.eu/eli/dir/2009/48/oj

**Marke, Vertrag, Steuer, Datenschutz**
- EuGH C-334/22 (Pressemitteilung): https://curia.europa.eu/jcms/jcms/p1_4273655/hr
- UStG § 3: https://www.gesetze-im-internet.de/ustg_1980/__3.html · § 6a: https://www.gesetze-im-internet.de/ustg_1980/__6a.html · § 18e: https://www.gesetze-im-internet.de/ustg_1980/__18e.html
- BZSt One-Stop-Shop: https://www.bzst.de/DE/Unternehmen/Umsatzsteuer/One-Stop-Shop_EU/one_stop_shop_eu_node.html
- DVO (EU) 282/2011: https://eur-lex.europa.eu/eli/reg_impl/2011/282/oj
- RL 2006/112/EG (MwStSystRL): https://eur-lex.europa.eu/eli/dir/2006/112/oj
- BGB § 271a: https://www.gesetze-im-internet.de/bgb/__271a.html · § 311: https://www.gesetze-im-internet.de/bgb/__311.html · § 445a: https://www.gesetze-im-internet.de/bgb/__445a.html · § 447: https://www.gesetze-im-internet.de/bgb/__447.html · § 475: https://www.gesetze-im-internet.de/bgb/__475.html
- IHK Braunschweig zum Widerrufsbutton: https://www.ihk.de/braunschweig/beratung-und-service/rechtsthemen/wirtschaftsrecht-von-a-bis-z/internet-und-recht2/widerrufs-button-verpflichtend-seit-juni-2026-7103310
- EDSA-Leitlinien 07/2020: https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en

### Prüfwerkzeuge für 🤖 (nicht Teil der geprüften Recherche)

Diese Dienste sind Hilfsmittel, keine Rechtsquellen. Vor jeder Automatisierung Verfügbarkeit, Nutzungsbedingungen,
Kosten und ggf. Schnittstelle prüfen; Netzwerkzugriffe sind im Code heute gesperrt (`network: false`) und brauchen
eine eigene Freigabe. Gibt es keine erlaubte maschinenlesbare Abfrage, prüft ein Mensch und legt einen datierten
Screenshot ab.

| Prüfung | Dienst | Maschinenlesbar? |
| --- | --- | --- |
| USt-IdNr. (qualifiziert) | BZSt, Bestätigungsverfahren (eVatR): https://evatr.bff-online.de/ | Schnittstelle vom BZSt angeboten – Bedingungen prüfen |
| USt-IdNr. (einfach) | EU-VIES: https://ec.europa.eu/taxation_customs/vies/ | einfache Gültigkeit, keine qualifizierte Bestätigung |
| Handelsregister | KRS (PL), Obchodní rejstřík (CZ): https://or.justice.cz/ , KvK (NL): https://www.kvk.nl/ | je Register unterschiedlich – prüfen |
| WEEE- und Batterieregistrierung | Öffentliche Verzeichnisse der stiftung ear: https://www.stiftung-ear.de/ | Web-Verzeichnis; offene Schnittstelle nicht belegt |
| Verpackungsregistrierung | LUCID-Register der ZSVR: https://lucid.verpackungsregister.org/ | Web-Suche; offene Schnittstelle nicht belegt |
| Energielabel | EPREL: https://eprel.ec.europa.eu/ | öffentliche Datenbank; Schnittstellenzugang prüfen |
| GTIN-Herkunft | Verified by GS1 bzw. GEPIR: https://www.gs1.org/services/verified-by-gs1 | Zugang und Lizenz prüfen |
| GTIN-Prüfziffer | Eigener Code (`src/lib/suppliers/import/values.ts`) | ja, lokal |
| Gefährliche Produkte | EU Safety Gate: https://ec.europa.eu/safety-gate-alerts/ | öffentliches Portal; maschinenlesbare Abrufmöglichkeit prüfen |
| Benannte Stellen | NANDO-Datenbank der Kommission | Web-Datenbank |
| Laborakkreditierung | Nationale Akkreditierungsstellen (DE: DAkkS, https://www.dakks.de/) | Web-Verzeichnis |
| Format, Vollständigkeit, Datum von Unterlagen | Eigene Prüfung (PDF vorhanden, Unterschrift, Datum, Modellnummer, Sprache) | ja, aber nur formal – Inhalt bewertet ein Mensch |

### Interne Dokumente und Code

- [LIEFERANTEN-IMPORT.md](LIEFERANTEN-IMPORT.md), [SUPPLIER-AGENT.md](SUPPLIER-AGENT.md), [PRODUKTIONSANFORDERUNGEN.md](PRODUKTIONSANFORDERUNGEN.md)
- `src/lib/suppliers/import/columns.ts` (`FIELD_SPECS`), `evidence.ts` (`EVIDENCE_FIELDS`), `plan.ts`, `to-quote.ts`, `adapter.ts` (`outdatedOfferKeys`)
- `src/lib/suppliers/eligibility.ts` (Ausschlussgründe), `src/lib/suppliers/dashboard.ts` (Kennzeichnung), `src/lib/suppliers/links.ts`
- `src/lib/config/budget.ts` (`SAFETY_SWITCHES`, `FUNDING`), `src/lib/shopify/pipeline.ts` (Compliance-Stufe, nur Dry-Run-Anzeige), `src/lib/shopify/write-operations.ts` (Schreib-Positivliste), `src/lib/shopify/graphql.ts`, `src/lib/shopify/listings.ts`
