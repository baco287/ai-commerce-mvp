# Anleitung: Demo-Produkte in Shopify importieren

Für den Development Store **yakru.myshopify.com**. Dauer: ca. 20 Minuten.
Alle Schritte machst du selbst im Shopify-Admin (<https://admin.shopify.com/store/yakru>).

> **Wichtig:** Die fünf Produkte sind Demo-Produkte. Sie werden als **Entwurf** importiert und sind
> **nicht** im Onlineshop veröffentlicht. Es entstehen keine Bestellungen, Zahlungen oder Kosten.

Importdatei: `storefront/data/demo-products.csv` (im aktuellen Shopify-CSV-Format, UTF-8).

| Produkt | Varianten | Preis (EUR inkl. MwSt.) | Kosten pro Artikel (intern) |
| --- | --- | --- | --- |
| [DEMO] LED-Lichtleiste mit App-Steuerung (5 m) | – | 29,90 | 11,60 |
| [DEMO] Faltbarer Laptopständer aus Aluminium | Farbe: Silber, Space Grau | 34,90 | 15,10 |
| [DEMO] Magnetische Kabel-Organizer (10er-Set) | – | 14,90 | 3,90 |
| [DEMO] Isolierte Edelstahl-Trinkflasche 750 ml | Farbe: Schwarz, Weiß, Salbeigrün | 24,90 | 8,50 |
| [DEMO] Silikon-Uhrenarmband (3er-Set) | Größe: S/M, M/L | 12,90 | 4,40 |

Preise und Kosten stammen aus den Demodaten der KI-Kontrollzentrale. „Kosten pro Artikel“ sehen Kunden nie.
Hinweis: Das Uhrenarmband hat laut Kalkulation einen negativen Deckungsbeitrag (Empfehlung „Verwerfen“) –
es ist nur zum Testen der Varianten-Anzeige dabei.

---

## Teil A – Store vorbereiten (vor dem Import!)

Die Preise in der Datei sind reine Zahlen. Shopify interpretiert sie in der **Store-Währung** – steht
der Store noch auf USD, würden aus 29,90 € plötzlich 29,90 $.

1. **Währung auf Euro stellen**
   Einstellungen → **Allgemein** (Store-Details) → Bereich „Store-Standardeinstellungen“ →
   **Store-Währung** → *Euro (EUR €)* → Speichern.
   *Falls Shopify die Änderung ablehnt* (z. B. weil Testbestellungen existieren): nicht weiter
   importieren und mir Bescheid geben.

2. **Preise inklusive MwSt.**
   Einstellungen → **Steuern und Abgaben** → „Alle Preise enthalten Steuern“ muss **aktiv** sein.
   Sonst würde Shopify auf 29,90 € noch 19 % aufschlagen.

3. **Sprache Deutsch** (für Warenkorb, Buttons usw.)
   Einstellungen → **Sprachen** → Deutsch hinzufügen und als **Standardsprache** festlegen.
   Unsere Produkttexte sind ohnehin deutsch.

4. **Sicherung der vorhandenen Produkte**
   Produkte → **Exportieren** → „Alle Produkte“, „CSV für Excel, Numbers usw.“ → Produkte exportieren.
   Die Datei kommt per E-Mail. Aufheben – damit lassen sich die Testprodukte notfalls wiederherstellen.

---

## Teil B – Die 13 Shopify-Testprodukte entfernen

Der Dev Store enthält 13 automatisch erzeugte Testprodukte (Snowboards, Ski-Wachs, Geschenkkarte …).

### Empfohlen: **vor** dem Import entfernen

Solange unsere Produkte noch nicht im Store sind, kann man sie gar nicht versehentlich erwischen.

1. Teil A, Schritt 4 (Sicherung) erledigt? Erst dann weiter.
2. **Produkte** öffnen. Prüfen: Es werden **13 Produkte** angezeigt, **keines** beginnt mit `[DEMO]`.
3. Oben links das Kästchen anklicken → „Alle 13 auswählen“.
4. Zuerst **Produkte archivieren** (nicht löschen). Archivierte Produkte verschwinden aus dem Shop,
   lassen sich aber jederzeit wiederherstellen.
5. Erst wenn alles passt: Filter „Status: Archiviert“ → alle auswählen → **Produkte löschen**.
   Löschen ist endgültig.

Bestehende Testbestellungen bleiben dabei erhalten; sie zeigen die Artikel dann nur noch als Text.

### Falls die Testprodukte erst **nach** dem Import entfernt werden

Unsere Produkte sind eindeutig gekennzeichnet:

| Merkmal | Unsere Demo-Produkte | Shopify-Testprodukte |
| --- | --- | --- |
| Titel | beginnt mit `[DEMO]` | nein |
| Hersteller (Vendor) | `AI Commerce` | anderer Name |
| Tag | `ai-commerce-demo` | nein |
| URL-Handle | beginnt mit `demo-` | nein |
| SKU | beginnt mit `DEMO-` | nein |

1. Produkte → Filter **Anbieter / Hersteller** → alle Anbieter **außer** „AI Commerce“ anhaken.
2. Kontrolle: genau **13** Produkte, **keines** mit `[DEMO]` im Titel. Stimmt das nicht → abbrechen.
3. Alle auswählen → **archivieren**, später wie oben löschen.
4. Gegenprobe: Filter **Tag = ai-commerce-demo** zeigt weiterhin **5** Produkte.

---

## Teil C – Import

1. Shopify-Admin → **Produkte** → oben rechts **Importieren**.
2. **Datei hinzufügen** → `D:\Projekte\ai-commerce-mvp\storefront\data\demo-products.csv` wählen.
3. **Nicht** anhaken: „Vorhandene Produkte mit demselben Handle überschreiben“
   (beim ersten Import gibt es keine; so kann nichts Bestehendes überschrieben werden).
4. **Produkte hochladen** → Shopify zeigt eine **Vorschau** des ersten Produkts. Prüfen:
   Titel beginnt mit `[DEMO]`, Preis 29,90 **€**, Status **Entwurf**.
   Steht dort ein Dollarzeichen → **Abbrechen** und Teil A, Schritt 1 nachholen.
5. **Produkte importieren** → Shopify meldet sich per E-Mail, wenn der Import fertig ist (meist < 1 Minute).

## Teil D – Kontrolle nach dem Import

Produkte → Filter **Tag = ai-commerce-demo**:

- [ ] Genau **5 Produkte**, alle mit `[DEMO]` im Titel
- [ ] Status bei allen: **Entwurf**
- [ ] Vertriebskanäle: **Onlineshop nicht ausgewählt**
- [ ] Laptopständer 2, Trinkflasche 3, Uhrenarmband 2 Varianten; LED und Kabel-Organizer ohne Varianten
- [ ] Preise in **€**, „Kosten pro Artikel“ ausgefüllt
- [ ] Je Variante: **Menge verfolgen** an, Bestand **0**, „Weiterverkaufen, wenn nicht vorrätig“ **aus**
- [ ] Keine Bilder (kommen später mit echten, geprüften Lieferantendaten)
- [ ] Lieferzeit: in der Vorschau steht „wird vor Veröffentlichung ergänzt“

Zum Preis: Der Laptopständer kostet laut Kalkulation **34,90 €** (Kosten 15,10 €). 29,90 € ist der
Preis der LED-Lichtleiste. Die Werte kommen direkt aus der KI-Kontrollzentrale.

Bitte melde mir das Ergebnis (oder eventuelle Fehlermeldungen von Shopify wörtlich).

## Teil E – Produkte in der Theme-Vorschau sehen (optional, bewusste Entscheidung)

Entwürfe erscheinen **nicht** im Shop – auch nicht in der Vorschau. Wenn du sie in der
passwortgeschützten Dev-Store-Vorschau sehen möchtest, musst du das **pro Produkt manuell** tun:

1. Produkt öffnen → Status **Aktiv**.
2. Vertriebskanäle → **Onlineshop** aktivieren → Speichern.

Der Dev Store bleibt dabei passwortgeschützt; Besucher ohne Passwort sehen nichts, und ein Dev Store
kann keine echten Zahlungen annehmen. Das Dashboard oder ein Skript tut das nie automatisch.

Auch aktiviert bleiben Demo-Produkte **unverkäuflich**: Der Bestand ist 0 und Überverkauf verboten –
Shopify selbst lehnt Warenkorb und Checkout ab. Das Theme zeigt „Demo – nicht bestellbar“ statt
„Ausverkauft“ und blendet die Kauf-Buttons aus.

## Teil G – Bereits importierte Demo-Produkte aktualisieren

Falls du die Produkte schon mit einer früheren Version der Datei importiert hast, fehlt dort die
Bestandsverfolgung (Varianten wirkten „ausverkauft“, waren aber nicht serverseitig gesperrt).
Zwei Wege – der erste ist schneller:

**A) Erneut importieren (nur unsere Demo-Produkte werden überschrieben)**

