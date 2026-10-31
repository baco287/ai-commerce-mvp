# Market Scout Agent

Der Market Scout findet automatisch Produktkandidaten, misst das Marktinteresse und schickt interessante
Kandidaten durch die **bestehende** Kette:

```
Market Scan → Kandidatenbewertung → Supplier Scout → Profit Controller → Compliance → Shopify-Entwurf (Dry-Run)
```

Er baut kein zweites System: Lieferanten vergleicht der Supplier Scout (`compareQuotes`, inkl. importierter
Preislisten), die Marge rechnet `calc/pricing.ts`, den Entwurf baut der Store Manager über `buildDraftInput`
(`shopify/product-input.ts`) und prüft ihn mit den Shopify-Guards – als lokales Artefakt, nie in Shopify.

> **Grundsatz:** Der Agent kauft nichts, schaltet keine Werbung, veröffentlicht nichts, schreibt nicht nach Shopify
> und setzt nie „freigegeben“ oder „Entwurf erstellt“ – höchstens „bereit zur Prüfung“, und das ist keine Freigabe. Fehlende Daten erhöhen die Unsicherheit und zählen nie positiv.

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

## Zielproduktkatalog (lokal, von Hand gepflegt)

Echte Produktideen stehen in `.data/catalog/products.json` (von Git ignoriert – echte Daten kommen nie ins Repo).
Der Befehl liest die Datei nur (`src/lib/market/server/catalog-store.ts`); fehlt sie, ist der Katalog leer.
Jedes gültige Produkt wird ein Kandidat `catalog:<id>` (Quelle „Lokaler Zielproduktkatalog“, offline, kostenlos).
Der Katalog ist **kein Nachfragesignal**. Die Wartung von Hand ist die Voreinstellung (Entscheidung des Inhabers offen).

Synthetisches Beispiel (fiktiv, nur zur Veranschaulichung des Formats):

```json
{
  "products": [
    {
      "id": "kabelkanal-weiss",
      "title": "Kabelkanal selbstklebend",
      "category": "Büromaterial",
      "wikiTitle": "Kabelkanal",
      "salePrice": { "gross": 19.9, "basis": "plan", "reference": "Planpreis laut Kalkulation", "checkedAt": "2026-10-30" },
      "requiredDocTypes": ["gpsr"],
      "variants": [
        { "shopSku": "KK-W-01", "gtin": "<GTIN-13 mit gültiger Prüfziffer>", "brand": "<Marke>" },
        { "shopSku": "KK-S-01", "supplierOffers": ["<lieferant>::<artikelnummer>"], "mpn": "<MPN>" }
      ],
      "listing": {
        "handle": "kabelkanal-selbstklebend", "title": "Kabelkanal selbstklebend", "descriptionHtml": "<p>…</p>",
        "productType": "Kabelmanagement", "categoryTag": "buero", "option": "Farbe",
        "images": [{ "url": "https://…", "alt": "…", "rightsReference": "Lizenz/Vertrag/eigene Aufnahme" }]
      }
    }
  ]
}
```

Prüfregeln (`validateCatalog`, Code `CATALOG_INVALID` mit Meldung – ungültige Produkte werden nicht bewertet,
sondern als „zurückgestellt“ mit Grund gezeigt):
- `id` 3–40 Zeichen `a–z0–9-`, nicht `p-…` (Demo-IDs); `id`, `handle`, `shopSku` und GTIN sind im ganzen Katalog eindeutig
- GTIN nur als global eindeutige Einzelstück-GTIN: eingeschränkte Nummernkreise (`IDENTITY_RESTRICTED_GTIN`, z. B.
  Präfix 200–299, Coupons) und Umverpackungen (`IDENTITY_TRADE_UNIT_GTIN`, Indikator 1–8) werden abgelehnt
- ohne GTIN: `supplierOffers` **und** `mpn` oder `label` (Variantenkennung laut Lieferant)
- keine Demo-Kennzeichen (`ai-commerce-demo`, `[DEMO]`, `demo-`, `DEMO-`, Wort „demo“) in Kennungen und Texten
- Verkaufspreis > 0 mit Beleg; `checkedAt` gültig und nicht in der Zukunft; Bilder nur `https:` mit `rightsReference`
- mehrere Varianten: `listing.option` und eindeutige `optionValue`

GTIN-Kern (`src/lib/suppliers/identity.ts`): Alle GTIN-Vergleiche im Supplier Scout laufen über `sameGtin` (nur
Klasse „global“, 8/12/13/14 Stellen werden auf GTIN-14 normalisiert). In der Market-Pipeline sind Demo- und echte
Preislistenzeilen strikt getrennt (`allowReal`, siehe unten); nur die bisherigen Dashboard-Aufrufe (`/produkte`,
`/lieferanten`) nutzen übergangsweise noch dieselbe fiktive Demo-GTIN aus `DEMO_QUERIES` – ihre Umstellung folgt mit
Paket I, weil sie sichtbare Ergebnisse ändert.

### Supplier-Stufe: Variantenzuordnung und Kalkulationsbasis

