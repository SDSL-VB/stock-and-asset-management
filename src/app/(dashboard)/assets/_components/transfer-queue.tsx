"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { approveTransferRequest, rejectTransferRequest } from "@/lib/actions/assets";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";

/**
 * The transfer queue on the Assets page.
 *
 * A transfer is how central stock becomes a department's holding, which is why
 * it lives here rather than on a page of its own. Approving one IS the
 * movement — there is no second step.
 *
 * Review buttons appear only on requests this person may actually act on:
 * their own department's, and never one they raised themselves.
 */

export type TransferRequest = {
  id: string;
  requestNumber: string;
  quantity: number;
  notes: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  createdAt: Date;
  stockEntry: {
    id: string;
    entryNumber: string;
    itemCode: string | null;
    itemName: string;
    quantity: number;
    issues: Array<{ quantity: number }>;
  };
  department: { id: string; name: string };
  requestedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
};

interface Props {
  requests: TransferRequest[];
  canApprove: boolean;
  /** Full stock scope reviews transfers into any department */
  seesEverySite: boolean;
  viewerDepartmentId: string | null;
  viewerId: string;
}

function StatusBadge({ status }: { status: TransferRequest["status"] }) {
  const classes = {
    PENDING: "bg-amber-50 text-amber-700 border-amber-200",
    APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    REJECTED: "bg-red-50 text-red-700 border-red-200",
  };
  const labels = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };
  return (
    <Badge variant="outline" className={classes[status]}>
      {labels[status]}
    </Badge>
  );
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function TransferQueue({
  requests,
  canApprove,
  seesEverySite,
  viewerDepartmentId,
  viewerId,
}: Props) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>To department</TableHead>
                <TableHead>Asked by</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[170px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No transfer requests yet. Use &ldquo;Request transfer&rdquo; above to ask for
                    central stock to be moved into a department.
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((request) => {
                  // Absent, not disabled: another department's request is not
                  // this person's to answer, and neither is their own.
                  const isMine = request.requestedBy.id === viewerId;
                  const canReview =
                    request.status === "PENDING" &&
                    canApprove &&
                    !isMine &&
                    (seesEverySite || request.department.id === viewerDepartmentId);

                  return (
                    <TableRow key={request.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {request.requestNumber}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/stock/${request.stockEntry.id}`}
                          className="hover:underline"
                        >
                          <p className="font-medium">{request.stockEntry.itemName}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {request.stockEntry.itemCode ?? request.stockEntry.entryNumber}
                          </p>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {request.quantity}
                      </TableCell>
                      <TableCell>{request.department.name}</TableCell>
                      <TableCell>
                        {request.requestedBy.name}
                        {isMine && (
                          <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{formatDate(request.createdAt)}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <StatusBadge status={request.status} />
                          {request.status === "REJECTED" && request.reviewNote && (
                            <p className="text-xs text-red-600">{request.reviewNote}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {canReview && <ReviewActions request={request} />}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewActions({ request }: { request: TransferRequest }) {
  const router = useRouter();
  const [approving, setApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const issued = request.stockEntry.issues.reduce((sum, i) => sum + i.quantity, 0);
  const remaining = request.stockEntry.quantity - issued;
  const tooLittleLeft = remaining < request.quantity;

  async function handleApprove() {
    setApproving(true);
    try {
      const result = await approveTransferRequest(request.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Approved — stock moved to ${request.department.name}`);
      router.refresh();
    } finally {
      setApproving(false);
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    setRejecting(true);
    try {
      const result = await rejectTransferRequest(request.id, { reviewNote: reason.trim() });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Request declined");
      setRejectOpen(false);
      router.refresh();
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        disabled={approving || tooLittleLeft}
        onClick={handleApprove}
        className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
        title={
          tooLittleLeft
            ? `Only ${remaining} units remain in stock`
            : "Approve and move the stock"
        }
      >
        {approving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Check className="mr-1 h-4 w-4" />
            Approve
          </>
        )}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)}>
        <X className="mr-1 h-4 w-4" />
        Decline
      </Button>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline transfer {request.requestNumber}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleReject} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`decline-${request.id}`}>Reason *</Label>
              <Textarea
                id={`decline-${request.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this transfer being declined?"
                rows={3}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={rejecting || !reason.trim()}>
                {rejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Decline request
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
