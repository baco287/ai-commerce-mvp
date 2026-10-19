// DEMODATEN – fiktive Produktideen mit simulierten Nachfragesignalen.
// Keine echten Markt- oder Verkaufszahlen.

import type { Product } from "@/lib/types";

export const DEMO_PRODUCTS: Product[] = [
  {
    id: "p-led",
    name: "LED-Lichtleiste mit App-Steuerung (5 m)",
    category: "Wohnen & Licht",
    targetPriceGross: 29.9,
    signals: { searchTrend: 82, socialBuzz: 76, competition: 58, seasonality: 85 },
    complianceNotes: ["CE-Kennzeichnung & Konformitätserklärung", "ElektroG/WEEE-Registrierung", "Verpackungsregister (LUCID)"],
  },
  {
    id: "p-stand",
    name: "Faltbarer Laptopständer aus Aluminium",
    category: "Büro & Homeoffice",
    targetPriceGross: 34.9,
    signals: { searchTrend: 70, socialBuzz: 58, competition: 62, seasonality: 60 },
    complianceNotes: ["GPSR-Produktsicherheit & Herstellerangaben", "Verpackungsregister (LUCID)"],
  },
  {
    id: "p-cable",
    name: "Magnetische Kabel-Organizer (10er-Set)",
    category: "Zubehör",
    targetPriceGross: 14.9,
    signals: { searchTrend: 64, socialBuzz: 72, competition: 75, seasonality: 50 },
    complianceNotes: ["GPSR: Warnhinweis Magnete/Kleinteile", "Verpackungsregister (LUCID)"],
  },
  {
    id: "p-bottle",
    name: "Isolierte Edelstahl-Trinkflasche 750 ml",
    category: "Küche & Outdoor",
    targetPriceGross: 24.9,
    signals: { searchTrend: 78, socialBuzz: 70, competition: 55, seasonality: 80 },
    complianceNotes: ["Lebensmittelkontakt (LFGB/EU 1935/2004) nachweisen", "Verpackungsregister (LUCID)"],
  },
  {
    id: "p-band",
    name: "Silikon-Uhrenarmband (3er-Set)",
    category: "Accessoires",
    targetPriceGross: 12.9,
    signals: { searchTrend: 55, socialBuzz: 48, competition: 88, seasonality: 40 },
    complianceNotes: ["Markenrechte prüfen (Kompatibilitätsangaben)", "Verpackungsregister (LUCID)"],
  },
];