Je Katalogvariante ordnet `matchVariant` (`src/lib/suppliers/variant-match.ts`) die importierten Preislisten-Angebote zu –
fail-closed, veraltete und synthetische Angebote zählen nie, höchstens ein Angebot je Lieferant:

| Fall | Ergebnis |
| --- | --- |
| Variante mit GTIN: Angebote mit derselben globalen GTIN | zugeordnet (`gtin`); ein Lieferant mit mehreren Artikeln derselben GTIN fällt weg (`IDENTITY_AMBIGUOUS`, wenn keiner bleibt) |
| benanntes Angebot (`supplierOffers`) mit anderer GTIN | `IDENTITY_CONFLICT` |
| Variante ohne GTIN: benannte Angebote mit gleicher MPN bzw. Variantenkennung | zugeordnet (`supplier_sku_mpn` / `supplier_sku_label`) |
| benanntes Angebot fehlt, passt nicht oder Lieferant nennt eine globale GTIN | `IDENTITY_NO_OFFER` / `IDENTITY_CONFLICT` / `IDENTITY_GTIN_AVAILABLE` („im Katalog nachtragen“) |

Zugeordnet heißt nur „gehört zur Variante“: Kalkulationsbasis wird ein Angebot erst nach der Eignungsprüfung mit
bestätigter Identität (Nachweis `identity.match` = exact bzw. bestätigte GTIN). Die Identität aus MPN/Variantenkennung
bleibt „vom Lieferanten angegeben“.

Preislisten-Wege (`priceListQuotesFor(…, { allowReal, target })`): Demo-Produkte bekommen nur **synthetische** Angebote
(`allowReal: false`, `sameDemoGtin`), echte Kandidaten nur **echte** (`allowReal: true`). Ein echtes Wikipedia-Thema, das
nur mit einem Demo-Produkt verknüpft ist, wird mit `IDENTITY_MISSING` zurückgestellt (nur Katalogprodukte haben eine
echte Identität).

Eine Kalkulationsbasis für alle Varianten: `selectCalculationBasis` (`src/lib/suppliers/compare.ts`). In Frage kommen nur
Lieferanten mit einem geeigneten Angebot für **jede** Variante (sonst `SUPPLIER_VARIANTS_INCOMPLETE`). Rangfolge:
Liquidität vor Preis – belegtes Zahlungsziel < unbelegtes Zahlungsziel (`terms_unsecured`) < Vorfinanzierung aus belegten
Mitteln < alle übrigen –, dann die höchsten Stückkosten über die Varianten, die längste Lieferzeit, die Lieferanten-ID.
Die Liquidität (`src/lib/suppliers/liquidity.ts`) rechnet mit **Worst-Case-Auszahlung 14 + 3 Tage** (`LIQUIDITY_RULES`,
Entscheidung 1 des Inhabers offen) statt der erwarteten 7 Tage; Mittel für Wareneinkauf sind ohne Kontonachweis und
mit dem heutigen Budget 0 € (Entscheidung 7). Ein Zahlungsziel allein gilt in Phase 1 nie als „vorfinanzierungsfrei
gesichert“. Für Demo-Produkte kann die Pipeline deshalb einen anderen Lieferanten nennen als `/produkte` und
`/lieferanten` (dort weiterhin der günstigste geeignete, damit die Shopify-Kosten unverändert bleiben).

### Compliance-Stufe: feste Dokumenttypen

Pflichtunterlagen sind feste Dokumenttypen (`DOC_TYPES` in `src/lib/suppliers/model.ts`): `eu_doc`, `red_doc`, `weee`,
`battg`, `gpsr`, `food_contact`, `cpnp`, `safety_assessment`, `magnet_warning`, `trademark_license`. Die Pflicht ergibt
sich aus den Risikoregeln (`src/lib/market/risk.ts`, **vorläufig – Entscheidung 2 des Inhabers offen**) plus
`requiredDocTypes` aus Katalog bzw. Abfrage:

| Warengruppe | Dokumenttypen |
| --- | --- |
| immer | `gpsr` |
| Elektrisch | `eu_doc`, `weee`; mit Funk (Bluetooth, WLAN, App …) zusätzlich `red_doc`, mit Akku/Batterie `battg` |
| Lebensmittelkontakt | `food_contact` |
| Kosmetik | `cpnp`, `safety_assessment` |
| Magnete | `magnet_warning` |

Geprüft wird über **alle** Basisangebote, ausschließlich über den Dokumenttyp (`hasRequiredDocument` in
`src/lib/suppliers/documents.ts` – derselbe Abgleich wie im Lieferanten-Dashboard). Freitext erfüllt nie eine Pflicht.
Zusätzlich müssen verantwortliche Person in der EU und deutsche Sicherheitshinweise bestätigt sein. Fehlt etwas oder ist
das Risiko unbekannt, wird zurückgestellt (`COMPLIANCE_DOCS_MISSING` / `COMPLIANCE_RISK_UNKNOWN`) und der Entwurf
übersprungen; sonst bleibt die Stufe gesperrt mit `COMPLIANCE_HUMAN_REVIEW` – freigeben kann nur ein Mensch.

