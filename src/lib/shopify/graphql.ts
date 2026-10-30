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

/**
 * Produkte mit Varianten und Preisen (nur Felder, die mit read_products lesbar sind).
 * Kosten pro Artikel und Bestände bräuchten read_inventory und werden bewusst nicht gelesen.
 */
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
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            inventoryPolicy
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
