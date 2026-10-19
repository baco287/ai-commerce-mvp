# Shopify-Anbindung – Planung (Phase 2+)

Stand: Das Theme (`storefront/`) ist fertig vorbereitet. Die Produktanlage per Admin GraphQL API ist im
Code vorbereitet (`src/lib/shopify/`, nur Dry-Run). Es gibt **noch keine** echte Datenverbindung, keine
API-Zugangsdaten und keine automatischen Aktionen. Fahrplan: [SHOPIFY-AUTOMATISIERUNG.md](SHOPIFY-AUTOMATISIERUNG.md).

## Datenfelder je Produkt

| Feld | Speicherort in Shopify | Quelle im Dashboard | Für Kunden sichtbar? |
| --- | --- | --- | --- |
| Shopify-Produkt-ID | `Product.id` (GID); im Dashboard als `shopifyProductId` gespeichert | – | nein |
| Dashboard-Produkt-ID | Metafeld `ai_commerce.dashboard_product_id` | `Product.id` | nein |
| Lieferanten-ID | Metafeld `ai_commerce.supplier_offer_id` | `SupplierOffer.id` (bester geeigneter) | **nein** |
| Einkaufspreis | Standardfeld „Kosten pro Artikel“ (`InventoryItem.unitCost`) | `SupplierOffer.unitPrice` | **nein** |
| Verkaufspreis | Varianten-Preis | `Product.targetPriceGross` | ja |
| Versandkosten (Lieferant) | Metafeld `ai_commerce.supplier_shipping_cost` | `shippingCost + importCost` | **nein** |
| Lieferzeit | Metafelder `ai_commerce.delivery_days_min/max` | `deliveryDaysMin/Max` | ja – nur nach Freigabe |
| Bestand (Lieferant) | Metafeld `ai_commerce.supplier_stock` | `SupplierOffer.stock` | **nein** |
| Erwartete Marge | Metafeld `ai_commerce.expected_margin_percent` | `MarginBreakdown.marginPercent` | **nein** |
| Compliance-Status | Metafeld `ai_commerce.compliance_status` | neu (Phase 2) | **nein** |
| Freigabestatus | Metafeld `ai_commerce.approval_status` + Produktstatus `DRAFT/ACTIVE` | `ApprovalRequest` | **nein** |

Definitionen: `storefront/data/metafield-definitions.json`. Interne Felder haben `storefrontAccess: NONE`
und werden vom Theme nie ausgegeben (`snippets/ai-product-facts.liquid` liest nur die Lieferzeit).

## Datenfluss (geplant)

```
Dashboard ──(Admin GraphQL, privater Custom-App-Token)──► Shopify
  • productCreate / productUpdate   immer mit status: DRAFT
  • metafieldsSet                   interne Felder + Lieferzeit
  • KEIN productPublish, KEIN status: ACTIVE durch Code

Shopify ──(Webhooks: orders/create, orders/paid)──► Dashboard (Server-Endpunkt)
  • Bestellung speichern
  • evaluateAutoPurchase() SERVERSEITIG im Endpunkt prüfen
  • Ergebnis nur protokollieren – Einkauf bleibt gesperrt (SAFETY_SWITCHES)
```

## Freigabe-Regeln

1. Ein Produkt wird nur **aktiviert**, wenn `approval_status = freigegeben` **und**
   `compliance_status = freigegeben` – und dann **manuell durch einen Menschen** im Shopify-Admin.
2. Das Dashboard darf Produkte nur als Entwurf anlegen oder aktualisieren.
3. Preisänderungen über 10 % brauchen eine Freigabe (`LIMITS.maxPriceChangeWithoutApproval`).
4. Die Einkaufssperre (`src/lib/guards/purchase.ts`) bleibt unverändert. Neue Webhook-Endpunkte müssen
   sie serverseitig aufrufen; die Regressionstests in `src/lib/guards/safety.test.ts` werden dafür
   bewusst angepasst.

## Zugangsdaten (später)

- Shopify **Custom App** im Dev Store, minimale Rechte: `read_products`, `write_products`,
  `read_orders`, `read_inventory`. Keine Zahlungs- oder Fulfillment-Rechte.
- Token nur in `.env.local` (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`), nie im Repo.
- Webhooks mit HMAC-Prüfung (`SHOPIFY_WEBHOOK_SECRET`).
