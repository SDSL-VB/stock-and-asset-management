"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { ProductCombobox, type ProductOption } from "@/components/shared/product-combobox";
import {
  askCentralForPart,
  bookCallBackReturn,
  closeCallBack,
  raiseCallBack,
  recordServiceSwap,
  returnReworked,
  setEntryBatch,
} from "@/lib/actions/callbacks";

/**
 * Every call-back this person may see, traced: where the batch still sits,
 * every customer who has it, what came back and what was swapped. Buttons come
 * from the server (canClose, canBookReturn, canSwap) — never worked out here.
 */

type CallBack = {
  id: string;
  callBackNumber: string;
  batchNumber: string;
  productName: string | null;
  productCode: string | null;
  reason: string;
  status: string;
  notifyAllSites: boolean;
  createdAt: Date;
  departmentName: string;
  raisedByName: string;
  tracedBatches: string[];
  central: { entryNumber: string; itemName: string; batchNumber: string; locationName: string | null; available: number }[];
  customers: {
    clientId: string;
    clientName: string;
    city: string;
    address: string | null;
    gstNumber: string | null;
    batchNumber: string;
    itemName: string;
    quantity: number;
    via: string;
  }[];
  returns: { id: string; entryNumber: string; quantity: number; status: string; supplierName: string; canRelabel: boolean }[];
  inRework: {
    issueId: string;
    entryId: string;
    entryNumber: string;
    itemName: string;
    batchNumber: string | null;
    departmentName: string;
    free: number;
    canReturn: boolean;
    canRelabel: boolean;
  }[];
  swaps: { id: string; clientName: string; partName: string; quantity: number; customerBatch: string; replacementBatch: string | null }[];
  canClose: boolean;
  canBookReturn: boolean;
  canSwap: boolean;
};

type ServiceStock = { id: string; itemName: string; itemCode: string | null; available: number };

/** One row per customer, however many shipments reached them */
function uniqueCustomers(cb: CallBack) {
  return [...new Map(cb.customers.map((c) => [c.clientId, c])).values()];
}

