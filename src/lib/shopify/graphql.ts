// GraphQL-Operationen für die Shopify Admin API. Nur Strings – gesendet wird über einen Transport
// (siehe sync.ts). Beim Aktivieren die aktuelle stabile API-Version prüfen:
// https://shopify.dev/docs/api/usage/versioning

export const SHOPIFY_ADMIN_API_VERSION = "2026-07";

/**
 * Legt ein Produkt an oder aktualisiert es, identifiziert über das URL-Handle (idempotent).
 * `synchronous: true` liefert das Ergebnis direkt zurück.
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

/** Liest vorhandene Demo-Produkte (z. B. für Abgleich und Aufräumen). */
export const DEMO_PRODUCTS_QUERY = /* GraphQL */ `
  query AiCommerceDemoProducts($query: String!) {
    products(first: 50, query: $query) {
      nodes {
        id
        handle
        title
        status
        tags
      }
    }
  }
`;
