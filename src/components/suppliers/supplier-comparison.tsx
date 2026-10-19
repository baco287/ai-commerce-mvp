"use client";

import { Award, Lock, Star } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import type { OfferEvaluation } from "@/lib/calc/suppliers";
import { formatDays, formatEur, formatPercent, formatRating } from "@/lib/format";
import { PAYMENT_TERMS_LABEL, REGION_LABEL } from "@/lib/labels";

export interface SupplierComparisonItem {
  productId: string;
  productName: string;
  priceGross: number;
  offers: OfferEvaluation[];
  /** Deckungsbeitrag und Marge je Angebot (gleiche Reihenfolge wie offers) */
  margins: { contribution: number; marginPercent: number }[];
}

/** Produktauswahl + Angebotsvergleich. Bestellungen sind im MVP gesperrt. */
export function SupplierComparison({ items }: { items: SupplierComparisonItem[] }) {
  const [selected, setSelected] = useState(items[0]?.productId);
  const item = items.find((i) => i.productId === selected) ?? items[0];
  if (!item) return null;

  return (
    <div>
      <div role="tablist" aria-label="Produkt wählen" className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-3">
        {items.map((i) => {
          const active = i.productId === item.productId;
          return (
            <button
              key={i.productId}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setSelected(i.productId)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors ${
                active ? "border-cyan-400 text-fg" : "border-transparent text-muted hover:text-fg"
              }`}
            >
              {i.productName}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-xs text-muted">
        <span>
          Verkaufspreis <span className="font-medium tabular-nums text-fg">{formatEur(item.priceGross)}</span> brutto
        </span>
        <span>{item.offers.length} Angebote · sortiert nach Gesamtkosten</span>
      </div>

      <Table minWidth={1080}>
        <thead>
          <tr>
            <Th>Lieferant</Th>
            <Th>Herkunft</Th>
            <Th align="right">Einkauf</Th>
            <Th align="right">Versand</Th>
            <Th align="right">Import</Th>
            <Th align="right">Gesamt</Th>
            <Th>Lieferzeit</Th>
            <Th>Bewertung</Th>
            <Th align="right">Bestand</Th>
            <Th>Zahlung</Th>
            <Th align="right">Marge</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {item.offers.map((e, idx) => {
            const m = item.margins[idx];
            return (
              <tr key={e.offer.id} className={e.isBest ? "bg-cyan-400/[0.06]" : e.eligible ? "" : "opacity-75"}>
                <Td>
                  <div className="flex items-center gap-2 font-medium">
                    {e.isBest && <Award className="size-4 shrink-0 text-cyan-300" aria-label="Günstigster geeigneter Lieferant" />}
                    {e.offer.supplierName}
                  </div>
                </Td>
                <Td>
                  <div className="text-fg">{REGION_LABEL[e.offer.region]}</div>
                  <div className="text-xs text-subtle">{e.offer.warehouse}</div>
                </Td>
                <Td align="right">{formatEur(e.offer.unitPrice)}</Td>
                <Td align="right">{formatEur(e.offer.shippingCost)}</Td>
                <Td align="right">{e.offer.importCost > 0 ? formatEur(e.offer.importCost) : "–"}</Td>
                <Td align="right" className="font-semibold">
                  {formatEur(e.landedCost)}
                </Td>
                <Td className="tabular-nums">{formatDays(e.offer.deliveryDaysMin, e.offer.deliveryDaysMax)}</Td>
                <Td>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <Star className="size-3.5 fill-amber-300 text-amber-300" aria-hidden />
                    {formatRating(e.offer.rating)}
                  </span>
                </Td>
                <Td align="right">{e.offer.stock.toLocaleString("de-DE")}</Td>
                <Td>
                  <Badge tone={e.offer.paymentTerms === "vorkasse" ? "amber" : "green"}>{PAYMENT_TERMS_LABEL[e.offer.paymentTerms]}</Badge>
                </Td>
                <Td align="right" className={m.contribution < 0 ? "text-rose-300" : ""}>
                  <div>{formatEur(m.contribution)}</div>
                  <div className="text-xs text-subtle">{formatPercent(m.marginPercent)}</div>
                </Td>
                <Td>
                  {e.isBest ? (
                    <Badge tone="cyan">Günstigster geeigneter</Badge>
                  ) : e.eligible ? (
                    <Badge tone="green">Geeignet</Badge>
                  ) : (
                    <div className="space-y-1">
                      <Badge tone="red">Nicht geeignet</Badge>
                      {e.issues.map((issue) => (
                        <p key={issue} className="text-[11px] leading-snug text-subtle">
                          {issue}
                        </p>
                      ))}
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="text-xs text-muted">Marge = Deckungsbeitrag nach MwSt., Zahlungsgebühr, Werbekosten und Retourenreserve.</p>
        <button
          type="button"
          disabled
          title="Echte Bestellungen sind im MVP deaktiviert"
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-subtle"
        >
          <Lock className="size-3.5" aria-hidden /> Bestellen – im MVP gesperrt
        </button>
      </div>
    </div>
  );
}
