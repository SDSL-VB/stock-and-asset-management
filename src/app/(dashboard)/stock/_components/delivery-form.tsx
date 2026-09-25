"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileUp, Loader2, PackageCheck, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductCombobox, type ProductOption } from "@/components/shared/product-combobox";
import { createDelivery } from "@/lib/actions/deliveries";
import { formatMoney } from "@/lib/format";
import { toneStyles } from "@/lib/design/status";
import { cn } from "@/lib/utils";
import type { OpenOrderLine } from "./purchase-order-picker";
import { readCsvTable, cell } from "@/lib/csv-import";
import {
  deliveryImportTemplate,
  downloadTemplate,
  DELIVERY_IMPORT_REQUIRED,
  DELIVERY_IMPORT_ALIASES,
  OTHER_IMPORTS,
} from "@/lib/import-formats";

/**
 * Booking in a delivery: several products that arrived together.
 *
 * The vendor, invoice number and site are asked once; then one line per
 * product — from any category — with its quantity, unit price, the rack it is
 * put away on ("10.3" = rack 10, row 3) and, for those allowed, a batch. If
 * the vendor has open purchase orders for this site, their outstanding lines
 * can be added with one press each, already linked to the order.
 *
 * A long delivery note can be filled in from a spreadsheet instead of typed:
 * "Upload a CSV" reads product code, quantity, price, batch, rack and — when
 * the goods answer an order — the purchase order number, shows what each row
 * would add, and fills the lines once that is accepted. It fills the form
 * rather than saving anything, so every line is still checked on screen and
 * corrected before it becomes stock, which is the point of the form.
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

/** One row of an uploaded file, judged before anything is filled in. */
type PreviewLine = {
  /** The row in the spreadsheet, counting the headings as row 1 */
  line: number;
  code: string;
  productId: string | null;
  productName: string | null;
  quantity: string;
  unitPrice: string;
  batchNumber: string;
  rackLocation: string;
  poNumber: string;
  /** The order line this will be booked against, when the row named one */
  orderLineId: string | null;
  status: "ready" | "error";
  message: string;
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
  const fileInput = useRef<HTMLInputElement>(null);
  /** What an uploaded file would add, until it is accepted */
  const [preview, setPreview] = useState<PreviewLine[] | null>(null);

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


  /**
   * Read a spreadsheet and show what it would put on the form.
   *
   * Nothing is filled in until the preview is accepted, and nothing is sent
   * anywhere: the file is read in the browser and only ever fills these
   * fields, so the delivery is still saved by the same action, with the same
   * checks, as one typed by hand.
   *
   * Each row is judged the way the form judges a line — the code has to be in
   * the catalog, the quantity has to be a whole number above zero — plus one
   * thing only a file can get wrong: naming a purchase order. A row that names
   * one is linked to that order's outstanding line, so the order knows the
   * goods arrived; a row that names an order this vendor does not have open at
   * this site is refused rather than quietly booked in as loose stock.
   */
  async function previewFile(file: File) {
    const read = readCsvTable(
      await file.text(),
      DELIVERY_IMPORT_REQUIRED,
      DELIVERY_IMPORT_ALIASES,
      OTHER_IMPORTS.delivery
    );
    if ("error" in read) {
      toast.error(read.error);
      return;
    }

    const byCode = new Map(products.map((p) => [p.code.trim().toLowerCase(), p]));
    const alreadyUsed = new Set(lines.map((l) => l.purchaseOrderLineId).filter(Boolean) as string[]);
    const rows: PreviewLine[] = [];

    for (const [i, row] of read.table.rows.entries()) {
      const code = cell(row, "Product Code");
      const quantity = cell(row, "Quantity");
      const poNumber = cell(row, "Purchase Order").toUpperCase();
      const base = {
        line: i + 2,
        code,
        quantity,
        unitPrice: cell(row, "Unit Price"),
        batchNumber: canSetBatch ? cell(row, "Batch Number") : "",
        rackLocation: cell(row, "Rack"),
        poNumber,
      };
      const refuse = (message: string): PreviewLine => ({
        ...base,
        productId: null,
        productName: null,
        orderLineId: null,
        status: "error",
        message,
      });

      const product = byCode.get(code.toLowerCase());
      if (!product) {
        rows.push(refuse(code ? `${code} is not in the catalog` : "No product code"));
        continue;
      }
      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty <= 0) {
        rows.push(refuse(`"${quantity}" is not a whole number of ${product.unit}`));
        continue;
      }
      if (base.unitPrice && !Number.isFinite(Number(base.unitPrice))) {
        rows.push(refuse(`"${base.unitPrice}" is not a price`));
        continue;
      }

      // ---- against an order, when the row names one ----
      let orderLineId: string | null = null;
      let note = "";
      if (poNumber) {
        if (!vendorId || !locationId) {
          rows.push(refuse("Choose the vendor and the site first — an order line belongs to both"));
          continue;
        }
        const candidates = openOrderLines.filter(
          (o) => o.poNumber.toUpperCase() === poNumber && o.productId === product.id
        );
        const match = candidates.find(
          (o) => o.vendorId === vendorId && o.locationId === locationId && !alreadyUsed.has(o.lineId)
        );
        if (!match) {
          rows.push(
            refuse(
              candidates.length === 0
                ? `${poNumber} has no open line for ${product.name}`
                : `${poNumber} is open for another vendor or site, or that line is already on this delivery`
            )
          );
          continue;
        }
        orderLineId = match.lineId;
        alreadyUsed.add(match.lineId);
        note =
          qty > match.outstanding
            ? `Against ${poNumber} — more than the ${match.outstanding} ${match.unit} still owed`
            : `Against ${poNumber} — ${match.outstanding} ${match.unit} still owed`;
      }

      rows.push({
        ...base,
        productId: product.id,
        productName: product.name,
        orderLineId,
        status: "ready",
        message: note || (base.unitPrice ? "" : "No price — type one before saving"),
      });
    }

    setPreview(rows);
  }

  /** Put the rows that passed onto the form. */
  function acceptPreview() {
    const ready = (preview ?? []).filter((r) => r.status === "ready");
    if (ready.length === 0) return;
    setLines((all) => [
      ...all.filter((l) => l.productId),
      ...ready.map((r) => ({
        key: nextKey++,
        productId: r.productId!,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        batchNumber: r.batchNumber,
        rackLocation: r.rackLocation,
        ...(r.orderLineId ? { purchaseOrderLineId: r.orderLineId, orderNote: r.message } : {}),
      })),
    ]);
    setPreview(null);
    toast.success(`${ready.length} line${ready.length === 1 ? "" : "s"} filled in`);
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
          {/* Offered before the typing starts, not after: a twenty-line
              delivery note is the case this exists for. */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed bg-muted/30 p-2.5">
            <FileUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="mr-auto min-w-[12rem] flex-1 text-sm">
              Got a long list? Fill these lines from a spreadsheet instead of typing them.
              Name a purchase order on a row and the line is booked against it.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => downloadTemplate(deliveryImportTemplate(), "delivery-lines-template.csv")}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Template
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
              <FileUp className="mr-1.5 h-4 w-4" />
              Upload a CSV
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,.xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void previewFile(file);
                e.target.value = "";
              }}
            />
          </div>

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

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/stock")} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving || !ready}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save delivery and attach documents
        </Button>
      </div>

      <ImportPreviewDialog
        rows={preview}
        onCancel={() => setPreview(null)}
        onAccept={acceptPreview}
      />
    </div>
  );
}

