# Shopify-API einrichten (Read-only)

Verbindet die KI-Kontrollzentrale **nur lesend** mit dem Dev Store `yakru.myshopify.com`.
Kosten: keine. Dauer: ca. 10 Minuten. Alle Schritte im Browser machst du selbst.

## Was die Verbindung darf

| Darf | Darf nicht |
| --- | --- |
| Shop-Name, Währung und erteilte Rechte lesen | Produkte anlegen, ändern, löschen oder veröffentlichen |
| Produkte mit Varianten, SKU, Preisen und Status lesen | Bestellungen, Kunden, Zahlungen, Bestände lesen oder ändern |
| Mit den Dashboard-Daten vergleichen | Werbung, Apps oder Einstellungen ändern |

**Einzige Berechtigung:** `read_products`. Hat die App irgendein `write_…`-Recht, verweigert die
Kontrollzentrale die Verbindung. Zusätzlich lehnt der Code jede GraphQL-Mutation ab, bevor sie gesendet wird.

## Voraussetzung

App und Store müssen zur **selben Organisation** im Shopify Dev Dashboard gehören
(<https://dev.shopify.com>). Ein Store, der im Dev Dashboard bzw. Partner-Bereich dieser Organisation
angelegt wurde, erfüllt das. Sonst schlägt die Token-Anfrage mit HTTP 400/401 fehl.

## 1. App im Dev Dashboard anlegen

1. <https://dev.shopify.com> öffnen → links **Apps** → oben rechts **Create app**.
2. **Start from Dev Dashboard** wählen, Name z. B. `AI Commerce Kontrollzentrale (read-only)` → **Create**.
3. Auf der Seite **Versions** der neuen App:
   - **App URL**: `https://shopify.dev/apps/default-app-home` (Standard für Apps ohne eigene Oberfläche im Shopify-Admin)
   - **Scopes**: ausschließlich `read_products`
   - **Webhooks API version**: neueste Version (Webhooks nutzen wir noch nicht)
4. **Release** wählen.

## 2. App auf dem Store installieren

1. In der App auf der Karte **Installs** → **Install app**.
2. Im neuen Tab den Store **yakru** wählen → **Install**.
3. Shopify zeigt die angefragten Rechte: Es darf nur **Produkte lesen** dastehen.

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
     Berechtigungen `read_products`.
   - Karte **Abgleich**: 5 erwartete Demo-Produkte; je nach Import „übereinstimmend“, „abweichend“
     (mit Feld-für-Feld-Vergleich) oder „fehlt“. Die Shopify-Testprodukte zählen als „nicht zugeordnet“.
4. Bei Problemen zeigt die Seite eine Fehlermeldung ohne Geheimnisse und einen Hinweis:

   | Meldung | Ursache / Lösung |
   | --- | --- |
   | Einrichtungshinweise, Einträge „fehlt“ | `.env.local` fehlt oder Server nicht neu gestartet |
   | Token-Anfrage abgelehnt (HTTP 400/401) | Client ID/Secret falsch, App nicht installiert oder andere Organisation |
   | Die App hat Schreibrechte | In der App-Version nur `read_products` lassen, neue Version releasen, auf dem Store bestätigen |
   | Der App fehlt die Berechtigung read_products | Scope ergänzen, Version releasen, auf dem Store bestätigen |
   | Im Produktionsbetrieb gesperrt | Seite wurde mit `npm start` statt `npm run dev` aufgerufen – gewollt, solange es keinen Login gibt |

## Sicherheit im Überblick

- **Nur serverseitig:** Token-Abruf und API-Aufrufe laufen ausschließlich im Next.js-Server
  (`src/lib/shopify/server/`, geschützt durch `import "server-only"`). Der Browser bekommt nur das
  fertige Ergebnis, nie Client ID, Secret oder Token.
- **Keine Endpunkte:** Es gibt keine API-Route und keine Server Action; die Abfrage läuft nur beim
  Aufruf der Seite. Im Produktionsbetrieb ist sie gesperrt, bis die Kontrollzentrale einen Login hat.
- **Geheimnisse:** nur in `.env.local`; Fehlermeldungen werden vor der Anzeige bereinigt; keine Protokollierung.
- **Token:** 24 Stunden gültig, nur im Arbeitsspeicher des Servers, 60 Sekunden vor Ablauf erneuert.
- **API-Version** fest auf `2026-10` (erreichbar bis 16.10.2027) – rechtzeitig anheben.
- **Tests:** `src/lib/shopify/server/connector.test.ts` und `src/lib/guards/safety.test.ts` prüfen u. a.:
  keine Mutationen, keine Schreibrechte, Secret nie in URL oder Fehlertext, Netzwerk/Umgebungsvariablen
  nur in den drei vorgesehenen Dateien, kein Shopify-Servercode in Browser-Komponenten.

## Spätere Berechtigungen (erst nach Freigabe)

| Recht | Wofür | Phase |
| --- | --- | --- |
| `read_inventory` | Bestand und „Kosten pro Artikel“ im Abgleich anzeigen | optional, nächster Schritt |
| `write_products` | Store Manager Agent legt Produkt-**Entwürfe** an | nach Freigabe + Code-Review |
| `read_orders` | Bestellungen für die Einkaufsprüfung lesen | später, mit Webhooks |

Nie vorgesehen: `write_publications` (Veröffentlichen), `write_orders`, `write_draft_orders`, Zahlungsrechte.
