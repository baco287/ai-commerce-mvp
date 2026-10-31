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

/**
 * Richtlinie je Scout-Lauf. Sie kann nur ZUSÄTZLICH einschränken: Kostenpflichtige Adapter brauchen
 * immer auch den globalen Schalter SAFETY_SWITCHES.paidApiCallsEnabled – eine Richtlinie allein
 * schaltet sie nie frei.
 */
export interface AdapterPolicy {
  paidApiCallsEnabled: boolean;
  /** Netzwerk-Adapter zulassen. Es gibt dafür bewusst keinen globalen Schalter – Standard ist aus. */
  networkAllowed: boolean;
}

export const DEFAULT_ADAPTER_POLICY: Readonly<AdapterPolicy> = Object.freeze({
  paidApiCallsEnabled: SAFETY_SWITCHES.paidApiCallsEnabled,
  networkAllowed: false,
});

/** Grund, warum ein Adapter nicht abgefragt werden darf – oder null, wenn er erlaubt ist. */
export function adapterBlockReason(info: SupplierAdapterInfo, policy: AdapterPolicy = DEFAULT_ADAPTER_POLICY): string | null {
  // Der globale Schalter wird hier direkt geprüft, nicht über die übergebene Richtlinie.
  const paidAllowed = SAFETY_SWITCHES.paidApiCallsEnabled && policy.paidApiCallsEnabled;
  if (info.paid && !paidAllowed) {
    return `Adapter „${info.name}“ ist kostenpflichtig; kostenpflichtige API-Aufrufe sind gesperrt.`;
  }
  if (info.network && !policy.networkAllowed) {
    return `Adapter „${info.name}“ braucht Netzwerkzugriff; externe Lieferantenquellen sind noch nicht freigegeben.`;
  }
  return null;
}
