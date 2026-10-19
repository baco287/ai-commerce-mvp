# AI Commerce – Storefront (Shopify-Theme)

Kundenshop als echtes Shopify-Liquid-Theme. Basis: **Shopify Dawn 16.0.0** (kostenlos, Lizenz in
`LICENSE.md`). Unabhängig vom Next.js-Dashboard im Hauptverzeichnis.

> **Status: Vorschau / Demo.** Nicht veröffentlichen. Alle Produkte sind mit `[DEMO]` gekennzeichnet
> und werden als **Entwurf** importiert. Rechtstexte, Lieferzeiten und Herstellerangaben sind Platzhalter.

## Voraussetzungen

- Node.js ≥ 22.12 (getestet mit Node 25)
- Ein kostenloser Shopify **Development Store** (Anleitung unten)
- Shopify CLI ist **lokal** in diesem Ordner installiert (`npm install`), keine globale Installation nötig

## Befehle (im Ordner `storefront/`)

```bash
npm install                      # lokale Shopify CLI installieren
npm run validate                 # Einstellungswerte gegen die Schemas prüfen
npm run validate:products        # Import-Datei data/demo-products.csv prüfen
npm run check                    # alle Prüfungen + Shopify Theme Check (bricht nur bei Fehlern ab)
npx.cmd shopify theme dev --store yakru.myshopify.com   # Live-Vorschau unter http://127.0.0.1:9292
```

`theme dev` lädt das Theme als unveröffentlichtes **Development Theme** in den Store. Den Live-Shop
ändert das nicht. **Nicht verwenden:** `shopify theme publish` oder „Veröffentlichen“ im Admin.

### Vorschau starten (Windows)

- In einem **normalen PowerShell-Fenster** starten – die Abfrage des Store-Passworts funktioniert im
  eingebetteten Terminal der Claude-App nicht.
- `npx.cmd` statt `npx` verwenden: Die PowerShell-Ausführungsrichtlinie blockiert `npx.ps1`.
- Die CLI fragt beim Start nach der Shopify-Anmeldung und dem **Store-Passwort** (Passwortschutz
  des Dev Stores, nicht das Kontopasswort): Admin → Onlineshop → Einstellungen.
- Das Passwort nicht als Parameter übergeben – es landet sonst im PowerShell-Verlauf.
- Fenster offen lassen, solange die Vorschau gebraucht wird; Änderungen werden automatisch hochgeladen.

### Warum `npm run validate`?

Shopify Theme Check erkennt keine ungültigen Schrittweiten von Schiebereglern (z. B. Deckkraft 35 %
bei 10er-Schritten). Shopify lehnt solche Dateien erst beim Hochladen ab, die Vorschau zeigt dann
„Failed to Upload Theme Files“. `scripts/validate-settings.mjs` findet das vorher.

## Struktur

```
storefront/
  assets/ai-commerce.css          Ergänzende Styles: Produktfakten, „Produktbild folgt“, Demo-Kennzeichnung
  config/settings_data.json       Design: Farbschemata, Schriften, Radien, Warenkorb-Typ
  sections/header-group.json      Demo-Hinweisleiste + dunkelblaue Navigation
  sections/footer-group.json      Footer (Anthrazit) mit Platzhaltern für Rechtliches
  snippets/ai-product-facts.liquid  Demo-Status, Lieferzeit (aus Metafeldern), Versandhinweis; blendet Kauf-Buttons bei Demo-Produkten aus
  templates/index.json            Startseite: Hero, Kategorien, ausgewählte Produkte, Über-uns
  templates/collection.json       Produktübersicht mit Filtern (Seitenleiste) und Sortierung
  templates/product.json          Produktseite: Bilder, Preis, Varianten, Lieferinfos, Warenkorb
  templates/cart.json             Warenkorb mit Demo-Hinweis
  templates/search.json           Suche mit Filtern und Sortierung
  templates/page.contact.json     Kontaktseite mit Formular
  data/demo-products.csv          5 Demo-Produkte zum Import (Status: Entwurf)
  data/metafield-definitions.json Geplante Metafelder für die Dashboard-Anbindung
  scripts/validate-settings.mjs   Prüft Einstellungswerte gegen die Section-Schemas
  scripts/build-demo-products.mjs Erzeugt data/demo-products.csv (aktuelles Shopify-CSV-Format)
  scripts/validate-products-csv.mjs Prüft die Import-Datei (Format, Entwurf, Kennzeichnung)
  .shopifyignore                  Hält data/, scripts/, package.json usw. aus dem Theme-Upload heraus
```

