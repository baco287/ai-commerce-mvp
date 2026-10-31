# Shopify-API einrichten

Verbindet die KI-Kontrollzentrale mit dem Dev Store `yakru.myshopify.com`: das Dashboard **liest**,
Korrekturen laufen eng begrenzt über den Befehl `npm run shopify:sync` (Abschnitt 6).
Kosten: keine. Alle Schritte im Browser machst du selbst.

## Was die Verbindung darf

| Darf | Darf nicht |
| --- | --- |
| Shop-Name, Währung und erteilte Rechte lesen | Produkte veröffentlichen, aktivieren oder löschen |
| Produkte mit Varianten, SKU, Preisen, Status und Bildern lesen | Bestellungen, Kunden oder Zahlungen lesen oder ändern |
| *mit `read_inventory`:* Bestand je Standort, Bestandsverfolgung und Kosten pro Artikel lesen | Preise, Titel, Texte bestehender Produkte automatisch ändern |
| *mit `write_inventory` (Abschnitt 6):* Bestandsverfolgung einschalten, Demo-Bestand auf 0 setzen | Bestände anderer als Demo-Produkte setzen |
| *mit `write_products` (Abschnitt 6):* eigene Produktbilder ergänzen, fehlende Produkte als **Entwurf** anlegen | Werbung, Apps oder Einstellungen ändern |

**Berechtigungen:** `read_products` (Pflicht), dazu `read_inventory`, `write_products`, `write_inventory`.
Jedes andere Recht – insbesondere `write_orders`, `write_publications`, `write_customers` – lässt die
Kontrollzentrale die Verbindung ablehnen. Das Dashboard sendet nie Mutationen; geschrieben wird nur
über eine feste Positivliste (`src/lib/shopify/write-operations.ts`).

## Voraussetzung

