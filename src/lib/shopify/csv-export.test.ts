// Hält storefront/data/demo-products.csv synchron zu den Dashboard-Daten.
// Schlägt fehl, wenn die Datei von Hand geändert wurde oder die Kalkulation sich geändert hat.
// Datei neu erzeugen: `npm run shopify:csv`

import { describe, expect, it } from "vitest";
import { getProductAnalyses } from "@/lib/data";
import { toShopifyCsv } from "./csv";
import { planProductSync } from "./sync";

describe("Shopify-Import-CSV", () => {
  it("entspricht exakt den Dashboard-Daten", async () => {
    const csv = toShopifyCsv(planProductSync(getProductAnalyses()).map((p) => p.input));
    await expect(csv).toMatchFileSnapshot("../../../storefront/data/demo-products.csv");
  });
});
