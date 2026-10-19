# Architektur – AI Commerce Kontrollzentrale

## Zielbild

```
Kunde ──► Shopify-Shop (Checkout) ──► Bestellung + Zahlung
                                          │
                                          ▼
           n8n-Automationen ◄──── KI-Kontrollzentrale (dieses Repo, Next.js)
                │                         │
                ▼                         ▼
     Lieferanten-Einkauf          PostgreSQL (Produkte, Angebote, Bestellungen,
     (nur nach Freigabe +         Agentenläufe, Freigaben, Budget)
      gesicherter Finanzierung)           │
                                          ▼
                                 KI-Agenten (OpenAI / Claude)
```

Der Lieferant versendet direkt an den Kunden. Es gibt kein eigenes Lager, und es soll möglichst kein
eigenes Kapital für Wareneinkäufe gebunden werden.

## Projektstruktur

```
src/
  app/                    Seiten (App Router)
    page.tsx              Dashboard
    produkte/             Produktanalyse
    lieferanten/          Lieferantenvergleich
    agenten/              KI-Agenten
    freigaben/            Freigaben & Budget
  components/
    layout/               Seitenleiste, Kopfzeile, Navigation
    ui/                   Wiederverwendbare Bausteine (Card, Badge, Table, StatCard …)
    dashboard/ agents/ approvals/ suppliers/   Fachkomponenten
  lib/
    types.ts              Domänentypen
    data.ts               Datenzugriff der Oberfläche (heute Demo, später DB/Shopify)
    calc/                 Nachfrage-Score, Margen-/Preisrechnung, Lieferantenbewertung
    guards/purchase.ts    Einkaufssperre (Zahlung + Finanzierung + Limits)
    config/               Annahmen, Budget, Sicherheitsschalter, Freigaberegeln
    demo/                 Gekennzeichnete Demodaten (deterministisch)
```

**Grundregel:** Seiten lesen nur über `src/lib/data.ts`. Wenn später PostgreSQL oder Shopify
angebunden werden, ändert sich nur diese Schicht, nicht die Oberfläche.

## Rechenlogik

- **Nachfrage (0–100):** gewichteter Mix aus Suchtrend (35 %), Social Buzz (25 %), geringem
  Wettbewerb (25 %) und Saison (15 %).
- **Gesamtkosten eines Angebots:** Einkauf + Versand + geschätzte Importkosten.
- **Geeigneter Lieferant:** Lieferzeit ≤ 12 Tage, Bewertung ≥ 4,2, Bestand ≥ 50. Markiert wird das
  günstigste Angebot, das alle Regeln erfüllt – nicht einfach das billigste.
- **Deckungsbeitrag:** Nettopreis − Warenkosten − Zahlungsgebühr − Werbekosten je Verkauf −
  Retourenreserve. Die Annahmen stehen in `src/lib/config/assumptions.ts` und sind Platzhalter.
- **Empfehlung:** Kandidat (Marge ≥ 20 % und Nachfrage ≥ 65), Beobachten (Marge ≥ 10 %), sonst Verwerfen.

## Einkaufssperre

`evaluateAutoPurchase` lässt einen automatischen Einkauf nur zu, wenn **alle** Bedingungen erfüllt sind:

1. Sicherheitsschalter `autoPurchaseEnabled` ist an (im MVP: aus).
2. Die Kundenzahlung ist erfasst (nicht nur offen/reserviert).
3. Die Finanzierung ist gesichert: Geld bereits ausgezahlt **oder** Lieferanten-Zahlungsziel ≥
   Auszahlungsdauer **oder** ausreichender, freigegebener Finanzierungsrahmen.
4. Der Einkaufswert liegt unter dem Limit je Bestellung.
5. Die Bestellung hat einen positiven Deckungsbeitrag.

## Was läuft serverseitig, was ist simuliert?

### Serverseitig funktionsfähig

Alle Seiten sind React-Server-Komponenten. Die Berechnungen laufen auf dem Server (beim Build bzw.
im Dev-Server) und werden als fertiges HTML ausgeliefert; der Browser rechnet nichts davon nach.

