"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Send, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "./file-upload";
import { DocumentViewerButton } from "./document-viewer";
import {
  approveDelivery,
  removeDeliveryAttachment,
  sendBackDelivery,
  submitDelivery,
  type getDelivery,
} from "@/lib/actions/deliveries";
import { statusPill } from "@/lib/design/status";
import { formatDateTime, formatMoney } from "@/lib/format";

/**
 * A delivery's page body: its lines, its documents, and the actions that apply
 * to every line at once.
 *
 *   Attach documents   while any line is a draft; one upload lands on every line
 *   Submit             the author's draft (and sent-back) lines, each checked
 *                      as a single entry
 *   Approve / Send back  every line waiting for approval, for stock.approve holders
 *
 * Each line links to its own stock entry page, where it can still be edited
 * alone while a draft, or approved on its own.
 */

type Delivery = NonNullable<Awaited<ReturnType<typeof getDelivery>>>;

const STATUS_WORD: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Waiting for approval",
  APPROVED: "Approved",
  REJECTED: "Sent back",
};

export function DeliveryView({
  delivery,
  attachmentTypes,
  viewerId,
  canCreate,
  canApprove,
  canSeeValue,
}: {
  delivery: Delivery;
  attachmentTypes: { id: string; name: string; isRequired: boolean; allowedMimeTypes: unknown; maxSizeBytes: number }[];
  viewerId: string;
  canCreate: boolean;
  canApprove: boolean;
  canSeeValue: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sendingBack, setSendingBack] = useState(false);
  const [reason, setReason] = useState("");

  const { entries } = delivery;
  const editable = entries.filter((e) => e.status === "DRAFT" || e.status === "REJECTED");
  // Drafts, and lines sent back, that this person booked in
  const myDrafts = entries.filter(
    (e) => (e.status === "DRAFT" || e.status === "REJECTED") && e.createdBy.id === viewerId
  );
  const waiting = entries.filter((e) => e.status === "SUBMITTED");
  const total = entries.reduce((sum, e) => sum + e.totalPrice, 0);

  function run(action: () => Promise<{ error?: string; failed?: string[] } & Record<string, unknown>>, done: string) {
    startTransition(async () => {
      const res = await action();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (res.failed && res.failed.length > 0) {
        toast.warning(`${done}, except: ${res.failed.join("; ")}`);
      } else {
        toast.success(done);
      }
      setSendingBack(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {entries.length} item{entries.length === 1 ? "" : "s"}
            </CardTitle>
            <p className="mt-1 text-caption text-muted-foreground">
              Booked in by {entries[0].createdBy.name} on {formatDateTime(delivery.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCreate && myDrafts.length > 0 && (
              <Button onClick={() => run(() => submitDelivery(delivery.id), "Submitted for approval")} disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Submit {myDrafts.length === entries.length ? "the delivery" : `${myDrafts.length} draft${myDrafts.length === 1 ? "" : "s"}`} for approval
              </Button>
            )}
            {canApprove && waiting.length > 0 && (
              <>
                <Button onClick={() => run(() => approveDelivery(delivery.id), "Approved")} disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve {waiting.length === entries.length ? "all" : waiting.length} item{waiting.length === 1 ? "" : "s"}
                </Button>
                <Button variant="outline" onClick={() => setSendingBack(true)} disabled={pending}>
                  <Undo2 className="h-4 w-4" />
                  Send back
                </Button>
              </>
            )}
          </div>
        </CardHeader>

        {sendingBack && (
          <CardContent className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">What needs fixing? It goes back to the author with every waiting line.</p>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={pending || !reason.trim()}
                onClick={() => run(() => sendBackDelivery(delivery.id, reason), "Sent back")}
              >
                Send back {waiting.length} item{waiting.length === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSendingBack(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        )}

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/40 text-left text-caption text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 text-right font-medium">Quantity</th>
                  {canSeeValue && <th className="px-4 py-2 text-right font-medium">Unit price</th>}
                  {canSeeValue && <th className="px-4 py-2 text-right font-medium">Total</th>}
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t align-top">
                    <td className="px-4 py-2">
                      <Link href={`/stock/${e.id}`} className="font-mono text-xs text-primary hover:underline">
                        {e.entryNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs text-muted-foreground">{e.itemCode}</span> {e.itemName}
                      <span className="block text-micro text-muted-foreground">
                        {e.product?.category.name}
                        {e.purchaseOrderLine ? ` · against ${e.purchaseOrderLine.purchaseOrder.poNumber}` : ""}
                        {e.batchNumber ? ` · batch ${e.batchNumber}` : ""}
                        {e.rackLocation ? ` · rack ${e.rackLocation}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {e.quantity} {e.product?.unit}
                    </td>
                    {canSeeValue && <td className="px-4 py-2 text-right tabular-nums">{formatMoney(e.unitPrice)}</td>}
                    {canSeeValue && <td className="px-4 py-2 text-right tabular-nums">{formatMoney(e.totalPrice)}</td>}
                    <td className="px-4 py-2">
                      <Badge variant="outline" className={statusPill(e.status)}>
                        {STATUS_WORD[e.status] ?? e.status}
                      </Badge>
                      {e.status === "REJECTED" && e.rejectionReason && (
                        <span className="mt-0.5 block text-micro text-status-rejected">{e.rejectionReason}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {canSeeValue && (
                <tfoot>
                  <tr className="border-t font-semibold">
                    <td className="px-4 py-2" colSpan={4}>
                      Total
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatMoney(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
          <p className="text-caption text-muted-foreground">
            Attached once, kept on every item — each entry carries the invoice just as a single entry would.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {delivery.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {delivery.files.map((f) => (
                <li key={f.fileUrl} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {f.fileName}
                    <span className="ml-2 text-xs text-muted-foreground">{f.attachmentType}</span>
                  </span>
                  <DocumentViewerButton attachment={f} />
                  {canCreate && editable.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${f.fileName}`}
                      disabled={pending}
                      onClick={() => run(() => removeDeliveryAttachment(delivery.id, f.fileUrl), `Removed ${f.fileName}`)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canCreate && editable.length > 0 && (
            <FileUpload stockEntryId={editable[0].id} deliveryId={delivery.id} attachmentTypes={attachmentTypes} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