Dawn-Liquid-Code ist bis auf zwei kleine, mit „AI Commerce“ kommentierte Stellen unverändert:
`layout/theme.liquid` (lädt `ai-commerce.css`) und `snippets/card-product.liquid` (Demo-Produkte zeigen
„Demo – nicht bestellbar“ statt „Ausverkauft“, kein Schnellkauf). Bei Dawn-Updates diese Stellen übernehmen.

## Design

| Farbschema | Verwendung | Farben |
| --- | --- | --- |
| scheme-1 | Standard | Weiß, Anthrazit-Text `#1E2633`, Buttons Dunkelblau `#1E3A5F` |
| scheme-2 | helle Flächen | `#F4F6F9` |
| scheme-3 | Navigation, Hero | Dunkelblau `#14233C`, Akzent Cyan `#4FB3C8` |
| scheme-4 | Footer | Anthrazit `#1F2630` |
| scheme-5 | Hinweise | helles Cyan `#E8F3F6` |

Schriften: Montserrat (Überschriften), Lato (Text). Keine Scroll-Animationen, abgerundete Ecken (6–8 px).
Alles ist im Theme-Editor anpassbar (Onlineshop → Themes → Anpassen → Theme-Einstellungen).

### Markenname und Logo austauschen

- **Name:** Shopify-Admin → Einstellungen → Store-Details → Store-Name. Die Navigation zeigt ihn automatisch.
- **Logo:** Theme-Editor → Header → Logo hochladen (Breite unter Theme-Einstellungen → Logo).
- Die Texte im Theme nennen bewusst keinen Markennamen.

## Dev Store einrichten (einmalig, durch dich)

1. Kostenloses Konto bei **Shopify Partners** bzw. im **Shopify Dev Dashboard** anlegen
   (<https://www.shopify.com/partners>). Keine Kreditkarte nötig.
2. Dort **Store hinzufügen → Development Store** wählen (Zweck: Theme/App testen).
   Dev Stores sind passwortgeschützt, können keine echten Zahlungen annehmen und sind kostenlos.
3. Im Store: Sprache **Deutsch**, Währung **EUR**, Land **Deutschland**.
4. Im Ordner `storefront/` ausführen und im Browser anmelden:
   `npx shopify theme dev --store DEIN-STORE.myshopify.com`

### Danach im Shopify-Admin (Reihenfolge)

1. **Produkte importieren:** Schritt-für-Schritt-Anleitung inkl. Store-Vorbereitung (EUR, MwSt.) und
   sicherem Entfernen der Shopify-Testprodukte: [docs/SHOPIFY-PRODUKTIMPORT.md](../docs/SHOPIFY-PRODUKTIMPORT.md).
   Alle Produkte kommen als **Entwurf**. Für die Vorschau im (passwortgeschützten) Dev Store kannst du
   sie manuell auf „Aktiv“ setzen – das ist deine bewusste Entscheidung, nicht automatisch.
2. **Kategorien (automatisierte Kollektionen),** Bedingung „Produkt-Tag ist gleich …“:

   | Titel | Handle (unter SEO bearbeiten) | Tag |
   | --- | --- | --- |
   | Wohnen & Licht | `wohnen-licht` | `wohnen-licht` |
   | Büro & Homeoffice | `buero-homeoffice` | `buero-homeoffice` |
   | Küche & Outdoor | `kueche-outdoor` | `kueche-outdoor` |
   | Zubehör | `zubehoer` | `zubehoer` |

3. **Seite „Kontakt“** anlegen, Handle `kontakt`, Theme-Vorlage `contact`.
4. **Menüs:** `main-menu` → Startseite, Alle Produkte (`/collections/all`), Kategorien
   (`/collections`), Kontakt. `footer` → Suche, Kontakt.
5. **Metafelder** laut `data/metafield-definitions.json` anlegen (Einstellungen → Benutzerdefinierte Daten → Produkte).
6. **Zahlungen:** nur den Test-Modus bzw. „Bogus Gateway“ nutzen. Keine echten Zahlungsanbieter verbinden.
7. **Rechtstexte** (Einstellungen → Richtlinien) erst mit geprüften Texten befüllen.

## Was das Theme bewusst NICHT tut

- Keine Kundenbewertungen, keine Sterne, keine Gütesiegel, keine Zahlungs-Logos
- Keine Lieferzusagen: Die Lieferzeit erscheint nur, wenn die Metafelder `ai_commerce.delivery_days_*`
  gepflegt sind, sonst steht dort „wird vor Veröffentlichung ergänzt“
- Keine Lieferantennamen (Vendor ist ausgeblendet; im Import steht „AI Commerce“)
- Keine Express-Checkout-Buttons, kein Newsletter-Formular (Datenschutz noch offen)
- Keine kostenpflichtigen Apps
