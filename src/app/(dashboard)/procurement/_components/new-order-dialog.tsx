"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createPurchaseOrder } from "@/lib/actions/procurement";
import { toast } from "sonner";
import { Plus, Loader2, Trash2, X } from "lucide-react";

type Orderable = {
  id: string;
  intentNumber: string;
  quantity: number;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  vendorId: string | null;
  vendorName: string | null;
  locationId: string | null;
  departmentName: string | null;
  requestedByName: string;
  neededBy: Date | null;
};

type Line = {
  key: string;
  intentId?: string;
  intentNumber?: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: string;
  unitPrice: string;
};

interface Props {
  vendors: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  orderableIntents: Orderable[];
  requiresApproval: boolean;
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Turning stated needs into an order for one vendor.
 *
 * Needs are the starting point rather than a free-form product picker, because
 * an order that answers nobody's need is usually a mistake — and picking one
 * fills in the product, the quantity and often the vendor.
 */
export function NewOrderDialog({
  vendors,
  locations,
  orderableIntents,
  requiresApproval,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, startSaving] = useTransition();

  const [vendorId, setVendorId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  // One order goes to one vendor, so once a vendor is chosen only the needs
  // that suit them are offered — a need with no preference suits anyone.
  const available = useMemo(() => {
    const taken = new Set(lines.map((l) => l.intentId).filter(Boolean));
    return orderableIntents.filter(
      (i) => !taken.has(i.id) && (!vendorId || !i.vendorId || i.vendorId === vendorId)
    );
  }, [orderableIntents, lines, vendorId]);

  function addIntent(intent: Orderable) {
    // The first need chosen sets the vendor and site, so the common case is one
    // click rather than three.
    if (!vendorId && intent.vendorId) setVendorId(intent.vendorId);
    if (!locationId && intent.locationId) setLocationId(intent.locationId);
    setLines((prev) => [
      ...prev,
      {
        key: `${intent.id}-${prev.length}`,
        intentId: intent.id,
        intentNumber: intent.intentNumber,
        productId: intent.productId,
        productCode: intent.productCode,
        productName: intent.productName,
        unit: intent.unit,
        quantity: String(intent.quantity),
        unitPrice: "",
      },
    ]);
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function reset() {
    setVendorId("");
    setLocationId("");
    setExpectedDate("");
    setNotes("");
    setLines([]);
  }

  const total = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
    0
  );

  function submit() {
    if (lines.length === 0) {
      toast.error("Add at least one line");
      return;
    }
    if (lines.some((l) => l.unitPrice === "")) {
      toast.error("Every line needs a price — that is what the vendor is agreeing to");
      return;
    }
    startSaving(async () => {
      const result = await createPurchaseOrder({
        vendorId,
        locationId,
        expectedDate: expectedDate || undefined,
        notes,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          intentId: l.intentId,
        })),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Raised ${result.order?.poNumber ?? "the order"}`);
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" />
        New order
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Raise a purchase order</DialogTitle>
          <DialogDescription>
            One vendor, one delivery site, and the lines they are being asked to supply.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>Vendor</Label>
              <Select
                value={vendorId}
                items={vendors.map((v) => ({ value: v.id, label: v.name }))}
                onValueChange={(v) => setVendorId((v as string) ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Deliver to</Label>
              <Select
                value={locationId}
                items={locations.map((l) => ({ value: l.id, label: l.name }))}
                onValueChange={(v) => setLocationId((v as string) ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a site" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="po-expected">Expected (optional)</Label>
              <Input
                id="po-expected"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Needs waiting to be ordered</Label>
            {available.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                {orderableIntents.length === 0
                  ? requiresApproval
                    ? "Nothing has been verified yet. A need has to be verified before it can go on an order."
                    : "Nobody has stated a need yet."
                  : "Every waiting need is either already on this order or suits a different vendor."}
              </p>
            ) : (
              <div className="max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {available.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => addIntent(i)}
                    className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-medium">
                        {i.quantity} {i.unit} · {i.productName}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {i.intentNumber} · {i.requestedByName}
                        {i.departmentName ? ` (${i.departmentName})` : ""}
                      </span>
                    </span>
                    {i.vendorName && (
                      <Badge variant="outline" className="shrink-0">
                        {i.vendorName}
                      </Badge>
                    )}
                    <Plus className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Order lines</Label>
            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                Pick a need above to start the order.
              </p>
            ) : (
              <div className="space-y-2">
                {lines.map((l) => (
                  <div
                    key={l.key}
                    className="flex min-w-0 flex-wrap items-end gap-3 rounded-md border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{l.productName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {l.productCode}
                        {l.intentNumber ? ` · ${l.intentNumber}` : ""}
                      </p>
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs">Qty ({l.unit})</Label>
                      <Input
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="w-28 space-y-1">
                      <Label className="text-xs">Unit price</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.unitPrice}
                        placeholder="0.00"
                        onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                      />
                    </div>
                    <div className="w-24 shrink-0 text-right text-sm tabular-nums">
                      {formatMoney((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0))}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLine(l.key)}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <div className="flex justify-end gap-3 pt-1 text-sm">
                  <span className="text-muted-foreground">Order total</span>
                  <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="po-notes">Notes (optional)</Label>
            <Textarea
              id="po-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Delivery instructions, payment terms, a quote reference"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            <X className="size-4" />
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || lines.length === 0 || !vendorId || !locationId}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Place order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