## Nachfrage offline und Dubletten

- **Zwischengespeicherte Signale:** Ohne Live-Messung nutzt der Lauf das letzte echte Wikimedia-Signal eines
  Kandidaten aus `state.json`, wenn es höchstens `MARKET_SCAN.staleAfterDays` (7) Tage alt ist. Es ist mit
  `cached: true` und „zwischengespeichert vom …“ gekennzeichnet, erzeugt den Hinweis-Code `MARKET_SIGNAL_CACHED` und
  erhöht die Unsicherheit um `MARKET_SCAN.cachedSignalPenalty` (0,1 – Entscheidung des Inhabers offen). Ein
  Live-Signal im selben Lauf hat Vorrang. Demo-Kandidaten nutzen nie zwischengespeicherte Signale.
- **Katalogkandidaten ohne (ausreichendes) Signal** werden trotzdem weiter bewertet (Lieferant usw.), enden aber
  „zurückgestellt“ mit `MARKET_NO_DEMAND` („einmal mit --live messen“) bzw. `MARKET_LOW_DEMAND`. Für Wikipedia-Themen
  ohne Katalogbezug bleibt die Nachfrageschwelle ein harter Stopp.
- **Messung:** Mit `--live` werden Katalogprodukte mit `wikiTitle` über ihren Wikipedia-Artikel gemessen.
- **Dubletten im Lauf:** Fundstellen werden nach `identityKey` zusammengeführt (Katalog-ID vor Produkt-ID vor
  Quellen-Schlüssel); der kanonische Schlüssel ist `catalog:<id>` vor `demo:<id>` vor `wiki:…`. Demo und echt werden
  nie zusammengeführt.
- **Nachlauf (nur herabstufend):** Beansprucht dasselbe Lieferantenangebot die Kalkulationsbasis mehrerer echter
  Kandidaten, werden alle zurückgestellt (`OFFER_DUPLICATE_ASSIGNMENT`); gleiches Entwurfs-Handle →
  `DRAFT_DUPLICATE_HANDLE`.
- **Begründungs-Codes** (`src/lib/market/reasons.ts`): stabile Codes mit Wirkung `defer` (stellt zurück), `block`
  (sperrt automatisierte Folgeschritte) oder `hint` (nur Protokoll); sie stehen in `reasonCodes` und im Verlauf.

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
| Supplier Scout | belastbare Produktidentität (Demo-Produkt, Katalogvariante oder GTIN), je Variante ≥ 1 geeignetes Angebot und ein Lieferant für alle Varianten; **echte Kandidaten nie mit Demo-Lieferanten** | zurückgestellt |
| Profit Controller (Stückrechnung + Liquidität) | Preis vorhanden, Marge ≥ 10 %, Deckungsbeitrag ≥ 3 €, im Retouren-Stress > 0, Einzelstück belegt, Liquidität nicht zurückgestellt; „verlässlich“ nur mit Marktpreis, nachgewiesenen Kosten, belegtem Einzelstück, echten Daten und bestätigtem Steuerstatus | zurückgestellt / gesperrt (in Phase 1 mindestens wegen Liquidität) |
| Compliance | Pflicht-Dokumenttypen und Sicherheitsangaben über alle Basisangebote; **Freigabe immer durch Menschen** | zurückgestellt (fehlt etwas) / gesperrt |
| Shopify-Entwurf (Store Manager) | vollständiger Entwurf ohne Guard-Verstoß als **lokales Artefakt** (Dry-Run) | zurückgestellt (`DRAFT_INCOMPLETE` + Einzelcode) / gesperrt (`DRAFT_GUARD_VIOLATION`) |

Zustände: **ungeprüft** (noch nicht gemessen, z. B. Limit), **zurückgestellt**, **gesperrt**, **bereit zur Prüfung**,
**freigegeben** und **Entwurf erstellt**. Die letzten beiden setzt der Agent nie (per Sicherheitstest abgesichert).

**Bereit zur Prüfung** (`review_ready`) setzt der Agent nur, wenn alles gilt: echter Kandidat (nie Demo), keine
simulierte Uhr (sonst `CLOCK_OVERRIDDEN`), Marktstufe bestanden (frisches Signal, live oder zwischengespeichert),
Supplier- und Entwurfsstufe bestanden, Profit Controller bestanden oder nur gesperrt wegen `LIQ_TERM_UNSECURED`
(`REVIEW_READY_RULES.allowUnsecuredTerms`, Entscheidung 4 des Inhabers offen – Voreinstellung: ja) bzw.
`MARGIN_UNRELIABLE`, Compliance vollständig (Freigabe durch Menschen), Unsicherheit ≤ `MARKET_SCAN.maxUncertainty`
(sonst `UNCERTAINTY_HIGH`) und kein Code mit Wirkung „zurückstellen“. Sonst zurückgestellt (mindestens ein
Zurückstellungs-Code) bzw. gesperrt (z. B. Demo: `DEMO_DATA`).

