# Shopify-Automatisierung – vom CSV-Import zur automatischen Produktanlage

Ziel: Der Eigentümer sucht, importiert und kauft keine Produkte manuell. Die KI-Agenten recherchieren,
kalkulieren und legen Produkte über die **Shopify Admin GraphQL API** an. Menschen geben nur noch frei.

## Stand heute (Phase 2)

| Baustein | Status |
| --- | --- |
| Dashboard-Daten → Shopify-Produkteingabe (`productSet`) | **fertig, getestet** – `src/lib/shopify/product-input.ts` |
| Schutzregeln vor jedem Schreibvorgang | **fertig, getestet** – `src/lib/shopify/guards.ts` |
| Abgleich mit Dry-Run (protokolliert, sendet nichts) | **fertig, getestet** – `src/lib/shopify/sync.ts` |
| GraphQL-Operationen, API-Version fest `2026-10` | **fertig** – `src/lib/shopify/graphql.ts` |
| CSV als Übergang, aus denselben Daten erzeugt | **fertig** – `npm run shopify:csv` |
| **Read-only-Connector** (Client-Credentials, nur `read_products`) | **fertig, getestet** – `src/lib/shopify/server/` |
| Ansicht „Shopify-Synchronisierung“ (Abgleich Shopify ↔ Dashboard) | **fertig** – `/shopify` |
| Pipeline Analyse → Lieferant → Marge → Compliance → Entwurf | **Dry-Run, getestet** – `src/lib/shopify/pipeline.ts` |
| Schreibender Transport zur Shopify-API | **bewusst nicht vorhanden** |
| Sicherheitsschalter `shopifyWriteEnabled` | **aus** (`src/lib/config/budget.ts`) |

Eine einzige Datenquelle: Preise, Kosten und Lieferant kommen aus der Dashboard-Kalkulation
(`src/lib/data.ts`), Titel/Varianten/Texte aus `src/lib/shopify/listings.ts`. Die CSV-Datei
`storefront/data/demo-products.csv` wird daraus erzeugt; ein Test schlägt fehl, wenn sie abweicht.

## Schutzschichten gegen versehentliche Verkäufe

| # | Schicht | Wo | Wirkt serverseitig? |
| --- | --- | --- | --- |
| 1 | Produktstatus **Entwurf**, nicht im Onlineshop veröffentlicht | Shopify | ja – nicht kaufbar |
| 2 | Bestand **verfolgt, 0 Stück, Überverkauf verboten** (`DENY`) | Shopify | ja – Warenkorb und Checkout lehnen ab, auch wenn jemand das Produkt aktiviert |
| 3 | Dev Store: Passwortschutz, keine echten Zahlungen möglich | Shopify | ja |
| 4 | Guards: nur `DRAFT`, nur `DENY` + verfolgter Bestand, kein Veröffentlichen, keine Bestellungen | unser Code | ja (vor jedem API-Aufruf) |
| 5 | Sicherheitsschalter `shopifyWriteEnabled = false`, kein HTTP-Transport | unser Code | ja |
| 6 | Theme: „Demo – nicht bestellbar“, keine Kauf-Buttons, kein Schnellkauf | Theme | nein – nur Darstellung |
| 7 | *(später)* Cart-and-Checkout-Validation-Function: blockiert Tag `ai-commerce-demo` | Shopify Function | ja |

Schicht 7 braucht eine eigene (kostenlose) Shopify-App mit Function-Erweiterung und ist der nächste
Ausbauschritt, sobald es eine App gibt (siehe unten).

## Den CSV-Import ersetzen – Schritt für Schritt

### 1. Dev-Dashboard-App (erledigt für Read-only)

- Einrichtung: [SHOPIFY-API-EINRICHTUNG.md](SHOPIFY-API-EINRICHTUNG.md). Authentifizierung per
  Client-Credentials-Grant (Client ID + Secret in `.env.local`, Token 24 h, nur im Serverspeicher).
- Heute: nur `read_products`. Für Entwürfe kommt **nach Freigabe** `write_products` hinzu (neue App-Version
  releasen, auf dem Store bestätigen). **Nie** vergeben: `write_publications`, `write_orders`,
  `write_draft_orders`, Zahlungsrechte.

