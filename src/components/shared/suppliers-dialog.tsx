"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Star, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductCombobox, type ProductOption } from "@/components/shared/product-combobox";
import { getSupplierOptions, getSuppliers, removeSupplier, saveSupplier } from "@/lib/actions/suppliers";

/**
 * Who supplies what, and in how many days — from either side.
 *
 * Called by: the Vendors page (one vendor → the products it supplies) and the
 * Catalog (one product → the vendors that supply it). Both open this same
 * dialog over the same ProductVendor rows, so a lead time set from one side is
 * the lead time seen from the other.
 *
 * Each row is one product FROM one vendor, with its own lead time: a vendor
 * supplying five products has five, each set separately. The starred row is the
 * product's preferred vendor — the one the low-stock alert orders from and the
 * needs dialog picks first. Pressing another row's star moves it there;
 * pressing the lit star clears it; "Prefer the quickest" moves it to the
 * shortest lead time in one go.
 *
 * The trigger says "Lead times" in words rather than being a bare icon, because
 * this is where lead times are entered and nobody finds a lone truck.
 *
 * Rows load when the dialog opens rather than with the page, so the Vendors and
 * Catalog pages carry no extra weight for something opened occasionally.
 */

type Pair = Awaited<ReturnType<typeof getSuppliers>>[number];

export function SuppliersDialog({
  side,
  canEdit,
}: {
  /** Which record the dialog is about — the other side is what gets listed */
  side: { kind: "vendor"; id: string; name: string } | { kind: "product"; id: string; name: string };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Pair[] | null>(null);
  const [options, setOptions] = useState<{ products: ProductOption[]; vendors: { id: string; name: string }[] } | null>(null);
  const [pending, startTransition] = useTransition();

  // The add-a-row form
  const [otherId, setOtherId] = useState("");
  const [days, setDays] = useState("");
  const [preferred, setPreferred] = useState(true);

  const byVendor = side.kind === "vendor";
  const filter = byVendor ? { vendorId: side.id } : { productId: side.id };

  async function load() {
    setRows(await getSuppliers(filter));
    if (canEdit && !options) setOptions(await getSupplierOptions());
  }

  function save(pair: { productId: string; vendorId: string; leadTimeDays: number; isPreferred: boolean }) {
    startTransition(async () => {
      const res = await saveSupplier(pair);
      if ("error" in res) return void toast.error(res.error);
      setOtherId("");
      setDays("");
      await load();
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await removeSupplier(id);
      if ("error" in res) return void toast.error(res.error);
      await load();
      router.refresh();
    });
  }

  const listed = new Set(rows?.map((r) => (byVendor ? r.product.id : r.vendor.id)) ?? []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Fetched fresh each time it opens, so it never shows a stale lead time
        if (next) void load();
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" title={byVendor ? "What they supply" : "Who supplies it"} />}>
        <Truck className="h-4 w-4" />
        <span className="text-xs">Lead times</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{byVendor ? `What ${side.name} supplies` : `Who supplies ${side.name}`}</DialogTitle>
        </DialogHeader>

        <p className="text-caption text-muted-foreground">
          Each line is one product from one vendor, with its own lead time — the
          days from ordering to delivery. The starred vendor is the preferred
          one: the low-stock alert orders from it and new needs pick it first.
          Press a star to move it; press the lit star to clear it.
        </p>

        {!byVendor && canEdit && rows && rows.length > 1 && (() => {
          const quickest = [...rows].sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0];
          return quickest.isPreferred ? null : (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={pending}
              onClick={() => save({ productId: quickest.product.id, vendorId: quickest.vendor.id, leadTimeDays: quickest.leadTimeDays, isPreferred: true })}
            >
              <Star className="h-4 w-4" />
              Prefer the quickest ({quickest.vendor.name}, {quickest.leadTimeDays} days)
            </Button>
          );
        })()}

        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {byVendor ? "No products recorded for this vendor yet." : "No suppliers recorded for this product yet."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 p-2.5">
                <span className="min-w-0 flex-1 text-sm">
                  {byVendor ? (
                    <>
                      <span className="font-mono text-xs text-muted-foreground">{r.product.code}</span> {r.product.name}
                    </>
                  ) : (
                    <>
                      {r.vendor.name}
                      {!r.vendor.isActive && <span className="ml-1 text-micro text-muted-foreground">(inactive)</span>}
                    </>
                  )}
                </span>
                {canEdit ? (
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={r.leadTimeDays}
                    aria-label="Lead time in days"
                    className="h-8 w-20 tabular-nums"
                    onBlur={(e) => {
                      const next = Number(e.target.value);
                      if (e.target.value !== "" && next !== r.leadTimeDays) {
                        save({ productId: r.product.id, vendorId: r.vendor.id, leadTimeDays: next, isPreferred: r.isPreferred });
                      }
                    }}
                  />
                ) : (
                  <span className="text-sm tabular-nums">{r.leadTimeDays}</span>
                )}
                <span className="text-micro text-muted-foreground">days</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!canEdit || pending}
                  aria-label={r.isPreferred ? "Clear preferred vendor" : "Make preferred"}
                  aria-pressed={r.isPreferred}
                  title={r.isPreferred ? "Preferred vendor — press to clear" : "Make this the preferred vendor"}
                  onClick={() => save({ productId: r.product.id, vendorId: r.vendor.id, leadTimeDays: r.leadTimeDays, isPreferred: !r.isPreferred })}
                >
                  <Star className={"h-4 w-4 " + (r.isPreferred ? "fill-current text-status-pending" : "text-muted-foreground")} />
                </Button>
                {canEdit && (
                  <Button variant="ghost" size="sm" aria-label="Remove" disabled={pending} onClick={() => remove(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && options && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">{byVendor ? "Add a product they supply" : "Add a supplier"}</p>
            {byVendor ? (
              <ProductCombobox
                products={options.products.filter((p) => !listed.has(p.id))}
                value={otherId}
                onChange={setOtherId}
              />
            ) : (
              <Select
                value={otherId}
                items={options.vendors.filter((v) => !listed.has(v.id)).map((v) => ({ value: v.id, label: v.name }))}
                onValueChange={(v) => setOtherId((v as string) ?? "")}
              >
                <SelectTrigger><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
                <SelectContent>
                  {options.vendors.filter((v) => !listed.has(v.id)).map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sup-days">Lead time (days)</Label>
                <Input id="sup-days" type="number" min="0" step="1" value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <Checkbox checked={preferred} onCheckedChange={(v) => setPreferred(v === true)} />
                Preferred vendor
              </label>
              <Button
                className="ml-auto"
                disabled={pending || !otherId || days === ""}
                onClick={() =>
                  save({
                    productId: byVendor ? otherId : side.id,
                    vendorId: byVendor ? side.id : otherId,
                    leadTimeDays: Number(days),
                    isPreferred: preferred,
                  })
                }
              >
                Add
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
