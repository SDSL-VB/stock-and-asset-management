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
import { Plus, Loader2, Trash2, X, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { requestReason } from "@/lib/vocabulary";

/** A verified need waiting to go on an order. Shaped by getOrderableIntents(). */
export type Orderable = {
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
  locationName: string | null;
  departmentName: string | null;
  requestedByName: string;
  neededBy: Date | null;
  /** Set when this need was raised alongside others in one request */
  needListId: string | null;
  listNumber: string | null;
  listReason: string | null;
};

/**
 * What the picker offers: either a need on its own, or the needs of one
 * request clubbed together. Clubbing is by REQUEST, never by product — two
 * people asking for the same thing are two needs, and both have to be answered.
 */
type Offer =
  | { kind: "need"; need: Orderable }
  | { kind: "list"; id: string; listNumber: string; reason: string | null; needs: Orderable[] };

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
  /** Days the vendor promised; blank means no due date for this line */
  leadTimeDays: string;
  /** The site the need was raised for, to catch an order sent elsewhere */
  needLocationId: string | null;
  needLocationName: string | null;
};

interface Props {
  vendors: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  orderableIntents: Orderable[];
  requiresApproval: boolean;
  /** Recorded lead time for each product from each vendor */
  leadTimes: { productId: string; vendorId: string; leadTimeDays: number }[];
}

/**
 * Turning stated needs into an order for one vendor.
 *
 * Needs are the starting point rather than a free-form product picker, because
 * an order that answers nobody's need is usually a mistake — and picking one
 * fills in the product, the quantity and often the vendor.
 *
 * Each line carries the lead time the vendor promises, started from what that
 * vendor has on record for the product. It sets the date the line is due, and
 * the Orders tab then shows every line as on time, late or overdue against it
 * (src/lib/order-timing.ts).
 *
 * Needs raised in one request are offered as one entry that opens to show what
 * is in it, so a request for seven items is one thing to read and one click to
 * add. Needs for the SAME product from different people stay apart: they are
 * two asks and each has to be answered.
 *
 * An order delivers to one site, so a need raised for another site is not
 * offered and cannot be added — the server refuses it too. Otherwise the goods
 * would land where nobody asked for them.
 */