App und Store müssen zur **selben Organisation** im Shopify Dev Dashboard gehören
(<https://dev.shopify.com>). Ein Store, der im Dev Dashboard bzw. Partner-Bereich dieser Organisation
angelegt wurde, erfüllt das. Sonst schlägt die Token-Anfrage mit HTTP 400/401 fehl.

## 1. App im Dev Dashboard anlegen

1. <https://dev.shopify.com> öffnen → links **Apps** → oben rechts **Create app**.
2. **Start from Dev Dashboard** wählen, Name z. B. `AI Commerce Kontrollzentrale (read-only)` → **Create**.
3. Auf der Seite **Versions** der neuen App:
   - **App URL**: `https://shopify.dev/apps/default-app-home` (Standard für Apps ohne eigene Oberfläche im Shopify-Admin)
   - **Scopes**: `read_products` – oder gleich `read_products,read_inventory` (siehe Abschnitt 5). Nichts anderes.
   - **Webhooks API version**: neueste Version (Webhooks nutzen wir noch nicht)
4. **Release** wählen.

## 2. App auf dem Store installieren

1. In der App auf der Karte **Installs** → **Install app**.
2. Im neuen Tab den Store **yakru** wählen → **Install**.
3. Shopify zeigt die angefragten Rechte: Es dürfen nur **Produkte lesen** und ggf. **Inventar lesen** dastehen.

## 3. Zugangsdaten lokal hinterlegen

1. In der App → **App settings** → Karte **Credentials**: **Client ID** und **Client secret** kopieren.
2. Im Projektordner `D:\Projekte\ai-commerce-mvp` die Datei **`.env.local`** anlegen
   (Vorlage: `.env.example`) und eintragen:

   ```
   SHOPIFY_STORE_DOMAIN=yakru.myshopify.com
   SHOPIFY_CLIENT_ID=…
   SHOPIFY_CLIENT_SECRET=…
   ```

3. `.env.local` wird von Git ignoriert. Prüfen mit `git status` – die Datei darf dort **nicht** auftauchen.
   Das Secret niemals in Chats, Tickets, Screenshots oder Commits einfügen.

## 4. Erste echte Produktabfrage testen

1. Entwicklungsserver (neu) starten – Umgebungsvariablen werden nur beim Start gelesen:
   ```
   npm run dev
   ```
2. <http://localhost:3000/shopify> öffnen.
3. Erwartetes Ergebnis:
   - Karte **Verbindung**: Store „Yakru“, Domain `yakru.myshopify.com`, API-Version `2026-10`,
     Berechtigungen `read_products` (bzw. `read_products, read_inventory` nach Abschnitt 5).
   - Karte **Abgleich**: 5 erwartete Demo-Produkte; je nach Import „übereinstimmend“, „abweichend“
     (mit Feld-für-Feld-Vergleich) oder „fehlt“. Die Shopify-Testprodukte zählen als „nicht zugeordnet“.
4. Bei Problemen zeigt die Seite eine Fehlermeldung ohne Geheimnisse und einen Hinweis:

   | Meldung | Ursache / Lösung |
   | --- | --- |
   | Einrichtungshinweise, Einträge „fehlt“ | `.env.local` fehlt oder Server nicht neu gestartet |
   | Token-Anfrage abgelehnt (HTTP 400/401) | Client ID/Secret falsch, App nicht installiert oder andere Organisation |
   | Die App hat Schreibrechte | In der App-Version nur `read_products,read_inventory` lassen (kein `write_…`), neue Version releasen, auf dem Store bestätigen |
   | Der App fehlt die Berechtigung read_products | Scope ergänzen, Version releasen, auf dem Store bestätigen |
   | Im Produktionsbetrieb gesperrt | Seite wurde mit `npm start` statt `npm run dev` aufgerufen – gewollt, solange es keinen Login gibt |

## 5. read_inventory genehmigen (freigegeben)

Damit liest die Kontrollzentrale zusätzlich den **Shopify-Bestand je Standort** (verfügbar, vorhanden,
reserviert, im Zulauf), die **Bestandsverfolgung** und die **„Kosten pro Artikel“**. Kosten: keine.

> **Standortnamen:** Shopify gibt `name` und `isActive` eines Standorts nur mit zusätzlich
> `read_locations` heraus (live geprüft am 31.10.2026). Dieses Recht ist **nicht** freigegeben. Die
> Kontrollzentrale fragt deshalb nur die Standort-ID ab und zeigt Standorte als „Standort 12345“.
> Die ID findest du im Admin unter Einstellungen → Standorte in der Adresszeile (`…/locations/12345`).

**Ausgangslage prüfen:** <http://localhost:3000/shopify> zeigt in der Karte **Shopify-Bestand** den
gelben Hinweis „Berechtigung read_inventory fehlt“ und unter **Verbindung → Berechtigungen** nur `read_products`.

### 5.1 Neue App-Version im Dev Dashboard

1. <https://dev.shopify.com> öffnen und anmelden (gleiche Organisation wie der Store **yakru**).
   Oben muss **Dev Dashboard** stehen – nicht „dev docs“ (shopify.dev, Dokumentation) und nicht der
   öffentliche **Shopify App Store** (apps.shopify.com). Dort ist die App nicht zu finden.
2. Links **Apps** → die App **AI Commerce Kontrollzentrale (read-only)** anklicken.
3. Reiter **Versions** → **Create a version** (bzw. **Create version**).
4. Im Formular:
   - **App URL** unverändert lassen (`https://shopify.dev/apps/default-app-home`).
   - **Scopes** – genau diesen Text eintragen, ohne Leerzeichen:
     ```
     read_products,read_inventory
     ```
     Wenn du über **Select scopes** auswählst: nur **Products → read** und **Inventory → read** anhaken.
     **Nichts** mit `write_` auswählen, auch nicht `write_inventory` oder `write_products`.
   - Übrige Felder unverändert lassen.
5. **Release** klicken, Versionsname z. B. `v2 – read_inventory`, bestätigen.
   Die neue Version erscheint als **Active**.

### 5.2 Erweiterte Berechtigung auf dem Store genehmigen

Neue Rechte gelten erst, wenn der Store sie bestätigt hat.

1. Shopify-Admin von **yakru** öffnen: <https://admin.shopify.com/store/yakru>.
2. **Einstellungen** (unten links) → **Apps** → **AI Commerce Kontrollzentrale (read-only)**.
3. Erscheint ein Hinweis wie „Diese App benötigt neue Berechtigungen“ / **Update** bzw.
   **Berechtigungen überprüfen**: öffnen und prüfen, dass zusätzlich **nur „Inventar lesen“**
   (Inventory, read) angefragt wird → **Update/Genehmigen**.
4. Erscheint kein Hinweis (so am 31.10.2026: Unter „Activity and permissions“ stand weiter nur
   **Products**, und **Open app** zeigte nur „Find this app in the pages where you work“), dann neu
   installieren – unbedenklich, die App speichert nichts im Store, Client ID/Secret bleiben gültig:
   1. Auf der App-Seite im Store-Admin oben rechts **Uninstall app** → bestätigen.
   2. Dev Dashboard → **Apps** → **AI Commerce Kontrollzentrale** → Karte **Installs** → **Install app** → **yakru**.
   3. Rechteabfrage prüfen: nur Produkte und Inventar *ansehen* → **Install**. Danach zeigt Shopify
      wieder „Find this app in the pages where you work“ – das ist die normale Startseite.
5. **Kontrolle im Store-Admin:** App-Seite → „Activity and permissions“ zeigt **Products** und
   **Inventory**, jeweils ✓ bei *View* und „–“ bei *Edit*.

**Abbrechen, wenn** in der Rechteabfrage etwas anderes als Produkte/Inventar *lesen* steht – dann
die App-Version korrigieren. Die Kontrollzentrale würde die Verbindung ohnehin ablehnen.

### 5.3 Prüfen

1. Entwicklungsserver neu starten (Strg+C, dann `npm run dev`). Das Token wird bis zu 24 h im
   Arbeitsspeicher gehalten; erst ein Neustart holt eines mit den neuen Rechten.
2. <http://localhost:3000/shopify> neu laden. Erwartet:
   - **Verbindung → Berechtigungen:** `read_products, read_inventory`
   - **Letzte erfolgreiche Synchronisierung → Bestand:** aktuelle Uhrzeit
   - **Shopify-Bestand:** Standort(e) des Stores als „Standort &lt;ID&gt;“ mit Mengen, darunter alle
     Demo-Varianten mit Bestand **0**, „verfolgt“ und dem Hinweis **Demo · gesperrt**
   - **Abgleich:** der grüne Hinweis „Bestand, Bestandsverfolgung und Kosten pro Artikel werden
     mitgeprüft (read_inventory)“. Die Felder „Bestand verfolgt …“, „Bestand …“ und „Kosten …“
     erscheinen unter „Demo-Produkte im Vergleich“ **nur bei Abweichungen** – stimmt alles, steht dort „–“.

Jedes andere Recht (z. B. `read_orders`, `read_locations` oder ein `write_…`-Recht) lässt die
Kontrollzentrale die Verbindung bewusst ablehnen.

### Fehlermeldungen beim Bestand

| Anzeige | Ursache / Lösung |
| --- | --- |
| Gelb: „Berechtigung read_inventory fehlt“ | Version ohne `read_inventory` aktiv oder Store hat nicht bestätigt → 5.1/5.2, danach Server neu starten |
| Rot: „Bestand konnte nicht gelesen werden … Access denied … read_inventory“ | Token stammt noch von vor der Genehmigung → Server neu starten |
| Rot: „Die App hat Schreibrechte (write_inventory)“ | Version enthält ein Schreibrecht → neue Version nur mit `read_products,read_inventory` |
| Bestand „–“ bei einer Variante | Shopify führt für den Artikel keinen Standort (zählt als 0) → im Admin Bestand am Standort aktivieren |
| Gelb: Bestand „unvollständig“ | Mehr als 10 Standorte je Artikel, mehr als 1000 Produkte/100 Varianten oder Shopify lieferte zu einer Variante keine Daten – Hinweise in den Karten beachten |
| Gelb: Produkte „unvollständig“ | Mehr als 1000 Produkte oder mehr als 100 Varianten bei einem Produkt – der Abgleich zeigt, welche. Zählt nicht als erfolgreiche Synchronisierung |

Der **Lieferantenbestand** (Lager der Dropshipping-Partner) ist davon unabhängig, wird nicht mit dem
Shopify-Bestand vermischt und ist noch nicht angebunden – die Lieferanten-Adapter entstehen separat.

## 6. Automatische Korrekturen (write_products + write_inventory, freigegeben am 31.10.2026)

Damit behebt die Kontrollzentrale Abweichungen selbst – aber nur aus einer festen Positivliste:

| Operation | Recht | Wann |
| --- | --- | --- |
| Bestandsverfolgung einschalten | `write_inventory` | Variante verwaltet, Verfolgung in Shopify aus |
| Demo-Bestand auf 0 setzen | `write_inventory` | Demo-Variante mit Bestand ≠ 0 an einem Standort |
| Produktbild ergänzen | `write_products` | Produkt hat noch **gar kein** Medium; nur eigene Illustrationen aus `storefront/data/images/`, als Symbolbild gekennzeichnet |
| Produkt als **Entwurf** anlegen | `write_products` | Produkt fehlt in Shopify ganz; alle Produkt-Guards (DRAFT, DENY, verfolgt …) müssen bestehen |

Alles andere (Preise, Titel, Texte, Status, Varianten …) wird nur gemeldet, nie automatisch geändert.
Auf unvollständiger Datenbasis wird nichts geschrieben.

### 6.1 Rechte freigeben (einmalig)

1. Dev Dashboard (<https://dev.shopify.com/dashboard/241630859/apps>) → **AI Commerce Kontrollzentrale**
   → **Versions** → **Create a version**.
2. **Scopes** – genau so, ohne Leerzeichen:
   ```
   read_products,read_inventory,write_products,write_inventory
   ```
3. **Release**. Die neue Version muss als **Active** erscheinen.
4. Im Store bestätigen. Erfahrungsgemäß bietet Shopify keine Aktualisierung an – dann wie in 5.2:
   im Store-Admin unter Einstellungen → Apps die App **deinstallieren** und im Dev Dashboard über
   **Installs → Install app → yakru** neu installieren. Die Rechteabfrage darf nur Produkte und
   Inventar (ansehen und bearbeiten) zeigen.
5. Kontrolle im Store-Admin: App-Seite → „Activity and permissions“ zeigt **Products** und **Inventory**
   jeweils mit ✓ bei *View* **und** *Edit*.

> **Gut zu wissen:** Shopify meldet danach nur noch `write_products,write_inventory` – die Leserechte
> sind darin eingeschlossen. Die Kontrollzentrale ergänzt sie automatisch und zeigt alle vier an.
> Reihenfolge beachten: **erst** neue Version releasen (in der Versionsliste muss sie *Active* sein),
> **dann** neu installieren – sonst bleiben die alten Rechte.

### 6.2 Ausführen

```bash
npm run shopify:sync               # Testlauf: liest, zeigt geplante Änderungen, schreibt nichts
npm run shopify:sync -- --apply    # führt aus und prüft danach live nach
```

Der Befehl liest `.env.local` selbst und gibt nur Handles, SKUs und bereinigte Meldungen aus.
Bilder verarbeitet Shopify einige Sekunden bis Minuten im Hintergrund; ein zweiter Lauf erkennt
„wird verarbeitet“ und lädt nichts doppelt hoch. Danach `http://localhost:3000/shopify` neu laden.

## Sicherheit im Überblick

- **Nur serverseitig:** Token-Abruf und API-Aufrufe laufen ausschließlich im Next.js-Server
  (`src/lib/shopify/server/`, geschützt durch `import "server-only"`). Der Browser bekommt nur das
  fertige Ergebnis, nie Client ID, Secret oder Token.
- **Keine Endpunkte:** Es gibt keine API-Route und keine Server Action; die Abfrage läuft nur beim
  Aufruf der Seite. Im Produktionsbetrieb ist sie gesperrt, bis die Kontrollzentrale einen Login hat.
- **Letzte Synchronisierung:** Die Zeitpunkte der letzten erfolgreichen Produkt- und Bestandsabfrage
  (intern zusätzlich die Anzahl) werden lokal in `.data/shopify-sync-state.json` gespeichert (von Git
  ignoriert, keine Zugangsdaten), damit sie auch nach einem Fehler sichtbar bleiben. Nur vollständig
  gelesene Daten zählen als Erfolg: Abgeschnittene Produkt-, Varianten- oder Standortlisten und fehlende
  Bestandsdaten werden als „unvollständig“ angezeigt und nicht gespeichert
  (Tests: `src/lib/shopify/server/sync-status.test.ts`).
- **Geheimnisse:** nur in `.env.local`; Fehlermeldungen werden vor der Anzeige bereinigt; keine Protokollierung.
- **Token:** 24 Stunden gültig, nur im Arbeitsspeicher des Servers, 60 Sekunden vor Ablauf erneuert.
- **API-Version** fest auf `2026-10` (erreichbar bis 16.10.2027) – rechtzeitig anheben.
- **Schreiben nur per Befehl:** `npm run shopify:sync -- --apply` – das Dashboard importiert den
  Schreib-Client nie (Sicherheitstest). Schreib-Dokumente existieren nur in `src/lib/shopify/graphql.ts`.
- **Tests:** `connector.test.ts`, `write-operations.test.ts`, `repair.test.ts` und
  `src/lib/guards/safety.test.ts` prüfen u. a.: Lese-Client sendet nie Mutationen, nur freigegebene
  Rechte, Schreib-Client nur mit Positivliste und Schalter, Secret nie in URL oder Fehlertext,
  Netzwerk/Umgebungsvariablen nur in den vorgesehenen Dateien, kein Shopify-Servercode im Browser.

## Berechtigungen im Überblick

| Recht | Wofür | Phase |
| --- | --- | --- |
| `read_inventory` | Bestand je Standort und „Kosten pro Artikel“ anzeigen | **freigegeben** (Schritt 5) |
| `write_products`, `write_inventory` | Positivliste aus Abschnitt 6 (Entwürfe, Bilder, Bestandsverfolgung) | **freigegeben** (Schritt 6) |
| `read_orders` | Bestellungen für die Einkaufsprüfung lesen | später, mit Webhooks |

Nie vorgesehen: `write_publications` (Veröffentlichen), `write_orders`, `write_draft_orders`, Zahlungsrechte.