1. Produkte → **Importieren** → `storefront/data/demo-products.csv`.
2. Diesmal **anhaken**: „Vorhandene Produkte mit demselben Handle überschreiben“.
   Betroffen sind nur Produkte mit den Handles `demo-…` aus der Datei – keine anderen.
3. Vorschau prüfen (Status Entwurf, Preis in €) → importieren.
4. Teil D erneut abhaken.

**B) Von Hand, je Variante**

Produkt öffnen → Variante → Bereich „Inventar“: **Menge verfolgen** einschalten, Bestand **0**,
„Weiterverkaufen, wenn nicht vorrätig“ **aus** → Speichern. Für alle 9 Varianten wiederholen.

## Teil F – Kategorien (automatisierte Kollektionen)

Produkte → **Kollektionen** → Kollektion erstellen → Typ **Automatisiert** →
Bedingung „Produkt-Tag ist gleich …“. Unter „Suchmaschineneintrag bearbeiten“ das **URL-Handle** setzen:

| Titel | URL-Handle | Bedingung: Produkt-Tag ist gleich |
| --- | --- | --- |
| Wohnen & Licht | `wohnen-licht` | `wohnen-licht` |
| Büro & Homeoffice | `buero-homeoffice` | `buero-homeoffice` |
| Küche & Outdoor | `kueche-outdoor` | `kueche-outdoor` |
| Zubehör | `zubehoer` | `zubehoer` |

