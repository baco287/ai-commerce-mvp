// Rendert die Yakaru-Produkt-Illustrationen als PNG (für Shopify-Produktbilder) und legt die
// SVG-Quellen daneben ab. Aufruf: npm run images   (im Ordner storefront/)

import { mkdirSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { PRODUCT_ART, SIZE } from "./product-art.mjs";

const outDir = new URL("../data/images/", import.meta.url);
mkdirSync(outDir, { recursive: true });

for (const [handle, art] of Object.entries(PRODUCT_ART)) {
  const svg = art.svg();
  writeFileSync(new URL(`${handle}.svg`, outDir), svg, "utf8");
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  })
    .render()
    .asPng();
  writeFileSync(new URL(`${handle}.png`, outDir), png);
  console.log(`${handle}.png  ${(png.length / 1024).toFixed(0)} KB`);
}

// Startseiten-Grafik direkt als Theme-Asset (SVG, wird vom Browser gerendert)
const { heroSvg } = await import("./product-art.mjs");
writeFileSync(new URL("../assets/yakaru-hero.svg", import.meta.url), heroSvg(), "utf8");
const heroPng = new Resvg(heroSvg(), { fitTo: { mode: "width", value: 1000 } }).render().asPng();
writeFileSync(new URL("hero-preview.png", outDir), heroPng);
console.log("assets/yakaru-hero.svg (Vorschau: data/images/hero-preview.png)");
