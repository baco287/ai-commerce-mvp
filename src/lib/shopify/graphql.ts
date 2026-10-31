// GraphQL-Operationen für die Shopify Admin API. Nur Strings – gesendet wird über den Read-only-Client
// (server/admin-client.ts) bzw. später über einen Schreib-Transport (sync.ts).
//
// API-Version fest konfiguriert. Unterstützte Versionen: https://shopify.dev/docs/api/usage/versioning
// 2026-10 ist die aktuelle stabile Version (erreichbar bis 16.10.2027) – vorher rechtzeitig anheben.

export const SHOPIFY_ADMIN_API_VERSION = "2026-10";

/**
 * Legt ein Produkt an oder aktualisiert es, identifiziert über das URL-Handle (idempotent).
 * `synchronous: true` liefert das Ergebnis direkt zurück.
 * Wird heute NUR im Dry-Run verwendet – der Read-only-Client lehnt Mutationen grundsätzlich ab.
 */
export const PRODUCT_SET_MUTATION = /* GraphQL */ `
  mutation AiCommerceProductSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
    productSet(synchronous: true, input: $input, identifier: $identifier) {
      product {
        id
        handle
        status
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/** Verbindungstest: Store-Name, Währung und die tatsächlich erteilten App-Rechte. */
export const SHOP_INFO_QUERY = /* GraphQL */ `
  query AiCommerceShopInfo {
    shop {
      name
      myshopifyDomain
      currencyCode
    }
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

/** Mengenarten je Standort (Shopify „inventory states“). */
export const INVENTORY_QUANTITY_NAMES = ["available", "on_hand", "committed", "incoming"] as const;

/** Standorte je Lagerartikel; mehr meldet die Abfrage über pageInfo als „abgeschnitten“. */
export const INVENTORY_LOCATIONS_PER_ITEM = 10;

/** Lagerartikel je Bestandsabfrage. Klein halten: Shopify begrenzt die Kosten einer Abfrage auf 1000 Punkte. */
export const INVENTORY_ITEMS_PER_QUERY = 25;

/**
 * Bestand je Lagerartikel und Standort, Bestandsverfolgung und „Kosten pro Artikel“. Braucht
 * read_inventory und wird nur abgefragt, wenn die App dieses Recht tatsächlich hat.
 *
 * Fragt gezielt die Lagerartikel der gelesenen Varianten ab (IDs aus PRODUCTS_QUERY) statt aller
 * Lagerartikel des Shops – so passt der Bestand immer genau zu den Produkten. InventoryItem.variant
 * ist veraltet, daher die Zuordnung über die ID. Unbekannte IDs liefert Shopify als null.
 *
 * Vom Standort nur die ID: `name` und `isActive` verlangen live zusätzlich read_locations (Stand
 * 31.10.2026, entgegen der Objektbeschreibung). Standorte werden daher über ihre ID gekennzeichnet.
 */
export const INVENTORY_ITEMS_QUERY = /* GraphQL */ `
  query AiCommerceInventoryItems($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on InventoryItem {
        id
        tracked
        unitCost {
          amount
        }
        inventoryLevels(first: ${INVENTORY_LOCATIONS_PER_ITEM}) {
          pageInfo {
            hasNextPage
          }
          nodes {
            location {
              id
            }
            quantities(names: ${JSON.stringify(INVENTORY_QUANTITY_NAMES)}) {
              name
              quantity
            }
          }
        }
      }
    }
  }
`;

/** Produkte mit Varianten und Preisen (nur Felder, die mit read_products lesbar sind). */
export const PRODUCTS_QUERY = /* GraphQL */ `
  query AiCommerceProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: TITLE) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        status
        vendor
        productType
        tags
        featuredMedia {
          id
        }
        variants(first: 100) {
          pageInfo {
            hasNextPage
          }
          nodes {
            id
            title
            sku
            price
            inventoryPolicy
            inventoryItem {
              id
            }
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
  }
`;
