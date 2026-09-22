"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackageCheck, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductCombobox, type ProductOption } from "@/components/shared/product-combobox";
import { createDelivery } from "@/lib/actions/deliveries";
import { formatMoney } from "@/lib/format";
import type { OpenOrderLine } from "./purchase-order-picker";

/**
 * Booking in a delivery: several products that arrived together.
 *
 * The vendor, invoice number and site are asked once; then one line per
 * product — from any category — with its quantity, unit price, the rack it is
 * put away on ("10.3" = rack 10, row 3) and, for those allowed, a batch. If
 * the vendor has open purchase orders for this site, their outstanding lines
 * can be added with one press each, already linked to the order.
 *
 * Saving creates a DRAFT stock entry per line under one delivery number and
 * opens the delivery, where the invoice is attached once and everything is
 * submitted together. See src/lib/actions/deliveries.ts.
 */

type Product = ProductOption & { unit: string };
type Line = {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
  batchNumber: string;
  rackLocation: string;
  purchaseOrderLineId?: string;
  /** Shown under the product for a line taken from an order */
  orderNote?: string;
};

let nextKey = 1;
const emptyLine = (): Line => ({ key: nextKey++, productId: "", quantity: "", unitPrice: "", batchNumber: "", rackLocation: "" });

export function DeliveryForm({
  products,
  vendors,
  locations,
  defaultLocationId,
  openOrderLines,
  canSetBatch,
}: {
  products: Product[];
  vendors: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  defaultLocationId?: string | null;
  openOrderLines: OpenOrderLine[];
  canSetBatch: boolean;
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const [vendorId, setVendorId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [locationId, setLocationId] = useState(defaultLocationId ?? locations[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);

  const byId = new Map(products.map((p) => [p.id, p]));
  const update = (key: number, patch: Partial<Line>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Order lines from this vendor, for this site, not already on the delivery
  const usedOrderLines = new Set(lines.map((l) => l.purchaseOrderLineId).filter(Boolean));
  const offered = openOrderLines.filter(
    (o) => o.vendorId === vendorId && o.locationId === locationId && !usedOrderLines.has(o.lineId)
  );

  function addFromOrder(o: OpenOrderLine) {
    const line: Line = {
      key: nextKey++,
      productId: o.productId,
      quantity: String(o.outstanding),
      unitPrice: "",
      batchNumber: "",
      rackLocation: "",
      purchaseOrderLineId: o.lineId,
      orderNote: `Against ${o.poNumber} — ${o.outstanding} ${o.unit} still owed`,
    };
    // Fill the first empty row rather than leaving it dangling above
    setLines((all) => {
      const blank = all.findIndex((l) => !l.productId);
      return blank >= 0 ? all.map((l, i) => (i === blank ? line : l)) : [...all, line];
    });
  }

  const filled = lines.filter((l) => l.productId);
  const total = filled.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const ready =
    vendorId &&
    locationId &&
    filled.length > 0 &&
    filled.every((l) => Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0 && Number(l.unitPrice) > 0);

  function save() {
    startSaving(async () => {
      const res = await createDelivery({
        vendorId,
        invoiceNumber: invoiceNumber.trim() || undefined,
        locationId,
        lines: filled.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          batchNumber: l.batchNumber.trim() || undefined,
          rackLocation: l.rackLocation.trim() || undefined,
          purchaseOrderLineId: l.purchaseOrderLineId,
        })),
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.deliveryNumber} saved — now attach the invoice and submit`);
      router.push(`/stock/delivery/${res.deliveryId}`);
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">The delivery</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Vendor *</Label>
            <Select
              value={vendorId}
              items={vendors.map((v) => ({ value: v.id, label: v.name }))}
              onValueChange={(v) => setVendorId((v as string) ?? "")}
            >
              <SelectTrigger><SelectValue placeholder="Who sent it" /></SelectTrigger>
              <SelectContent>
                {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dlv-invoice">Invoice number</Label>
            <Input id="dlv-invoice" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <Label>Received at *</Label>
            <Select
              value={locationId}
              items={locations.map((l) => ({ value: l.id, label: l.name }))}
              onValueChange={(v) => setLocationId((v as string) ?? "")}
            >
              <SelectTrigger><SelectValue placeholder="Pick a site" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {offered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Still owed on this vendor&apos;s orders</CardTitle>
            <p className="text-caption text-muted-foreground">
              Add a line straight from an order — it is linked to the order, so the order knows it arrived.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {offered.map((o) => (
                <li key={o.lineId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-mono text-xs text-muted-foreground">{o.poNumber}</span> {o.productName}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {o.outstanding} {o.unit} of {o.ordered} still owed
                    </span>
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={() => addFromOrder(o)}>
                    <PackageCheck className="h-4 w-4" />
                    Add this line
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">What arrived</CardTitle>
          <p className="text-caption text-muted-foreground">
            One line per product, from any category. Search by code, name or description.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className={`hidden gap-2 px-2.5 text-caption text-muted-foreground sm:grid ${canSetBatch ? "sm:grid-cols-[1fr_80px_100px_80px_110px_100px_32px]" : "sm:grid-cols-[1fr_80px_100px_80px_100px_32px]"}`}>
            <span>Product</span>
            <span>Quantity</span>
            <span>Unit price (₹)</span>
            <span>Rack</span>
            {canSetBatch && <span>Batch</span>}
            <span className="text-right">Total</span>
            <span />
          </div>
          {lines.map((line) => {
            const product = byId.get(line.productId);
            const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
            return (
              <div
                key={line.key}
                className={`grid gap-2 rounded-md border p-2.5 sm:items-start ${canSetBatch ? "sm:grid-cols-[1fr_80px_100px_80px_110px_100px_32px]" : "sm:grid-cols-[1fr_80px_100px_80px_100px_32px]"}`}
              >
                <div className="min-w-0 space-y-1">
                  <ProductCombobox
                    products={products}
                    value={line.productId}
                    disabled={!!line.purchaseOrderLineId}
                    onChange={(id) => update(line.key, { productId: id })}
                  />
                  {product && (
                    <p className="text-micro text-muted-foreground">
                      {product.category?.name}
                      {line.orderNote ? ` · ${line.orderNote}` : ""}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={line.quantity}
                    onChange={(e) => update(line.key, { quantity: e.target.value })}
                    aria-label="Quantity"
                  />
                  {product && <p className="text-micro text-muted-foreground">{product.unit}</p>}
                </div>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                  aria-label="Unit price"
                />
                <Input
                  value={line.rackLocation}
                  onChange={(e) => update(line.key, { rackLocation: e.target.value.toUpperCase() })}
                  placeholder="10.3"
                  aria-label="Rack (rack.row)"
                  className="font-mono"
                />
                {canSetBatch && (
                  <Input
                    value={line.batchNumber}
                    onChange={(e) => update(line.key, { batchNumber: e.target.value })}
                    placeholder="Optional"
                    aria-label="Batch number"
                  />
                )}
                <p className="self-center text-right text-sm tabular-nums">{lineTotal > 0 ? formatMoney(lineTotal) : "—"}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Remove this line"
                  disabled={lines.length === 1}
                  onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((all) => [...all, emptyLine()])}>
              <Plus className="h-4 w-4" />
              Add another item
            </Button>
            <p className="text-sm">
              {filled.length} item{filled.length === 1 ? "" : "s"} · total{" "}
              <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/stock")} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || !ready}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save delivery and attach documents
        </Button>
      </div>
    </div>
  );
}
