"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ProductCombobox, type ProductOption } from "@/components/shared/product-combobox";
import {
  approveMaterialRequest,
  cancelMaterialRequest,
  createMaterialRequest,
  raiseShortfallNeeds,
  rejectMaterialRequest,
  supplyMaterialRequest,
} from "@/lib/actions/materials";

/**
 * The material requests someone may see, each with only the buttons the server
 * said they may use (canApprove, canSupply...), and a form to raise a new one.
 */

type Request = {
  id: string;
  requestNumber: string;
  status: string;
  notes: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  departmentName: string;
  locationName: string;
  forProductName: string | null;
  forQuantity: number | null;
  requestedByName: string;
  departmentApproverName: string | null;
  supplierName: string | null;
  lines: { id: string; code: string; name: string; unit: string; quantity: number; supplied: number }[];
  canApprove: boolean;
  canSupply: boolean;
  canCancel: boolean;
  canRaiseShortfall: boolean;
  shortfallRaised: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING_DEPARTMENT: "Waiting for the department",
  PENDING_STOCK: "Waiting for the Stock Manager",
  SUPPLIED: "Supplied",
  PARTLY_SUPPLIED: "Partly supplied",
  REJECTED: "Turned down",
  CANCELLED: "Withdrawn",
};

function formatQty(n: number) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

export function MaterialRequestList({
  requests,
  products,
  canRequest,
}: {
  requests: Request[];
  products: ProductOption[];
  canRequest: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [lines, setLines] = useState<{ productId: string; quantity: string }[]>([{ productId: "", quantity: "" }]);
  const [notes, setNotes] = useState("");
  const [rejecting, setRejecting] = useState<Request | null>(null);
  const [reason, setReason] = useState("");

  function run(action: () => Promise<{ error?: string } | { success: boolean }>, done: string) {
    startTransition(async () => {
      const res = await action();
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(done);
      router.refresh();
    });
  }

  function submitNew() {
    const filled = lines.filter((l) => l.productId && Number(l.quantity) > 0);
    startTransition(async () => {
      const res = await createMaterialRequest({
        lines: filled.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
        notes: notes.trim() || undefined,
      });
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${"requestNumber" in res ? res.requestNumber : "Request"} raised`);
      setCreating(false);
      setLines([{ productId: "", quantity: "" }]);
      setNotes("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canRequest && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New request
          </Button>
        </div>
      )}

      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-10">
            <EmptyState emoji="📦" title="No material requests" description="Requests your department raises, or that wait on you, appear here." />
          </CardContent>
        </Card>
      ) : (
        requests.map((r) => (
          <Card key={r.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold">{r.requestNumber}</p>
                  <p className="text-caption text-muted-foreground">
                    {r.departmentName} · {r.locationName} · raised by {r.requestedByName}
                    {r.forProductName ? ` · for ${r.forQuantity ?? ""} × ${r.forProductName}` : ""}
                  </p>
                </div>
                <Badge variant="outline">{STATUS_LABEL[r.status] ?? r.status}</Badge>
              </div>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-caption text-muted-foreground">
                    <th className="py-1.5">Item</th>
                    <th className="py-1.5 text-right">Asked</th>
                    <th className="py-1.5 text-right">Supplied</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-1.5">
                        <span className="font-mono text-caption text-muted-foreground">{l.code}</span> {l.name}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatQty(l.quantity)} {l.unit}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatQty(l.supplied)} {l.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {(r.notes || r.rejectionReason || r.departmentApproverName || r.supplierName) && (
                <p className="text-caption text-muted-foreground">
                  {r.notes && <>Note: {r.notes}. </>}
                  {r.departmentApproverName && <>Approved by {r.departmentApproverName}. </>}
                  {r.supplierName && <>Supplied by {r.supplierName}. </>}
                  {r.rejectionReason && <>Turned down: {r.rejectionReason}</>}
                  {r.shortfallRaised && <>The shortfall was raised as needs.</>}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {r.canApprove && (
                  <Button size="sm" disabled={pending} onClick={() => run(() => approveMaterialRequest(r.id), "Approved")}>
                    Approve
                  </Button>
                )}
                {r.canSupply && (
                  <Button size="sm" disabled={pending} onClick={() => run(() => supplyMaterialRequest(r.id), "Supplied from central stock")}>
                    Supply from central stock
                  </Button>
                )}
                {(r.canApprove || r.canSupply) && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => setRejecting(r)}>
                    Turn down
                  </Button>
                )}
                {r.canRaiseShortfall && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => raiseShortfallNeeds(r.id), "Raised as needs for the Buyer")}>
                    Raise what is missing as needs
                  </Button>
                )}
                {r.canCancel && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelMaterialRequest(r.id), "Withdrawn")}>
                    Withdraw
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Request materials from central stock</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_40px] sm:items-end">
                <ProductCombobox
                  products={products}
                  value={line.productId}
                  onChange={(id) => setLines((all) => all.map((l, i) => (i === index ? { ...l, productId: id } : l)))}
                />
                <Input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="How many"
                  value={line.quantity}
                  onChange={(e) => setLines((all) => all.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))}
                />
                {lines.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setLines((all) => all.filter((_, i) => i !== index))} aria-label="Remove line">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setLines((all) => [...all, { productId: "", quantity: "" }])}>
              <Plus className="mr-1.5 h-4 w-4" />
              Another item
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="mr-notes">Note (optional)</Label>
              <Input id="mr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="What it is for" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submitNew} disabled={pending || !lines.some((l) => l.productId && Number(l.quantity) > 0)}>
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Turn down {rejecting?.requestNumber}</DialogTitle>
          </DialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Why" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || !reason.trim()}
              onClick={() => {
                const target = rejecting;
                if (!target) return;
                setRejecting(null);
                run(() => rejectMaterialRequest(target.id, reason), "Turned down");
                setReason("");
              }}
            >
              Turn down
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
