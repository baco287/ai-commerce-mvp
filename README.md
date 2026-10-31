# AI Commerce – KI-Kontrollzentrale (MVP)

Interne Steuerzentrale für einen allgemeinen Onlineshop mit automatisiertem Dropshipping.
KI-Agenten recherchieren Trendprodukte, vergleichen Lieferanten und kalkulieren Margen – Einkauf,
Werbung und Shop-Änderungen laufen nur über Freigaben.

> **Phase 1 – Demo-Modus.** Alle Produkte, Lieferanten, Bestellungen, Umsätze und Agentenläufe sind
> **simuliert** und in der Oberfläche als Demo gekennzeichnet. Es gibt keine echten API-Aufrufe,
> keine echten Bestellungen und keine Werbeanzeigen.

Markenname ist noch offen – bis dahin „AI Commerce“. Das Projekt ist unabhängig von QonteX.

## Projektstruktur

| Ordner | Inhalt | Start |
| --- | --- | --- |
| `/` (Wurzel) | KI-Kontrollzentrale, Next.js | `npm run dev` → <http://localhost:3000> |
| [`storefront/`](storefront/README.md) | Kundenshop als Shopify-Theme (Basis Dawn 16) | `cd storefront && npx shopify theme dev --store …` |
| `docs/` | Architektur, Shopify-Anbindung | – |

Beide Teile sind unabhängig: eigene Abhängigkeiten, eigene Prüfungen. ESLint und TypeScript des
Dashboards ignorieren `storefront/`.

## Schnellstart

Voraussetzung: Node.js 20.9 oder neuer (getestet mit Node 25).

```bash
npm install
npm run dev
```

Dashboard: <http://localhost:3000>

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver mit Hot Reload |
| `npm run build` / `npm start` | Produktions-Build lokal bauen und starten |
| `npm test` | Unit-Tests (Vitest) für Kalkulation, Lieferantenvergleich, Einkaufssperre und Sicherheitsgrenzen |
| `npm run lint` | ESLint |
| `npm run typecheck` | Routentypen erzeugen + TypeScript prüfen |
| `npm run check` | Lint, Typecheck und Tests zusammen |

## Bereiche

| Seite | Inhalt |
| --- | --- |
| `/` Dashboard | Umsatz, Bestellungen, erwarteter Gewinn und Kosten, Agentenstatus, Aktivitäten, Warnungen, Freigaben, letzte Bestellungen mit Einkaufsprüfung |
| `/produkte` | 5 Demo-Produkte: Nachfragebewertung, Verkaufspreis, Lieferantenpreise, Marge, Empfehlung, Kalkulation je Produkt |
| `/lieferanten` | Supplier Scout je Produkt: günstigster, schnellster und insgesamt bester **geeigneter** Lieferant mit Kosten, Lieferzeit, Finanzierung, Marge, bestätigten/unbestätigten Angaben, offenen Nachweisen und Ausschlussgründen – Empfehlung, keine Einkaufsfreigabe |
| `/agenten` | Die sechs KI-Agenten mit Befugnissen, Freigabepflichten und Status (Pausieren nur lokal) |
| `/freigaben` | Freigabe-Warteschlange, Sicherheitsschalter, Grenzwerte, Startbudget 500 € |
| `/shopify` | Shopify-Synchronisierung: **echte** Produktdaten aus dem Dev Store (die Seite liest nur) im Abgleich mit der Kontrollzentrale; Shopify-Bestand je Standort (mit `read_inventory`), getrennt vom Lieferantenbestand; letzte erfolgreiche Synchronisierung; Dry-Run der automatischen Produktanlage |

## Tech-Stack

- Next.js 16 (App Router, Cache Components) mit TypeScript
- Tailwind CSS 4, Icons von lucide-react
- Vitest für Unit-Tests
- Geplant: Shopify (Shop & Checkout), PostgreSQL, n8n, OpenAI- und Claude-API

## Sicherheit & Budget

- Echtgeld-Aktionen sind über **Sicherheitsschalter** in `src/lib/config/budget.ts` hart deaktiviert
  (automatischer Einkauf, echte Anzeigen, bezahlte APIs). Umschalten nur per Code-Änderung mit Review.
- Automatischer Lieferanteneinkauf ist erst zulässig, wenn die Kundenzahlung erfasst **und** die
  Finanzierung gesichert ist (Auszahlung erhalten, ausreichendes Zahlungsziel oder Finanzierungsrahmen).
  Logik und Tests: `src/lib/guards/purchase.ts`.
- Shopify-Schreibzugriff ist **eng freigegeben** (seit 31.10.2026): nur Bestandsverfolgung, Demo-Bestand 0,
  eigene Produktbilder und fehlende Produkte als Entwurf – per `npm run shopify:sync` (Testlauf) bzw.
  `npm run shopify:sync -- --apply`, nie aus dem Dashboard. Veröffentlichen bleibt manuell.
- Zugangsdaten gehören in `.env.local` (von Git ignoriert). Vorlage: `.env.example`.

Welche Funktionen serverseitig laufen und welche nur simuliert sind, warum die Einkaufssperre nicht
umgangen werden kann und die nächsten Schritte: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).
Shopify: [API einrichten und Korrekturen](docs/SHOPIFY-API-EINRICHTUNG.md) · [Datenfelder](docs/SHOPIFY-INTEGRATION.md) ·
[Automatisierungs-Fahrplan](docs/SHOPIFY-AUTOMATISIERUNG.md) · [CSV-Import](docs/SHOPIFY-PRODUKTIMPORT.md).