### 2. Schreibenden Transport ergänzen (Code-Änderung mit Review, erst nach Freigabe)

- Neue Datei `src/lib/shopify/server/write-transport.ts`, implementiert `ShopifyAdminTransport` und
  nutzt denselben Token-Abruf (`server/auth.ts`). Antwort auf `userErrors` prüfen, Rate-Limits beachten.
- Der Read-only-Client bleibt unverändert und lehnt Mutationen weiter ab; Schreiben ist ein eigener Weg.
- Auslösen nur serverseitig und nur hinter einem Login (Server Action) – nie öffentlich erreichbar.
- `src/lib/guards/safety.test.ts` bewusst erweitern: Netzwerkzugriff ist heute nur in `server/auth.ts` und
  `server/admin-client.ts` erlaubt; die neue Datei wird dort explizit eingetragen.
- `SAFETY_SWITCHES.shopifyWriteEnabled` auf `true` – als eigener, reviewter Commit.

### 3. Produktanlage durch den Store Manager Agent

```
Market Research ─► Supplier Scout ─► Profit Calculator ─► Freigabe (Mensch) ─► Store Manager
                                                                            │
                                         planProductSync() → Guards → productSet (status: DRAFT)
```

- Identifikation über das **URL-Handle** → wiederholte Läufe aktualisieren statt duplizieren.
- Status ist immer `DRAFT`. **Aktivieren/Veröffentlichen bleibt eine manuelle Aktion** im Shopify-Admin,
  nachdem Compliance und Freigabe im Dashboard auf „freigegeben“ stehen.
- Interne Werte (Lieferanten-ID, Lieferanten-Versandkosten, Bestand, Marge, Compliance-/Freigabestatus)
  gehen in Metafelder ohne Storefront-Zugriff (`storefront/data/metafield-definitions.json`).
- Lieferzeit-Metafelder werden erst geschrieben, wenn sie vertraglich bestätigt sind – die Guards
  blockieren sie bis dahin.
- **Bilder:** später über `stagedUploadsCreate` + `productSet(files: …)`, nur mit Bildrechten des
  Lieferanten. Bis dahin zeigt das Theme „Produktbild folgt“.

### 4. Laufende Aktualisierung

- Preise/Kosten: Profit Calculator → erneuter `productSet`-Lauf. Preisänderungen > 10 % brauchen eine
  Freigabe (`LIMITS.maxPriceChangeWithoutApproval`).
- Lieferantenbestand: Metafeld `supplier_stock`; der Shopify-Bestand bleibt bei Demo-Produkten 0.
  Für echte Produkte wird später entschieden, ob Bestand aus dem Lieferantenfeed gespiegelt wird.

### 5. Bestellungen (später, Einkauf bleibt gesperrt)

- Webhooks `orders/paid` → Dashboard-Endpunkt (HMAC-Prüfung) → `evaluateAutoPurchase()` serverseitig.
- Solange `autoPurchaseEnabled = false` oder die Finanzierung nicht gesichert ist, wird nur protokolliert.

### 6. CSV abschalten

Wenn Schritt 1–3 laufen: `src/lib/shopify/csv.ts`, `csv-export.test.ts`, `npm run shopify:csv` und
`storefront/data/demo-products.csv` entfernen. Bis dahin bleibt die CSV der manuelle Weg.

## Testmodus – Checkliste im Shopify-Admin

- [ ] Onlineshop → Einstellungen → **Passwortschutz aktiv**
- [ ] Einstellungen → **Zahlungen**: kein echter Zahlungsanbieter verbunden; zum Testen nur
      „(for testing) Bogus Gateway“ bzw. Testmodus
- [ ] Onlineshop → Themes: Live-Theme unverändert, unser Theme nur als **Development Theme** (nie „Veröffentlichen“)
- [ ] Apps: keine kostenpflichtigen Apps installiert
- [ ] Marketing: keine Kampagnen
- [ ] Alle Produkte mit Tag `ai-commerce-demo` stehen auf **Entwurf**, Bestand **0**, Überverkauf **aus**
