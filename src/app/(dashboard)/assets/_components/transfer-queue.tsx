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
import { agreeTransferRequest, approveTransferRequest, rejectTransferRequest } from "@/lib/actions/assets";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { statusPill } from "@/lib/design/status";

/**
 * The transfer queue on the Assets page.
 *
 * A transfer is how central stock becomes a department's holding, which is why
 * it lives here rather than on a page of its own. Two steps: the receiving
 * department agrees (canAgree), then the Stock Manager approves, which IS the
 * movement (canDecide).
 *
 * Buttons appear only on requests this person may actually act on — the
 * server works that out with the actions' own rules. Someone who may approve
 * what they ask for never sees it here as pending: asking approves it.
 */

type TransferRequest = {
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
  /** Still waiting for the receiving department to agree */
  waitingOnDepartment: boolean;
  /** Whether this viewer may agree it for the department (step 1) */
  canAgree: boolean;
  /** Whether this viewer may approve it and move the stock (step 2) */
  canDecide: boolean;
  reviewedBy: { id: string; name: string } | null;
};

interface Props {
  requests: TransferRequest[];
  viewerId: string;
}

function StatusBadge({ request }: { request: TransferRequest }) {
  const labels = { PENDING: "With Stock Manager", APPROVED: "Approved", REJECTED: "Rejected" };
  return (
    <Badge variant="outline" className={statusPill(request.status)}>
      {request.waitingOnDepartment ? "With department" : labels[request.status]}
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
                  // Absent, not disabled: decided by the server with the approve
                  // action's own rule (scope, site, department)
                  const canReview = request.canDecide || request.canAgree;
                  const isMine = request.requestedBy.id === viewerId;

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
                          <StatusBadge request={request} />
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
      if (request.canAgree) {
        const result = await agreeTransferRequest(request.id);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success(result.moved ? `Approved — stock moved to ${request.department.name}` : "Agreed — sent to the Stock Manager");
      } else {
        const result = await approveTransferRequest(request.id);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success(`Approved — stock moved to ${request.department.name}`);
      }
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
            : request.canAgree
              ? "Agree for the department; the Stock Manager then moves it"
              : "Approve and move the stock"
        }
      >
        {approving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Check className="mr-1 h-4 w-4" />
            {request.canAgree ? "Agree" : "Approve"}
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
