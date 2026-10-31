// Übergangslösung: erzeugt die Shopify-Import-CSV aus denselben productSet-Eingaben wie die API.
// So gibt es nur EINE Datenquelle (Dashboard). Entfällt, sobald der API-Abgleich aktiv ist.
// Spaltennamen: aktuelles Shopify-Produkt-CSV-Format (help.shopify.com › Using CSV files).

import type { ProductSetInput } from "./product-input";

export const CSV_COLUMNS = [
  "Title",
  "URL handle",
  "Description",
  "Vendor",
  "Type",
  "Tags",
  "Published on online store",
  "Status",
  "SKU",
  "Option1 name",
  "Option1 value",
  "Price",
  "Compare-at price",
  "Cost per item",
  "Charge tax",
  "Inventory tracker",
  "Inventory quantity",
  "Continue selling when out of stock",
  "Requires shipping",
  "Fulfillment service",
  "Product image URL",
  "Image position",
  "Image alt text",
  "Gift card",
] as const;

type Column = (typeof CSV_COLUMNS)[number];

const cell = (v: string | undefined) => {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toShopifyCsv(inputs: ProductSetInput[]): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const p of inputs) {
    p.variants.forEach((v, i) => {
      const first = i === 0;
      const row: Partial<Record<Column, string>> = {
        "URL handle": p.handle,
        SKU: v.inventoryItem.sku,
        "Option1 name": first ? p.productOptions[0].name : "",
        "Option1 value": v.optionValues[0].name,
        Price: v.price,
        // Ohne Kosten (echte Entwürfe tragen nie Einkaufskosten) bleibt die Zelle leer
        "Cost per item": v.inventoryItem.cost ?? "",
        "Charge tax": String(v.taxable),
        "Inventory tracker": v.inventoryItem.tracked ? "shopify" : "",
        "Inventory quantity": "0",
        "Continue selling when out of stock": v.inventoryPolicy.toLowerCase(),
        "Requires shipping": String(v.inventoryItem.requiresShipping),
        "Fulfillment service": "manual",
      };
      if (first) {
        Object.assign(row, {
          Title: p.title,
          Description: p.descriptionHtml,
          Vendor: p.vendor,
          Type: p.productType,
          Tags: p.tags.join(", "),
          "Published on online store": "false",
          Status: p.status.toLowerCase(),
          "Gift card": "false",
          "Product image URL": p.files[0]?.originalSource,
          "Image position": p.files[0] ? "1" : undefined,
          "Image alt text": p.files[0]?.alt,
        });
      }
      lines.push(CSV_COLUMNS.map((c) => cell(row[c])).join(","));
    });
  }
  return lines.join("\n") + "\n";
}