export function NewOrderDialog({
  vendors,
  locations,
  orderableIntents,
  requiresApproval,
  leadTimes,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, startSaving] = useTransition();

  const [vendorId, setVendorId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  // "Today", fixed when the dialog is created — due dates are counted from it
  const [openedAt] = useState(() => Date.now());
  const [lines, setLines] = useState<Line[]>([]);

  // One order goes to one vendor and one site, so once either is chosen only
  // the needs that suit are offered — a need that names neither suits any order.
  const available = useMemo(() => {
    const taken = new Set(lines.map((l) => l.intentId).filter(Boolean));
    return orderableIntents.filter(
      (i) =>
        !taken.has(i.id) &&
        (!vendorId || !i.vendorId || i.vendorId === vendorId) &&
        (!locationId || !i.locationId || i.locationId === locationId)
    );
  }, [orderableIntents, lines, vendorId, locationId]);

  // Needs raised together are shown together. A request down to its last
  // unordered need is just that need again — a group of one is only noise.
  const offers = useMemo<Offer[]>(() => {
    const out: Offer[] = [];
    const groups = new Map<string, Extract<Offer, { kind: "list" }>>();
    for (const need of available) {
      if (!need.needListId) {
        out.push({ kind: "need", need });
        continue;
      }
      let group = groups.get(need.needListId);
      if (!group) {
        group = {
          kind: "list",
          id: need.needListId,
          listNumber: need.listNumber ?? "",
          reason: requestReason(need.listReason),
          needs: [],
        };
        groups.set(need.needListId, group);
        out.push(group);
      }
      group.needs.push(need);
    }
    return out.map((o) => (o.kind === "list" && o.needs.length === 1 ? { kind: "need", need: o.needs[0] } : o));
  }, [available]);

  const [openList, setOpenList] = useState<string | null>(null);

  // Lines whose need was raised for somewhere else — only reachable by changing
  // the site after they were added, and the server refuses them anyway.
  const misplaced = lines.filter(
    (l) => l.needLocationId && locationId && l.needLocationId !== locationId
  );

  /** What this vendor has on record for the product, as the line's starting lead time */
  const recordedDays = (productId: string, forVendor: string) =>
    leadTimes.find((t) => t.productId === productId && t.vendorId === forVendor)?.leadTimeDays;

  /** Choosing (or changing) the vendor fills any lead time not typed yet */
  function chooseVendor(next: string) {
    setVendorId(next);
    setLines((prev) =>
      prev.map((l) => (l.leadTimeDays === "" ? { ...l, leadTimeDays: String(recordedDays(l.productId, next) ?? "") } : l))
    );
  }

  function addIntents(intents: Orderable[]) {
    if (intents.length === 0) return;
    // The first need chosen sets the vendor and site, so the common case is one
    // click rather than three.
    const [first] = intents;
    const lineVendor = vendorId || first.vendorId || "";
    if (!vendorId && first.vendorId) setVendorId(first.vendorId);
    if (!locationId && first.locationId) setLocationId(first.locationId);
    setLines((prev) => [
      ...prev,
      ...intents.map((intent, n) => ({
        key: `${intent.id}-${prev.length + n}`,
        intentId: intent.id,
        intentNumber: intent.intentNumber,
        productId: intent.productId,
        productCode: intent.productCode,
        productName: intent.productName,
        unit: intent.unit,
        quantity: String(intent.quantity),
        unitPrice: "",
        leadTimeDays: String((lineVendor && recordedDays(intent.productId, lineVendor)) ?? ""),
        needLocationId: intent.locationId,
        needLocationName: intent.locationName,
      })),
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
    setNotes("");
    setLines([]);
    setOpenList(null);
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
    if (misplaced.length > 0) {
      toast.error(`${misplaced[0].intentNumber ?? "A need"} was raised for another site — remove it or change where this order delivers`);
      return;
    }
    startSaving(async () => {
      const result = await createPurchaseOrder({
        vendorId,
        locationId,
        notes,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          intentId: l.intentId,
          leadTimeDays: l.leadTimeDays === "" ? undefined : Number(l.leadTimeDays),
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Vendor</Label>
              <Select
                value={vendorId}
                items={vendors.map((v) => ({ value: v.id, label: v.name }))}
                onValueChange={(v) => chooseVendor((v as string) ?? "")}
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
          </div>

          <div className="space-y-2">
            <Label>Needs waiting to be ordered</Label>
            {available.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                {orderableIntents.length === 0
                  ? requiresApproval
                    ? "Nothing has been verified yet. A need has to be verified before it can go on an order."
                    : "Nobody has stated a need yet."
                  : "Every waiting need is either already on this order, or was raised for a different vendor or site."}
              </p>
            ) : (
              <div className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {offers.map((offer) =>
                  offer.kind === "need" ? (
                    <NeedRow key={offer.need.id} need={offer.need} onAdd={() => addIntents([offer.need])} />
                  ) : (
                    <div key={offer.id}>
                      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setOpenList(openList === offer.id ? null : offer.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          {openList === offer.id ? (
                            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm">
                            <span className="font-medium">
                              {offer.needs.length} items · {offer.needs[0].requestedByName}
                              {offer.needs[0].departmentName ? ` (${offer.needs[0].departmentName})` : ""}
                            </span>{" "}
                            <span className="font-mono text-xs text-muted-foreground">{offer.listNumber}</span>
                            {offer.reason && (
                              <span className="text-muted-foreground"> · {offer.reason}</span>
                            )}
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => addIntents(offer.needs)}
                        >
                          <Plus className="size-4" />
                          Add all
                        </Button>
                      </div>
                      {openList === offer.id && (
                        <div className="divide-y divide-border border-t border-border bg-muted/30 pl-6">
                          {offer.needs.map((need) => (
                            <NeedRow key={need.id} need={need} onAdd={() => addIntents([need])} />
                          ))}
                        </div>
                      )}
                    </div>
                  )
                )}
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
                      {l.needLocationId && locationId && l.needLocationId !== locationId && (
                        <p className="flex items-center gap-1 text-xs text-destructive">
                          <AlertTriangle className="size-3 shrink-0" />
                          Raised for {l.needLocationName ?? "another site"}
                        </p>
                      )}
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
                    <div className="w-28 space-y-1">
                      <Label className="text-xs">Lead time (days)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={l.leadTimeDays}
                        placeholder="—"
                        onChange={(e) => updateLine(l.key, { leadTimeDays: e.target.value })}
                      />
                      <p className="text-micro text-muted-foreground">
                        {l.leadTimeDays !== "" && Number(l.leadTimeDays) >= 0
                          ? `Due ${new Date(openedAt + Number(l.leadTimeDays) * 86_400_000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
                          : "No due date"}
                      </p>
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

          {misplaced.length > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {misplaced.length === 1 ? "One line was" : `${misplaced.length} lines were`} raised for another
              site. An order delivers to one place, so remove{" "}
              {misplaced.length === 1 ? "it" : "them"} or change where this order delivers.
            </p>
          )}

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
            disabled={saving || lines.length === 0 || !vendorId || !locationId || misplaced.length > 0}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Place order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One need in the picker: what is wanted, who wants it, and a click to add it. */
function NeedRow({ need, onAdd }: { need: Orderable; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
    >
      <span className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">
          {need.quantity} {need.unit} · {need.productName}
        </span>{" "}
        <span className="text-muted-foreground">
          {need.intentNumber} · {need.requestedByName}
          {need.departmentName ? ` (${need.departmentName})` : ""}
        </span>
      </span>
      {need.vendorName && (
        <Badge variant="outline" className="shrink-0">
          {need.vendorName}
        </Badge>
      )}
      <Plus className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