/**
 * What an uploaded file would put on the form, row by row, before it does.
 *
 * The same rehearsal the product and category uploads give, for the same
 * reason: a delivery note of thirty lines is exactly where a wrong code or a
 * misspelled order number hides, and finding it after the entries are drafted
 * means unpicking thirty of them.
 */
function ImportPreviewDialog({
  rows,
  onCancel,
  onAccept,
}: {
  rows: PreviewLine[] | null;
  onCancel: () => void;
  onAccept: () => void;
}) {
  const ready = rows?.filter((r) => r.status === "ready").length ?? 0;
  const bad = rows?.filter((r) => r.status === "error").length ?? 0;
  const linked = rows?.filter((r) => r.orderLineId).length ?? 0;

  return (
    <Dialog open={rows !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>What this file will add</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline" className={toneStyles("info").pill}>{ready} ready</Badge>
            {linked > 0 && (
              <Badge variant="outline" className={toneStyles("approved").pill}>
                {linked} against an order
              </Badge>
            )}
            {bad > 0 && (
              <Badge variant="outline" className={toneStyles("rejected").pill}>
                {bad} cannot be added
              </Badge>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto rounded-md border">
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="w-12 px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Product</th>
                    <th className="w-20 px-3 py-2 text-right font-medium">Qty</th>
                    <th className="w-24 px-3 py-2 text-right font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {rows?.map((r) => (
                    <tr key={r.line} className={cn("border-t align-top", r.status === "error" && "bg-destructive/5")}>
                      <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{r.line}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{r.productName ?? r.code}</span>
                        <span className="block font-mono text-micro text-muted-foreground">
                          {r.code}
                          {r.rackLocation ? ` · rack ${r.rackLocation}` : ""}
                          {r.batchNumber ? ` · batch ${r.batchNumber}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.unitPrice || "—"}</td>
                      <td className={cn("px-3 py-2 text-xs", r.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                        {r.message || "Ready"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* A phone gets a list: five columns at 360px is unreadable */}
            <ul className="divide-y sm:hidden">
              {rows?.map((r) => (
                <li key={r.line} className={cn("px-3 py-2", r.status === "error" && "bg-destructive/5")}>
                  <p className="flex items-baseline gap-2">
                    <span className="text-xs text-muted-foreground tabular-nums">{r.line}</span>
                    <span className="min-w-0 flex-1 break-words font-medium">{r.productName ?? r.code}</span>
                    <span className="tabular-nums">{r.quantity}</span>
                  </p>
                  <p className="font-mono text-micro text-muted-foreground">{r.code}</p>
                  <p className={cn("text-xs", r.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                    {r.message || "Ready"}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onAccept} disabled={ready === 0}>
              Fill in {ready} line{ready === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