export function CallBackList({
  callBacks,
  canRaise,
  serviceStock,
  products,
}: {
  callBacks: CallBack[];
  canRaise: boolean;
  serviceStock: ServiceStock[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Raising
  const [raising, setRaising] = useState(false);
  const [batch, setBatch] = useState("");
  const [reason, setReason] = useState("");
  const [allSites, setAllSites] = useState(false);

  // Booking a return / recording a swap / asking central, for one call-back
  const [returning, setReturning] = useState<CallBack | null>(null);
  const [swapping, setSwapping] = useState<CallBack | null>(null);
  const [asking, setAsking] = useState<CallBack | null>(null);
  const [clientId, setClientId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [customerBatch, setCustomerBatch] = useState("");
  const [fromEntry, setFromEntry] = useState("");
  const [dispatchNumber, setDispatchNumber] = useState("");
  const [partId, setPartId] = useState("");
  // Rework: sending back to central, or a new batch
  const [reworkReturn, setReworkReturn] = useState<{ issueId: string; label: string; free: number } | null>(null);
  const [relabel, setRelabel] = useState<{ entryId: string; label: string } | null>(null);
  const [newBatch, setNewBatch] = useState("");

  function reset() {
    setClientId("");
    setQuantity("1");
    setCustomerBatch("");
    setFromEntry("");
    setDispatchNumber("");
    setPartId("");
  }

  function run(action: () => Promise<{ error?: string } | { success: boolean }>, done: string, after?: () => void) {
    startTransition(async () => {
      const res = await action();
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(done);
      after?.();
      reset();
      router.refresh();
    });
  }

  function customerSelect(cb: CallBack) {
    const list = uniqueCustomers(cb);
    return (
      <div className="space-y-1.5">
        <Label>Customer</Label>
        <Select value={clientId} items={list.map((c) => ({ value: c.clientId, label: `${c.clientName} — ${c.city}` }))} onValueChange={(v) => setClientId((v as string) ?? "")}>
          <SelectTrigger>
            <SelectValue placeholder={list.length ? "Which customer" : "No customer has this batch"} />
          </SelectTrigger>
          <SelectContent>
            {list.map((c) => (
              <SelectItem key={c.clientId} value={c.clientId}>
                {c.clientName} — {c.city}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canRaise && (
        <div className="flex justify-end">
          <Button onClick={() => setRaising(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Call back a batch
          </Button>
        </div>
      )}

      {callBacks.length === 0 ? (
        <Card>
          <CardContent className="py-10">
            <EmptyState emoji="📣" title="No call-backs" description="Batches called back, and the customers who have them, appear here." />
          </CardContent>
        </Card>
      ) : (
        callBacks.map((cb) => (
          <Card key={cb.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold">
                    {cb.callBackNumber} · batch {cb.batchNumber}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {cb.productName ?? "—"} · raised by {cb.raisedByName} for {cb.departmentName} · {cb.reason}
                  </p>
                  {cb.tracedBatches.length > 1 && (
                    <p className="text-caption text-muted-foreground">
                      Followed through builds into: {cb.tracedBatches.filter((b) => b.toUpperCase() !== cb.batchNumber.toUpperCase()).join(", ")}
                    </p>
                  )}
                </div>
                <Badge variant="outline">{cb.status === "OPEN" ? "Open" : "Closed"}</Badge>
              </div>

              {cb.central.length > 0 && (
                <div className="text-sm">
                  <p className="font-medium">Still in central stock</p>
                  <ul className="text-caption text-muted-foreground">
                    {cb.central.map((h) => (
                      <li key={h.entryNumber}>
                        {h.available} × {h.itemName} ({h.batchNumber}) at {h.locationName ?? "—"} — {h.entryNumber}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="text-sm">
                <p className="font-medium">Customers who have it ({uniqueCustomers(cb).length})</p>
                {cb.customers.length === 0 ? (
                  <p className="text-caption text-muted-foreground">None — nothing from this batch has reached a customer.</p>
                ) : (
                  <ul className="space-y-1 text-caption">
                    {cb.customers.map((c, i) => (
                      <li key={`${c.clientId}-${c.via}-${i}`}>
                        <span className="font-medium">{c.clientName}</span>, {c.city} — {c.quantity} × {c.itemName} (batch {c.batchNumber}, {c.via})
                        {c.address && <span className="block text-muted-foreground">{c.address}{c.gstNumber ? ` · GST ${c.gstNumber}` : ""}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {cb.inRework.length > 0 && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">In a department for rework</p>
                  {cb.inRework.map((i) => (
                    <div key={i.issueId} className="flex flex-wrap items-center gap-2 text-caption">
                      <span>
                        {i.free} × {i.itemName} in {i.departmentName} — {i.entryNumber}, batch {i.batchNumber ?? "—"}
                      </span>
                      {i.canReturn && (
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => { setReworkReturn({ issueId: i.issueId, label: `${i.itemName} (${i.entryNumber})`, free: i.free }); setQuantity(String(i.free)); }}>
                          Back to central stock
                        </Button>
                      )}
                      {i.canRelabel && (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRelabel({ entryId: i.entryId, label: i.entryNumber })}>
                          New batch
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(cb.returns.length > 0 || cb.swaps.length > 0) && (
                <div className="text-caption text-muted-foreground">
                  {cb.returns.map((r) => (
                    <p key={r.id} className="flex flex-wrap items-center gap-2">
                      Returned: {r.quantity} on {r.entryNumber} ({r.supplierName}) — {r.status.toLowerCase()}
                      {r.canRelabel && (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRelabel({ entryId: r.id, label: r.entryNumber })}>
                          New batch
                        </Button>
                      )}
                    </p>
                  ))}
                  {cb.swaps.map((s) => (
                    <p key={s.id}>
                      Swapped at {s.clientName}: {s.quantity} × {s.partName} into {s.customerBatch}
                      {s.replacementBatch ? ` (batch ${s.replacementBatch})` : ""}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {cb.canBookReturn && (
                  <Button size="sm" disabled={pending} onClick={() => setReturning(cb)}>
                    Book in a return
                  </Button>
                )}
                {cb.canSwap && (
                  <>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setSwapping(cb)}>
                      Record a part swapped on site
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => setAsking(cb)}>
                      Ask central to send a part
                    </Button>
                  </>
                )}
                {cb.canClose && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => closeCallBack(cb.id), "Closed")}>
                    Close
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={reworkReturn !== null} onOpenChange={(o) => !o && setReworkReturn(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Back to central stock — {reworkReturn?.label}</DialogTitle>
          </DialogHeader>
          <Input type="number" min={1} max={reworkReturn?.free} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReworkReturn(null)} disabled={pending}>Cancel</Button>
            <Button
              disabled={pending || !(Number(quantity) > 0)}
              onClick={() => {
                const target = reworkReturn;
                if (!target) return;
                run(() => returnReworked(target.issueId, Number(quantity)), "Back in central stock", () => setReworkReturn(null));
              }}
            >
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={relabel !== null} onOpenChange={(o) => !o && setRelabel(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New batch for {relabel?.label}</DialogTitle>
          </DialogHeader>
          <Input value={newBatch} onChange={(e) => setNewBatch(e.target.value)} maxLength={60} placeholder="The batch after rework" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRelabel(null)} disabled={pending}>Cancel</Button>
            <Button
              disabled={pending || !newBatch.trim()}
              onClick={() => {
                const target = relabel;
                if (!target) return;
                run(() => setEntryBatch(target.entryId, newBatch), "Batch changed", () => { setRelabel(null); setNewBatch(""); });
              }}
            >
              Change batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={raising} onOpenChange={setRaising}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Call back a batch</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cb-batch">Batch number</Label>
              <Input id="cb-batch" value={batch} onChange={(e) => setBatch(e.target.value)} maxLength={60} />
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={allSites} onChange={(e) => setAllSites(e.target.checked)} />
              Tell Service at every site, not only the sites that sent it
            </label>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cb-reason">Why</Label>
              <Textarea id="cb-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} />
            </div>
          </div>
          <p className="text-caption text-muted-foreground">
            What is still in central stock at your site is asked back into your department; the Stock Manager approves it.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRaising(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || !batch.trim() || reason.trim().length < 3}
              onClick={() =>
                run(() => raiseCallBack({ batchNumber: batch, reason, notifyAllSites: allSites }), "Call-back raised", () => {
                  setRaising(false);
                  setBatch("");
                  setReason("");
                  setAllSites(false);
                })
              }
            >
              Call back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={returning !== null} onOpenChange={(o) => !o && setReturning(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Book in a return — {returning?.callBackNumber}</DialogTitle>
          </DialogHeader>
          {returning && (
            <div className="grid gap-4 sm:grid-cols-2">
              {customerSelect(returning)}
              <div className="space-y-1.5">
                <Label htmlFor="cb-qty">How many came back</Label>
                <Input id="cb-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || !(Number(quantity) > 0)}
              onClick={() => {
                const cb = returning;
                if (!cb) return;
                run(() => bookCallBackReturn(cb.id, { quantity: Number(quantity), clientId: clientId || undefined }), "Booked in — waiting for the Stock Manager", () => setReturning(null));
              }}
            >
              Book in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={swapping !== null} onOpenChange={(o) => !o && setSwapping(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record a part swapped at the customer</DialogTitle>
          </DialogHeader>
          {swapping && (
            <div className="grid gap-4 sm:grid-cols-2">
              {customerSelect(swapping)}
              <div className="space-y-1.5">
                <Label htmlFor="sw-batch">Batch of the customer&apos;s product it went into</Label>
                <Input id="sw-batch" value={customerBatch} onChange={(e) => setCustomerBatch(e.target.value)} maxLength={60} />
              </div>
              <div className="space-y-1.5">
                <Label>From service stock</Label>
                <Select value={fromEntry} items={serviceStock.map((s) => ({ value: s.id, label: `${s.itemName} — ${s.available} free` }))} onValueChange={(v) => setFromEntry((v as string) ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder={serviceStock.length ? "Pick the part" : "Nothing in service stock"} />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceStock.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.itemName} — {s.available} free
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fromEntry && (
                  <Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="How many" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sw-dsp">…or the consignment central stock sent it on</Label>
                <Input id="sw-dsp" value={dispatchNumber} onChange={(e) => setDispatchNumber(e.target.value)} placeholder="DSP-…" disabled={!!fromEntry} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSwapping(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || !clientId || !customerBatch.trim() || (!fromEntry && !dispatchNumber.trim())}
              onClick={() => {
                const cb = swapping;
                if (!cb) return;
                run(
                  () =>
                    recordServiceSwap({
                      callBackId: cb.id,
                      clientId,
                      customerBatch,
                      ...(fromEntry ? { stockEntryId: fromEntry, quantity: Number(quantity) } : { dispatchNumber: dispatchNumber.trim() }),
                    }),
                  "Swap recorded",
                  () => setSwapping(null)
                );
              }}
            >
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={asking !== null} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Ask central stock to send a part</DialogTitle>
          </DialogHeader>
          {asking && (
            <div className="grid gap-4 sm:grid-cols-2">
              {customerSelect(asking)}
              <div className="space-y-1.5">
                <Label htmlFor="ask-qty">How many</Label>
                <Input id="ask-qty" type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Part</Label>
                <ProductCombobox products={products} value={partId} onChange={setPartId} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsking(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || !clientId || !partId || !(Number(quantity) > 0)}
              onClick={() => {
                const cb = asking;
                if (!cb) return;
                run(() => askCentralForPart({ clientId, partProductId: partId, quantity: Number(quantity), callBackId: cb.id }), "Central stock has been asked", () => setAsking(null));
              }}
            >
              Ask
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