### Store Manager: vollständiger Entwurf als lokales Artefakt (Paket E)

`src/lib/market/store-manager.ts` (`prepareDraft`) baut nach bestandener Compliance-Prüfung den Entwurf über
`buildDraftInput` – derselbe Baustein, den der Demo-Weg `buildProductSetInput` nur um Demo-Kosten und
Demo-Kalkulations-Metafelder erweitert:

- **Echte Entwürfe:** Texte, Varianten und Bilder (nur mit `rightsReference`) aus dem Katalog, Preis aus
  `salePrice`, Vendor = Marke aus `identity.brand` der Basisangebote, Tags `ai-commerce-pipeline` + Kategorie,
  Metafelder **nur** `PUBLIC_DRAFT_METAFIELDS` (`dashboard_product_id`, `compliance_status=offen`,
  `approval_status=entwurf`). **Keine** Kosten, keine `supplier_*`-/Margen-Metafelder, keine Lauf-ID, kein
  Fingerabdruck, keine Demo-Kennzeichen (Guard-Regeln in `shopify/guards.ts`).
- **Demo-Entwürfe:** vollständig gekennzeichnet (Tag, Handle-, Titel-, SKU-Präfix, Demo-Hinweis, Demo-Vendor), ohne
  Kosten. Eine Eingabe gilt nur mit **allen** Kennzeichen als Demo; gemischte Kennzeichen sind ein Verstoß.
- **GPSR-Block** in der Beschreibung aus bestätigter verantwortlicher Person in der EU und bestätigten deutschen
  Sicherheitshinweisen aller Basisangebote, sonst `DRAFT_GPSR_MISSING`.
- **Vollständig** (`completeness`): Beschreibung ≥ `STORE_MANAGER_RULES.minDescriptionChars` (200 Zeichen Text,
  nur echte Entwürfe), mindestens ein Bild mit Nutzungsrechten (nur echte), Identität jeder Variante bestätigt,
  Preis > 0, GPSR-Block, Marke bestätigt (`DRAFT_BRAND_UNCONFIRMED`; nur angegeben → trotzdem Vendor).
- **Verstöße** direkt aus `productInputViolations`.
- **Artefakt** (`DraftArtifact`): `shopifyInput`, `variantMap` (Zuordnungsbasis, GTIN-14, MPN/Kennung und – nur hier –
  der Angebots-Schlüssel), `availability` (geplante Menge, nie an Shopify), `completeness`, `violations`,
  `approval: { status: "none", wouldCreate: false }`. **Keine Beträge**, auch nicht bei Demo.
- **Fingerabdruck** = sha256 über das kanonische JSON von `{ shopifyInput, variantMap }` – ohne Lauf-ID, Zeitpunkt,
  simulierte Uhr und geplante Menge. Datei inhaltsadressiert: `.data/market/drafts/<Schlüssel>.<Fingerabdruck[0..12]>.json`,
  geschrieben nur mit `--save` (`writeDraftArtifact`, `wx`): gleicher Inhalt ergibt keine zweite Datei.
- `state.json` enthält nur `draft.artifact` (Datei, Fingerabdruck), `complete` und `missing`, nie das Artefakt.
  Keine Seite und kein Shopify-Befehl liest die Artefakte; die Übergabe an `shopify:sync` kommt erst mit der
  Freigabe-Akte (Phase 2).

### Profit Check und Steuerstatus

Nutzt `calculateMargin` unverändert: Nettopreis − Warenkosten (Einkauf + Versand + Import) − Zahlungsgebühr −
Werbekosten je Verkauf (Annahme) − Retourenreserve. Neu: `TAX_SETTINGS` in `src/lib/config/assumptions.ts`
(`regelbesteuert` | `kleinunternehmer`, Standard `regelbesteuert`, **`confirmed: false`**). Kleinunternehmer: keine
USt. auf den Verkauf, dafür nicht abziehbare Vorsteuer auf die Kosten. Solange der Status nicht bestätigt ist, gilt
keine Marge als verlässlich.

### Profit Controller: Stückrechnung, Retouren-Stress und Liquidität (Paket C)

Stufe 3 heißt „Profit Controller (Stückrechnung + Liquidität)“ und rechnet **eine** Kalkulationsbasis (Stufe 2):

- **Verkaufspreis:** Katalog `salePrice` (`market_observation` höchstens `MARKET_SCAN.staleAfterDays` alt = Marktpreis,
  sonst Planwert), Demo-Produkte ihren Zielpreis. Echte Kandidaten nie einen Demo-Zielpreis. Fehlt er: `PRICE_MISSING`.
- **Stückkosten im Worst Case:** teuerste Variante (`CostBreakdown.perUnit`) + Bearbeitungsgebühr
  (`PROFIT_RULES.handlingFeeAssumption`, 1 €). Die Marge kommt weiter nur aus `checkProfit` → `calculateMargin`.
