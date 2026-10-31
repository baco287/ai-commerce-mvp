// Lieferanten-Adapter: einheitliche, rein lesende Schnittstelle zu Lieferantenquellen.
//
// Ein Adapter liefert nur Angebotsdaten. Er bestellt nie, bezahlt nie und legt keine Konten an.
// Einkäufe laufen später ausschließlich über die Einkaufssperre (lib/guards/purchase.ts).

import { SAFETY_SWITCHES } from "@/lib/config/budget";
import type { ProductQuery, SupplierQuote } from "./model";

/** Woher ein Adapter seine Daten bezieht. */
export type SupplierSourceKind = "demo" | "manual" | "feed" | "api";

export interface SupplierAdapterInfo {
  id: string;
  name: string;
  kind: SupplierSourceKind;
  /** Verursacht der Abruf Kosten (API-Gebühr, Abo, Guthaben)? Dann nur mit SAFETY_SWITCHES.paidApiCallsEnabled. */
  paid: boolean;
  /** Braucht der Adapter Netzwerkzugriff? Nur serverseitig und erst nach ausdrücklicher Freigabe. */
  network: boolean;
}

export interface SupplierAdapter {
  readonly info: SupplierAdapterInfo;
  /**
   * Angebote dieses Lieferanten bzw. dieser Quelle für ein Produkt.
   * Leeres Array = Produkt nicht im Sortiment. Fehler dürfen geworfen werden; der Scout fängt sie ab.
   */
  findQuotes(query: ProductQuery): Promise<SupplierQuote[]>;
}

export interface AdapterPolicy {
  paidApiCallsEnabled: boolean;
  /** Netzwerk-Adapter zulassen. Es gibt dafür bewusst keinen globalen Schalter – Standard ist aus. */
  networkAllowed: boolean;
}

export const DEFAULT_ADAPTER_POLICY: AdapterPolicy = {
  paidApiCallsEnabled: SAFETY_SWITCHES.paidApiCallsEnabled,
  networkAllowed: false,
};

/** Grund, warum ein Adapter nicht abgefragt werden darf – oder null, wenn er erlaubt ist. */
export function adapterBlockReason(info: SupplierAdapterInfo, policy: AdapterPolicy = DEFAULT_ADAPTER_POLICY): string | null {
  if (info.paid && !policy.paidApiCallsEnabled) {
    return `Adapter „${info.name}“ ist kostenpflichtig; kostenpflichtige API-Aufrufe sind gesperrt.`;
  }
  if (info.network && !policy.networkAllowed) {
    return `Adapter „${info.name}“ braucht Netzwerkzugriff; externe Lieferantenquellen sind noch nicht freigegeben.`;
  }
  return null;
}
