"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { ProductCombobox, type ProductOption } from "@/components/shared/product-combobox";
import { requestNeeds } from "@/lib/actions/needs";

/**
 * "What do you need?" — the one way a need reaches Procurement.
 *
 * Called by: Procurement ("State a need"), a short build ("Request what's
 * short") and the low-stock card ("Raise needs").
 *
 * Opened two ways:
 *
 *   by hand     the "State a need" button on Procurement. Starts with one empty
 *               line; add more if several things are needed at once.
 *   pre-filled  from a build that is short ("Request what's short") or from the
 *               low-stock alert ("Raise needs"). Every line arrives filled in —
 *               the item, how many, the preferred vendor — and the person picks
 *               the date it is needed by, changes anything they disagree with,
 *               and sends it.
 *
 * Each line carries its own vendor, because each item may come from a different
 * one; the list shows that vendor's lead time so the "needed by" date can be
 * realistic. One line typed by hand becomes one need. Anything else becomes a
 * need request, so the buyer can open and download it together — see needs.ts.
 *
 * A date sooner than the vendor can deliver is caught before sending: the
 * person is shown which items cannot arrive in time and asked to recheck the
 * date, or to go ahead with "Order anyway with the mentioned details" — it may
 * be a rush the buyer can negotiate. With no vendor picked, the quickest known
 * supplier is used for the check.
 *
 * Deliberately short: the person raising a need knows what and how many, and
 * may know who from. Prices and terms belong on the order, not here.
 */

export type NeedProduct = ProductOption & {
  unit: string;
  /** Who supplies it and in how many days — from the product–vendor records */
  suppliers: { vendorId: string; leadTimeDays: number; isPreferred: boolean }[];
};

export type NeedPrefill = {
  /** Shown under the title: why this dialog opened already filled in */
  reason: string;
  locationId?: string;
  lines: { productId: string; quantity: number; note?: string }[];
  source: { kind: "BUILD_SHORTAGE" | "LOW_STOCK"; productId?: string; quantity?: number };
};

type Line = { key: number; productId: string; quantity: string; vendorId: string; note?: string };

let nextKey = 1;

const DAY_MS = 86_400_000;

/** Whole days from today to a "YYYY-MM-DD" date, both at local midnight. */
function daysUntil(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / DAY_MS);
}

/** The lead time a line is checked against: its vendor's, else the quickest known. */
function leadTimeOf(product: NeedProduct | undefined, vendorId: string) {
  if (!product || product.suppliers.length === 0) return null;
  const chosen = product.suppliers.find((s) => s.vendorId === vendorId);
  if (chosen) return { days: chosen.leadTimeDays, vendorChosen: true };
  if (vendorId) return null; // a vendor with no recorded lead time for this item
  return { days: Math.min(...product.suppliers.map((s) => s.leadTimeDays)), vendorChosen: false };
}

/** The vendor a line starts with: the preferred one, else the quickest. */
function defaultVendor(product: NeedProduct | undefined): string {
  if (!product || product.suppliers.length === 0) return "";
  const preferred = product.suppliers.find((s) => s.isPreferred);
  return (preferred ?? [...product.suppliers].sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0]).vendorId;
}