- **Schwellen:** Marge < 10 % → `MARGIN_LOW`; Deckungsbeitrag < `PROFIT_RULES.minContributionEur` (3 €) →
  `MARGIN_BELOW_MIN`; jeweils zurückgestellt.
- **Retouren-Stress** (`checkUnitEconomics`, unbekannte Werte im Worst Case):
  `(1 − r) × c0 − r × Verlust` mit `r` = `LIQUIDITY_RULES.returnRateWorstCase` (10 %), `c0` = Deckungsbeitrag ohne die
  3-%-Retourenrückstellung (keine Doppelzählung), Verlust = Werbekosten + Versand + Rücksendung (5 €) + Zahlungsgebühr +
  Bearbeitungsgebühr + Warenwert. Der Warenwert (Einkauf + Import) entfällt nur bei **bestätigter** Rücknahme mit
  Gutschrift durch alle Basislieferanten. Ergebnis ≤ 0 → `MARGIN_STRESS_NEGATIVE` (zurückgestellt).
- **Einzelstück:** Mindestabnahme ≤ 1 und Mindestbestellwert ≤ Warenwert eines Stücks. Beides bestätigt = belegt;
  nur angegeben = `SINGLE_UNIT_STATED` (Hinweis, Marge nicht verlässlich – Entscheidung 3 des Inhabers offen);
  fehlt etwas = `SINGLE_UNIT_UNPROVEN` (echte Kandidaten zurückgestellt).
- **Demo:** immer `DEMO_DATA` (gesperrt). Margen-Schwellen stehen bei Demo nur als Hinweistext, damit die Demo die
  ganze Kette zeigt; die Liquidität gilt auch für Demo.

**Liquidität** (`src/lib/suppliers/liquidity.ts`, aus Stufe 2 übernommen, nicht neu gerechnet) – strikt konservativ:

- Auszahlung des Zahlungsanbieters im Worst Case 14 + 3 Tage (`LIQUIDITY_RULES`), dieselbe Regelbasis für
  `assessFinancing` und `assessFunding`.
- Mittel für Wareneinkauf (`goodsFunds`): ohne Kontonachweis 0 €; mit Nachweis Kontostand bzw. freies Budget abzüglich
  offener Töpfe und **Sicherheitsreserve** – mit dem heutigen `BUDGET` bauartbedingt 0 € (Entscheidung 7).
- **Kapazität offener Bestellungen** (`maxOpenOrders`, immer endliche Ganzzahl ≥ 0): bei Vorfinanzierung
  `floor(Mittel / (Vorkasse + Erstattungsrisiko))`, bei Zahlungsziel `min(Kreditrahmen-Kapazität,
  Erstattungskapazität aus eigenen Mitteln)`. Erstattungsrisiko = 10 % × (Verkaufspreis + Rücksendung). Je Tag:
  Kapazität / Bindungsdauer (Lücke bis zur Auszahlung bzw. Zahlungsziel).
- **Ein Zahlungsziel allein ist nie eine Garantie:** `securedWithoutPrefinancing` ist in Phase 1 immer `false`.

| Liquiditätsstatus | Stufe | Code |
| --- | --- | --- |
| `unknown` | zurückgestellt | `LIQ_UNKNOWN` |
| `prefinancing_unfunded` (Mittel unbelegt) | zurückgestellt | `LIQ_PREFINANCING_UNFUNDED` (+ `LIQ_CAPACITY_ZERO`) |
| `prefinancing_exceeds_funds` | zurückgestellt | `LIQ_PREFINANCING_EXCEEDS` (+ `LIQ_CAPACITY_ZERO`) |
| `prefinancing_within_funds` | gesperrt, nie automatisierbar; ohne Kapazität zurückgestellt | `LIQ_PREFINANCING_REQUIRED` (+ `LIQ_CAPACITY_ZERO`) |
| `terms_unsecured` / `terms_cover_worst_case` | gesperrt, Kette läuft weiter (Entscheidung 4 offen) | `LIQ_TERM_UNSECURED` |

Hinweis-Codes: `LIQ_CREDIT_UNKNOWN`, `LIQ_REFUND_UNKNOWN`, `AVAILABILITY_ZERO`. Die **geplante verkaufbare Menge** je
Variante ist `min(bestätigter Bestand − 2, 5)`, in Summe ≤ Kapazität – heute überall 0. Sie ist nur für das spätere
Entwurfs-Artefakt bestimmt und geht nie nach Shopify. Alle Werte in `PROFIT_RULES` und `LIQUIDITY_RULES` sind
konservative Platzhalter (Entscheidung 1 des Inhabers offen).

## Laufsteuerung

`market:scan` ist der durchgängige Dry-Run der Pipeline (kein zweiter Befehl, kein Scheduler):

