"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import {
  approveStockEntry,
  rejectStockEntry,
  rebuildApprovalSteps,
} from "@/lib/actions/stock";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface Approval {
  id: string;
  stepOrder: number;
  stepLabel: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

interface Props {
  entryId: string;
  approvals: Approval[];
}

/**
 * Shown instead of the Approve card when an entry is waiting for approval but
 * has no steps to approve. Only people who could approve the entry see it,
 * because only they can act on it.
 */
function MissingSteps({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRebuild() {
    setLoading(true);
    try {
      const result = await rebuildApprovalSteps(entryId);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          result.steps === 1
            ? "Approval step restored — you can approve this entry now"
            : `${result.steps} approval steps restored`
        );
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          No approval steps recorded
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This entry is waiting for approval, but the steps it should be approved
          against were never recorded against it. Nobody can approve it as it
          stands — and changing the approval flow will not reach it, because the
          steps are copied onto an entry when it is submitted and never re-read.
        </p>
        <p className="text-sm text-muted-foreground">
          Restoring them copies the steps from the approval flow in force today.
        </p>
        <Button onClick={handleRebuild} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="mr-2 h-4 w-4" />
          )}
          Restore approval steps
        </Button>
      </CardContent>
    </Card>
  );
}

export function ApprovalActions({ entryId, approvals }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  // `router.refresh()` is not instant: the server re-renders the page and the
  // result is swapped in. Without a transition the button went back to looking
  // idle while the old status was still on screen, so people pressed it twice.
  // The transition stays pending until the new render has actually landed.
  const [refreshing, startRefresh] = useTransition();
  const loading = saving || refreshing;
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [comments, setComments] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  // Find the next pending step
  const pendingStep = approvals.find((a) => a.status === "PENDING");

  // An entry waiting for approval with NO steps recorded cannot move: there is
  // nothing to approve, and it can no longer be edited or resubmitted either.
  // Rebuilding the steps from the active flow is the way out. See
  // rebuildApprovalSteps in lib/actions/stock.ts for how it got into this state.
  if (approvals.length === 0) {
    return <MissingSteps entryId={entryId} />;
  }

  if (!pendingStep) return null;

  async function handleApprove() {
    if (!pendingStep) return;
    setSaving(true);
    try {
      const result = await approveStockEntry(
        entryId,
        pendingStep.stepOrder,
        comments || undefined
      );
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Entry approved successfully");
        startRefresh(() => router.refresh());
      }
    } finally {
      setSaving(false);
      setComments("");
    }
  }

  function openRejectDialog() {
    setRejectDialogOpen(true);
  }

  async function handleReject() {
    if (!pendingStep || !rejectionReason.trim()) {
      toast.error("Please provide a rejection reason");
      return;
    }
    setSaving(true);
    try {
      const result = await rejectStockEntry(
        entryId,
        pendingStep.stepOrder,
        rejectionReason,
        comments || undefined
      );
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Entry rejected");
        setRejectDialogOpen(false);
        startRefresh(() => router.refresh());
      }
    } finally {
      setSaving(false);
      setRejectionReason("");
      setComments("");
    }
  }

  return (
    <>
      <Card className="border-amber-200 bg-amber-50/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Action Required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pending: <span className="font-medium">{pendingStep.stepLabel}</span>
          </p>

          <div className="space-y-2">
            <Label htmlFor="approveComments">Comments (optional)</Label>
            <Textarea
              id="approveComments"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Add any comments..."
              rows={2}
            />
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={handleApprove}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              Approve
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={openRejectDialog}
              disabled={loading}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Reject
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Stock Entry</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejection. The operator will see this
              reason and can edit and resubmit the entry.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rejectionReason">Reason for Rejection *</Label>
              <Textarea
                id="rejectionReason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Explain why this entry is being rejected..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={loading || !rejectionReason.trim()}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