Die Handles müssen genau so lauten – die Startseite des Themes verweist darauf.

---

## Für Entwickler

- **Quelle ist das Dashboard:** Preise/Kosten aus `src/lib/data.ts`, Titel/Varianten/Texte aus
  `src/lib/shopify/listings.ts`. Datei neu erzeugen im Hauptordner: `npm run shopify:csv`.
  Ein Test (`src/lib/shopify/csv-export.test.ts`) schlägt fehl, wenn die Datei abweicht – Änderungen
  also nie direkt in der CSV, sondern an der Quelle.
- Datei prüfen: `cd storefront && npm run validate:products` – prüft Spaltennamen (aktuelles Format,
  keine veralteten Spalten), Status `draft`, „Published on online store“ `false`, Bestand verfolgt/0/deny,
  Preisformat, SKU/Tag-Kennzeichnung, Demo-Hinweis und verbotene Aussagen (Lieferzeiten, Bewertungen,
  Garantien, Siegel).
- Bewusst **nicht** in der Datei: Gewichte, Lieferzeiten, Bilder, Bewertungen – diese Werte kommen
  später nur aus geprüften Lieferantendaten.
- Der CSV-Import ist eine Übergangslösung. Ablösung durch die Admin-API: [SHOPIFY-AUTOMATISIERUNG.md](SHOPIFY-AUTOMATISIERUNG.md).