export function NeedDialog({
  products,
  vendors,
  locations,
  prefill,
  open: controlledOpen,
  onOpenChange,
  onRequested,
}: {
  products: NeedProduct[];
  vendors: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  /** When given, the dialog has no button of its own and opens filled in */
  prefill?: NeedPrefill;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called once the needs are raised — e.g. so a build can show "Requested" */
  onRequested?: () => void;
}) {
  const router = useRouter();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const [saving, startSaving] = useTransition();

  const byId = new Map(products.map((p) => [p.id, p]));

  const initialLines = (): Line[] =>
    prefill
      ? prefill.lines.map((l) => ({
          key: nextKey++,
          productId: l.productId,
          quantity: String(Math.max(1, Math.ceil(l.quantity))),
          vendorId: defaultVendor(byId.get(l.productId)),
          note: l.note,
        }))
      : [{ key: nextKey++, productId: "", quantity: "1", vendorId: "" }];

  const [lines, setLines] = useState<Line[]>(initialLines);
  const [locationId, setLocationId] = useState(prefill?.locationId ?? "");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Lines whose vendor cannot deliver by the date asked for
  const daysLeft = neededBy ? daysUntil(neededBy) : null;
  const tooSoon =
    daysLeft === null
      ? []
      : lines.flatMap((l) => {
          const product = byId.get(l.productId);
          const lead = leadTimeOf(product, l.vendorId);
          if (!product || !lead || lead.days <= daysLeft) return [];
          const vendor = vendors.find((v) => v.id === l.vendorId)?.name;
          return [{ key: l.key, name: product.name, lead: lead.days, vendor: lead.vendorChosen ? vendor : "the quickest supplier" }];
        });
  const tooSoonKeys = new Set(tooSoon.map((t) => t.key));
  // Shown only while it is still true — fixing the date or vendor clears it
  const asking = confirming && tooSoon.length > 0;

  function reset() {
    setLines(initialLines());
    setLocationId(prefill?.locationId ?? "");
    setNeededBy("");
    setNotes("");
    setConfirming(false);
  }

  function update(key: number, patch: Partial<Line>) {
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  const ready = lines.length > 0 && lines.every((l) => l.productId && Number(l.quantity) >= 1);

  /** Ask first when the date is sooner than delivery takes; otherwise send. */
  function submit() {
    if (tooSoon.length > 0 && !asking) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    startSaving(async () => {
      const result = await requestNeeds({
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          vendorId: l.vendorId || undefined,
          note: l.note,
        })),
        locationId: locationId || undefined,
        neededBy: neededBy || undefined,
        notes,
        source: prefill?.source,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.listNumber
          ? `${result.listNumber}: ${result.count} needs raised`
          : "Need raised"
      );
      setOpen(false);
      reset();
      onRequested?.();
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
      {!prefill && (
        <DialogTrigger render={<Button variant="outline" />}>
          <Plus className="size-4" />
          State a need
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>What do you need?</DialogTitle>
          <DialogDescription>
            {prefill
              ? `${prefill.reason}. Check the lines, pick a vendor for each and the date you need them by.`
              : "This goes to whoever buys. You do not have to know the price or the terms."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            {lines.map((line) => {
              const product = byId.get(line.productId);
              const supplier = product?.suppliers.find((s) => s.vendorId === line.vendorId);
              return (
                <div key={line.key} className="grid gap-2 rounded-md border p-2.5 sm:grid-cols-[1fr_90px_180px_32px] sm:items-start">
                  <div className="min-w-0 space-y-1">
                    <ProductCombobox
                      products={products}
                      value={line.productId}
                      onChange={(id) => update(line.key, { productId: id, vendorId: defaultVendor(byId.get(id)) })}
                    />
                    {line.note && <p className="text-micro text-muted-foreground">{line.note}</p>}
                  </div>
                  <div className="space-y-1">
                    <Input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => update(line.key, { quantity: e.target.value })}
                      aria-label="How many"
                    />
                    {product && <p className="text-micro text-muted-foreground">{product.unit}</p>}
                  </div>
                  <div className="space-y-1">
                    <Select
                      value={line.vendorId}
                      items={[{ value: "", label: "No preference" }, ...vendors.map((v) => ({ value: v.id, label: v.name }))]}
                      onValueChange={(v) => update(line.key, { vendorId: (v as string) ?? "" })}
                    >
                      <SelectTrigger aria-label="Vendor">
                        <SelectValue placeholder="No preference" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">No preference</SelectItem>
                        {vendors.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {supplier && (
                      <p className={tooSoonKeys.has(line.key) ? "text-micro text-destructive" : "text-micro text-muted-foreground"}>
                        takes {supplier.leadTimeDays} day{supplier.leadTimeDays === 1 ? "" : "s"}
                        {tooSoonKeys.has(line.key) && " — later than needed"}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remove this line"
                    disabled={lines.length === 1}
                    onClick={() => setLines((all) => all.filter((l) => l.key !== line.key))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLines((all) => [...all, { key: nextKey++, productId: "", quantity: "1", vendorId: "" }])}
            >
              <Plus className="size-4" />
              Add another item
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="intent-needed">Needed by</Label>
              <Input
                id="intent-needed"
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
              />
              {daysLeft !== null && daysLeft < 0 && (
                <p className="text-micro text-destructive">That date has passed</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Deliver to</Label>
              <Select
                value={locationId}
                items={locations.map((l) => ({ value: l.id, label: l.name }))}
                onValueChange={(v) => setLocationId((v as string) ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Your own site" />
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
            <Label htmlFor="intent-notes">Why (optional)</Label>
            <Textarea
              id="intent-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What it is for, or anything that helps them buy the right thing"
              rows={2}
            />
          </div>
        </div>

        {asking && (
          <div role="alertdialog" aria-labelledby="need-too-soon" className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p id="need-too-soon" className="flex items-start gap-2 text-sm font-medium">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              {daysLeft !== null && daysLeft <= 0
                ? "You need this today or earlier, but delivery takes longer."
                : `You need this in ${daysLeft} day${daysLeft === 1 ? "" : "s"}, but delivery takes longer. Recheck the date?`}
            </p>
            <ul className="space-y-0.5 pl-6 text-sm text-muted-foreground">
              {tooSoon.map((t) => (
                <li key={t.key}>
                  {t.name} — {t.vendor ?? "its vendor"} takes {t.lead} day{t.lead === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  document.getElementById("intent-needed")?.focus();
                }}
              >
                Recheck the date
              </Button>
              <Button size="sm" variant="destructive" onClick={submit} disabled={saving}>
                Order anyway with the mentioned details
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !ready || asking}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {lines.length > 1 ? `Raise ${lines.length} needs` : "Raise it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