| Funktion | Ort | Tests |
| --- | --- | --- |
| Nachfragebewertung 0–100 | `src/lib/calc/demand.ts` | ja |
| Gesamtkosten- und Deckungsbeitragsrechnung | `src/lib/calc/pricing.ts` | ja |
| Lieferanten-Eignung und „günstigster geeigneter“ | `src/lib/calc/suppliers.ts` | ja |
| Produktempfehlung (Kandidat/Beobachten/Verwerfen) | `src/lib/data.ts` | indirekt |
| Einkaufssperre je Bestellung | `src/lib/guards/purchase.ts` | ja |
| Sicherheitsschalter (zur Laufzeit eingefroren) | `src/lib/config/budget.ts` | ja |
| Kennzahlen, Tagesverlauf, Bestellliste | `src/lib/data.ts` | ja |

Die **Logik** ist echt – die **Eingangsdaten** sind es nicht (siehe unten).

### Nur simuliert

| Bereich | Details |
| --- | --- |
| Produkte, Nachfragesignale | fiktiv, `src/lib/demo/products.ts` |
| Lieferanten und Angebote | fiktive Firmen mit „(Demo)“, `src/lib/demo/suppliers.ts` |
| Bestellungen, Umsätze, Zahlungsstatus | deterministisch erzeugt (fester Seed), `src/lib/demo/orders.ts` |
| Agentenläufe, Aktivitäten, Warnungen, Freigabeanfragen | statische Demodaten, keine KI-API-Aufrufe |
| Kalkulationsannahmen | Platzhalter (Zahlungsgebühr, Werbekosten, Retouren, Auszahlungsdauer) |

### Nur im Browser, ohne Wirkung

| Aktion | Verhalten |
| --- | --- |
| Agent pausieren/fortsetzen | ändert nur die Anzeige, wird nicht gespeichert, löst nichts aus |
| Freigeben/Ablehnen | ändert nur die Anzeige; Anfragen mit Echtgeld-Bezug sind gesperrt |
| „Bestellen“ im Lieferantenvergleich | deaktiviert |

### Nicht vorhanden

Shopify, PostgreSQL, n8n, OpenAI/Claude sind nicht angebunden. Es gibt keine Datenbank, keine
Benutzerkonten und keine gespeicherten Zustände.

## Warum die Einkaufssperre im MVP nicht umgangen werden kann

1. **Es gibt keinen Weg zum Einkauf.** Phase 1 enthält keine Server Actions, keine API-Routen
   (`route.ts`), kein Proxy/Middleware, keine Formulare und keine Netzwerkaufrufe (`fetch`).
   Ein Klick in der Oberfläche kann den Server also gar nicht zu einer Aktion veranlassen.
2. **Die Sperre entscheidet nur.** `evaluateAutoPurchase` gibt ein Ergebnis zurück; Code, der
   tatsächlich bestellt, existiert nicht.
3. **Der Schalter ist fest im Code.** `SAFETY_SWITCHES.autoPurchaseEnabled = false` ist mit
   `Object.freeze` gesichert und lässt sich weder über die Oberfläche noch zur Laufzeit ändern.
4. **Regressionstests** (`src/lib/guards/safety.test.ts`) schlagen fehl, sobald ein Schalter
   eingeschaltet, ein Server-Endpunkt ergänzt oder `fetch`/`process.env` verwendet wird. Das
   Lockern einer Sperre ist damit immer eine sichtbare, bewusste Code-Änderung.

Sobald in Phase 2 echte Endpunkte (z. B. Shopify-Webhooks, n8n) hinzukommen, muss die Sperre
**serverseitig im Endpunkt** geprüft werden – nie nur in der Oberfläche – und die Tests werden
entsprechend angepasst.

## Nächste Schritte (Vorschlag)

1. **PostgreSQL + Datenmodell** (z. B. mit Prisma oder Drizzle): Produkte, Angebote, Bestellungen,
   Agentenläufe, Freigaben, Budgetbuchungen. Freigaben und Agentenstatus persistent machen.
2. **Zugangsschutz** für die Kontrollzentrale (Login), bevor sie irgendwo gehostet wird.
3. **Agenten-Laufzeit:** erste echte Agentenläufe mit hartem Kostenlimit pro Lauf/Tag,
   protokolliert in der Datenbank; bezahlte APIs erst nach Freigabe.
4. **Shopify-Anbindung** (zunächst lesend: Produkte, Bestellungen, Zahlungsstatus).
5. **n8n-Workflows** für Benachrichtigungen und Freigabeprozesse.
6. **Echte Konditionen** einpflegen (Zahlungsanbieter, Auszahlungsdauer, Werbekosten, Lieferanten-Zahlungsziele).
