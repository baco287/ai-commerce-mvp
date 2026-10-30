import "server-only";

/** Entfernt Geheimnisse aus Texten, bevor sie in Fehlermeldungen oder die Oberfläche gelangen. */
export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("[entfernt]");
  }
  // Zusätzlich typische Shopify-Token-Formate unkenntlich machen
  return out.replace(/\bshp(at|ss|ca|pa)_[A-Za-z0-9]+/g, "shp$1_[entfernt]");
}

export class ShopifyConnectionError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "scope" | "network" | "api" | "readonly",
  ) {
    super(message);
    this.name = "ShopifyConnectionError";
  }
}
