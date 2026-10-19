// DEMODATEN – simulierte Bestellungen. Es gibt noch keinen echten Shop und keine echten Verkäufe.
// Die Simulation ist deterministisch (fester Seed), damit Server und Browser dieselben Zahlen zeigen.

import type { DemoOrder, PaymentStatus } from "@/lib/types";
import { DEMO_PRODUCTS } from "./products";

/** Letzter Tag des simulierten Zeitraums. */
export const DEMO_TODAY = "2026-10-19";
/** Länge des simulierten Zeitraums in Tagen. */
export const DEMO_DAYS = 14;

/** Relative Verkaufshäufigkeit je Produkt in der Simulation. */
const WEIGHTS: Record<string, number> = { "p-led": 3, "p-stand": 2, "p-cable": 2, "p-bottle": 3, "p-band": 1 };

/** Kleiner deterministischer Zufallsgenerator (mulberry32). */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function paymentStatusFor(ageDays: number, r: number): PaymentStatus {
  if (ageDays === 0) return r < 0.35 ? "pending" : r < 0.6 ? "authorized" : "captured";
  if (ageDays < 7) return "captured";
  return "paid_out";
}

function simulateOrders(): DemoOrder[] {
  const rand = seeded(20261019);
  const totalWeight = Object.values(WEIGHTS).reduce((s, w) => s + w, 0);
  const pickProduct = () => {
    let r = rand() * totalWeight;
    for (const p of DEMO_PRODUCTS) {
      r -= WEIGHTS[p.id] ?? 0;
      if (r <= 0) return p;
    }
    return DEMO_PRODUCTS[0];
  };

  const end = new Date(`${DEMO_TODAY}T00:00:00Z`);
  const orders: DemoOrder[] = [];
  for (let age = DEMO_DAYS - 1; age >= 0; age--) {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - age);
    const count = 1 + Math.floor(rand() * 5);
    const times = Array.from({ length: count }, () => 6 * 60 + Math.floor(rand() * 15 * 60)).sort((a, b) => a - b);
    for (const minutes of times) {
      const product = pickProduct();
      const at = new Date(day);
      at.setUTCMinutes(minutes);
      orders.push({
        id: `DEMO-${String(orders.length + 1001)}`,
        createdAt: at.toISOString(),
        productId: product.id,
        quantity: rand() < 0.85 ? 1 : 2,
        priceGross: product.targetPriceGross,
        paymentStatus: paymentStatusFor(age, rand()),
      });
    }
  }
  return orders;
}

export const DEMO_ORDERS: DemoOrder[] = simulateOrders();