```bash
npm run market:scan                      # Dry-Run offline: Demo + Katalog + Preislisten + Nachweise + zwischengespeicherte Signale – schreibt NICHTS (auch keinen Lock)
npm run market:scan -- --save            # zusätzlich: Lock, state.json (geschwärzt), journal/<runId>.jsonl, drafts/*.json – nur unter .data/market
npm run pipeline:dry-run                 # = market:scan -- --save
npm run market:scan -- --now 2026-10-19T12:00:00Z [--run-id demo-1] [--save]
                                         # Simulation mit fester Uhr: nie „bereit zur Prüfung“ (CLOCK_OVERRIDDEN);
                                         # mit --save ausschließlich nach .data/market/simulated/ (eigener Stand, Journal, Artefakte)
npm run market:scan -- --strict          # Exit 4, wenn der Lauf Fehler meldet
npm run market:scan -- --live [--save]   # zusätzlich Wikimedia – nur auf ausdrücklichen Start durch den Inhaber
npm run market:scan -- --status          # gespeicherter Stand, Laufprotokoll, Abbruchschalter
# Optionen: --limit <Kandidaten>  --requests <Abrufe>  (nur kleiner als die Grenzen)
```

`--now` muss in UTC angegeben werden (`…Z`), darf nicht nach der Systemzeit liegen und nicht mit `--live` kombiniert
werden. `--run-id` erlaubt Kleinbuchstaben, Ziffern und Bindestrich (Standard: `run-<Zeit>` bzw. `sim-<Zeit>`).

| Exit-Code | Bedeutung |
| --- | --- |
| `0` | ok – auch Abbruch durch STOP (beabsichtigt, im Journal `run_end.aborted`) |
| `1` | schwerer Fehler bei `--save`: beschädigter Stand, Angebotsspeicher, Katalog oder unbrauchbare Nachweisdatei – nichts wird geschrieben (ohne `--save` erscheinen diese Fehler als Lauffehler, mit `--strict` Exit 4) |
| `2` | Argumentfehler (auch `--now` in der Zukunft oder zusammen mit `--live`) |
| `3` | Lauf-Sperre belegt (`.data/market/LOCK`, jünger als 6 h) |
| `4` | Fehler im Lauf mit `--strict` |
| `5` | Lauf-ID bereits protokolliert – nichts wird verändert |

Die Konsole zeigt je Kandidat Bewertung, Zustand, Stufen, `[Codes]`, Begründungen, Liquiditätsstatus mit Kapazität
(bei Vorkasse ohne Mittelnachweis: „0 offene vorfinanzierte Bestellungen – Mittel unbelegt“) und den Artefaktpfad.
Für **echte** Kandidaten erscheinen **keine** Beträge zu Einkauf, Versand, Vorfinanzierung oder Marge – nur „siehe
Journal“. Demo-Werte sind fiktiv und dürfen erscheinen.

### Speicherorte (alle unter `.data/`, von Git ignoriert)

| Pfad | Inhalt | Wer liest |
| --- | --- | --- |
| `market/state.json` (+ `.bak`) | Stand für das Dashboard – echte Kandidaten **geschwärzt** | Dashboard, `--status` |
| `market/journal/<runId>.jsonl` | Entscheidungsprotokoll, eine Datei je Lauf, nie überschrieben – **vertraulich** | nur Menschen (keine Seite) |
| `market/drafts/<Schlüssel>.<fp>.json` | Entwurfs-Artefakte, inhaltsadressiert, ohne Beträge | niemand (Übergabe erst Phase 2) |
| `market/simulated/…` | dasselbe für Läufe mit `--now` | niemand |
| `market/LOCK` | Lauf-Sperre (nur mit `--save`, im `finally` freigegeben) | Befehl |
| `market/STOP` | Abbruchschalter für alle Läufe, auch Simulationen | Befehl |
| `catalog/products.json` | Zielproduktkatalog (von Hand, nur lesend) | Befehl, Zählung auf `/lieferanten` |

### Entscheidungsprotokoll (Journal)

Je Lauf mit `--save` eine Datei `journal/<runId>.jsonl` (`src/lib/market/journal.ts`), angelegt nur neu (`wx`):

- `run_start`: Modus (`offline`/`live`), `clockOverride`, Eingaben mit **Fingerabdruck** (`inputs.fingerprint` =
  sha256 über Import-IDs und Datei-Prüfsummen der Preislisten, Nachweise, Katalog, verwendete zwischengespeicherte
  Signale, Konfiguration `configSha256` und App-Version), `globalBlockers` (heute `TAX_UNCONFIRMED`,
  `FUNDS_UNVERIFIED`), Hinweise (z. B. ersetzte veraltete Sperre).
- `candidate` je Kandidat (nach Schlüssel sortiert): Zustand, Vorzustand aus dem letzten Stand, Codes, Begründungen,
  Stufen, **vertraulich**: Lieferant mit Angebots-Schlüsseln und geprüften Lieferanten, Stückrechnung, Liquidität
  inkl. `workingCapitalWhatIf` (Vorfinanzierung je Bestellung × Bindungstage × 1 Bestellung/Tag – Grundlage für
  Entscheidung 7), Pflicht-Dokumenttypen, Entwurf (Datei, Fingerabdruck, Vollständigkeit, geplante Menge).
- `run_end`: Zählung, Fehler, bei Abbruch (z. B. STOP) `aborted`. Artefakte entstehen erst nach vollständiger
  Bewertung eines Kandidaten – es gibt kein halbes Artefakt.

**Determinismus:** Zeit kommt nur aus `now` (mit `--now` fest), Schlüssel in kanonischer Reihenfolge, stabile
Sortierungen. Zwei Simulationen mit gleicher Uhr, Lauf-ID und Eingaben ergeben in leeren Verzeichnissen ein
byte-gleiches Journal und gleiche Artefakte. **Idempotenz:** existiert `journal/<runId>.jsonl`, endet der Lauf mit
Exit 5, ohne Stand, Artefakte oder Journal zu ändern; zusätzlich zählt `mergeRun` dieselbe Lauf-ID nie doppelt.

### Schwärzung für das Dashboard

`state.json` erhält für echte Kandidaten nur die geschwärzte Form (`toStoredResult` in `state.ts`): Zustand, Codes,
Begründungen ohne Beträge, Stufenstatus mit Texten **aus den Codes**, Score und Signale (die Margen-Komponente ohne
Wert), Compliance-Dokumenttypen und die Entwurfs-Zusammenfassung. Lieferant, Einkaufspreis, Versandkosten,
Konditionen, Marge, Vorfinanzierung, Kreditrahmen, geplante Menge und Angebots-Schlüssel stehen **nur im Journal**.
Das Dashboard zeigt dafür „Vertraulich – nur im lokalen Journal“. Demo-Kandidaten bleiben unverändert.

### Build- und Startsperre, lokaler Entwicklungsserver

`npm run build` und `npm start` führen vorher `scripts/check-public-data.ts` aus (nur lesend) und brechen ab, sobald
`.data/` echte Daten enthält: nicht-synthetische Angebote oder Nachweise dazu, einen Zielproduktkatalog, echte
Kandidaten, echte Entwurfs-Artefakte oder Journale (unlesbare Dateien zählen wie echte Daten). `npm run dev` bindet
an `127.0.0.1`. Alle Seiten, die `.data/` lesen, rendern je Anfrage (`await connection()`) und werden nie beim Build
vorgerendert. Mit echten Daten läuft die Kontrollzentrale bis zum Login-Konzept nur lokal.

| Schutz | Wert / Ort |
| --- | --- |
| Abrufe je Lauf | höchstens 60 (`MARKET_SCAN.maxRequestsPerRun`) |
| Gemessene Kandidaten je Lauf | höchstens 25 – Rest bleibt „ungeprüft“ und folgt im nächsten Lauf |
| Kosten je Lauf | 0 € – kostenpflichtige Quellen sind über `SAFETY_SWITCHES.paidApiCallsEnabled` gesperrt |
| Abbruchschalter | `MARKET_SCAN.enabled` im Code **und** Datei `.data/market/STOP` (stoppt auch laufende Läufe) |
| Parallele Läufe | `.data/market/LOCK` (nur mit `--save`), belegt → Exit 3; älter als 6 h (unlesbar: älter als 1 min) → atomar ersetzt unter der kurzlebigen Übernahme-Sperre `LOCK.takeover` und im Journal vermerkt; freigegeben wird nur die eigene Sperre (Besitzer-Kennung) |
| Netzwerk | nur im Befehl mit `--live`, nie im Dashboard |
| Wiederholbarkeit | Kandidaten-Schlüssel (z. B. `wiki:de.wikipedia:Bleistift`) – keine Dubletten; „ungeprüft“ überschreibt nie eine Bewertung; dieselbe Lauf-ID zählt nie doppelt (Exit 5); Verlauf der letzten 10 Bewertungen (mit Codes und Entwurfs-Fingerabdruck), Protokoll der letzten 30 Läufe |
| Fehler | einzelne Quellen oder Kandidaten brechen den Lauf nicht ab; sie stehen im Protokoll (mit `--strict`: Exit 4) |

**Unbeaufsichtigter Lauf:** Ein späterer Zeitplan ruft offline `npm run pipeline:dry-run -- --strict` auf und wertet
die Exit-Codes aus. **Es ist noch kein Zeitplan eingerichtet**; `--live` im Zeitplan erst nach Entscheidung 6 des
Inhabers (Phase 2). Der Lauf schreibt nie nach Shopify.

## Dashboard

- **Produktanalyse** (`/produkte`): Karte „Market Scout“ – je Kandidat Trend, Bewertung mit Unsicherheit,
  Lieferant, Gewinnspanne, Sperr-/Rückstellungsgründe, Entwurfsstatus; aufklappbar Bestandteile der Bewertung,
  Belege mit Link zur Quelle und die Pipeline-Stufen. Echte Kandidaten stehen vor Demo-Kandidaten.
- **KI-Agenten** (`/agenten`): letzter Lauf (Modus, Abrufe, Kosten, Abbruchschalter) und Zählung je Zustand.
- Ohne gespeicherten Lauf zeigt das Dashboard eine **gekennzeichnete Demo-Vorschau** (festes Demo-Datum, kein Netzwerk).
- Echte Kandidaten erscheinen nur geschwärzt (siehe „Schwärzung für das Dashboard“); Journal, Artefakte, Katalog und
  Simulationen liest keine Seite.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `src/lib/market/model.ts` | Signalarten, Kandidaten, Kennzahlen |
| `src/lib/market/interest.ts` | Zeitreihen auffüllen, Trends und Saisonindex |
| `src/lib/market/wikimedia.ts` | Adressen und strenge Antwortprüfung (ohne Netzwerk) |
| `src/lib/market/sources.ts` | Quellen-Schnittstelle, Abrufbudget, Wikimedia-, Demo- und Katalog-Quelle, Titel-Filter |
| `src/lib/market/catalog.ts` | Zielproduktkatalog: Format, Prüfung, Abfragen je Variante |
| `src/lib/market/reasons.ts` | Begründungs-Codes mit Wirkung |
| `src/lib/suppliers/identity.ts` | GTIN-Kern: Normalisierung, Klassen, Vergleiche |
| `src/lib/suppliers/variant-match.ts` | Zuordnung der Preislisten-Angebote zu Katalogvarianten |
| `src/lib/suppliers/liquidity.ts` | Liquidität im Worst Case, Mittel für Wareneinkauf, Kapazität, Zuordnung zur Stufe, geplante Menge |
| `src/lib/suppliers/documents.ts` | Dokumenttypen: Anzeigenamen und der einzige Pflichtunterlagen-Abgleich |
| `src/lib/market/supplier-stage.ts` | Supplier-Stufe: Varianten, Vergleich je Variante, eine Kalkulationsbasis |
| `src/lib/market/compliance.ts` | Compliance-Stufe: Pflicht-Dokumenttypen prüfen |
| `src/lib/market/risk.ts` | Risikoregeln je Warengruppe |
| `src/lib/market/score.ts` | Opportunity Score mit Unsicherheit |
| `src/lib/market/profit.ts` | Profit Controller: Marge mit Steuerstatus (nutzt `calc/pricing.ts`), Stückrechnung, Retouren-Stress, Einzelstück |
| `src/lib/market/store-manager.ts` | Store Manager: vollständiger Entwurf als lokales Artefakt, Vollständigkeit, Fingerabdruck |
| `src/lib/market/pipeline.ts` | Kandidat bewerten, Lauf steuern, Zustände |
| `src/lib/market/state.ts` | Stand zusammenführen ohne Dubletten (idempotent), Schwärzung echter Kandidaten |
| `src/lib/market/journal.ts` | Entscheidungsprotokoll, Eingabe- und Konfigurations-Fingerabdruck |
| `src/lib/market/scan-command.ts` | Befehl: Argumente, Exit-Codes, Konsolenausgabe ohne Beträge echter Kandidaten |
| `src/lib/market/server/wikimedia-client.ts` | **einziger** Netzwerkzugang (serverseitig) |
| `src/lib/market/server/market-store.ts` | Speicher `.data/market/` (bzw. `simulated/`): Stand mit `.bak`, Journal, Artefakte, Lauf-Sperre, Abbruchschalter, zwischengespeicherte Signale (lesend) |
| `src/lib/market/server/scan-runner.ts` | Ablauf des Befehls: Lock, Lauf-ID-Prüfung, Lauf, Ausgabe, Speichern |
| `src/lib/market/server/catalog-store.ts` | Zielproduktkatalog `.data/catalog/products.json` (nur lesend) |
| `src/lib/guards/public-data.ts`, `scripts/check-public-data.ts` | Build- und Startsperre bei echten Daten in `.data/` |
| `scripts/market-scan.ts` | Befehl `npm run market:scan` / `npm run pipeline:dry-run` |
| `src/components/market/market-scout-panel.tsx` | Anzeige im Dashboard (ohne Aktionen) |

## Was noch fehlt, bevor Produkte wirklich automatisch in den Shop kommen

1. **Produktidentität für neue Themen:** Wikipedia liefert Themen, keine GTINs. Ohne GTIN und echte Preislisten
   bleibt jeder neue Kandidat beim Supplier Scout zurückgestellt.
2. **Marktpreisquelle:** Ohne belegten Verkaufspreis ist keine Marge verlässlich.
3. **Steuerstatus bestätigen** (`TAX_SETTINGS.confirmed`).
4. **Shop-Texte und Bilder mit nachgewiesenen Nutzungsrechten** für neue Produkte – heute gibt es Entwürfe nur
   für die Demo-Produkte mit eigenen Illustrationen.
5. **Compliance-Freigabe** je Produkt durch einen Menschen.
6. **Zeitplan** für den unbeaufsichtigten Lauf einrichten (`npm run pipeline:dry-run -- --strict`, offline, ohne
   Shopify-Schreibzugriff).
7. **Freigabe-Akte und Übergabe an `shopify:sync`** (Phase 2): Bis dahin legt `shopify:sync` nur vollständig als Demo
   gekennzeichnete Entwürfe an; echte Entwürfe werden mit „Anlage erst mit Freigabe-Akte“ gesperrt.
