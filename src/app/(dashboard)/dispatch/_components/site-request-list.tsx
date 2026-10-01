"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  acceptSiteRequest,
  rejectSiteRequest,
  cancelSiteRequest,
} from "@/lib/actions/fulfilment";
import { toast } from "sonner";
import { Loader2, Check, X, Undo2, ArrowRight } from "lucide-react";

type SiteRequest = {
  id: string;
  requestNumber: string;
  quantity: number;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED";
  notes: string | null;
  reviewNote: string | null;
  createdAt: Date;
  product: { code: string; name: string; unit: string };
  fromLocation: { id: string; name: string };
  toLocation: { id: string; name: string };
  requestedBy: { name: string };
  reviewedBy: { name: string } | null;
  dispatch: {
    id: string;
    dispatchNumber: string;
    status: string;
    items: { quantity: number }[];
  } | null;
};

/** How many the holding site actually sent — fewer than asked on a partial answer */
function sentQuantity(r: SiteRequest) {
  return r.dispatch?.items.reduce((sum, i) => sum + i.quantity, 0) ?? null;
}

interface Props {
  incoming: SiteRequest[];
  outgoing: SiteRequest[];
  canApprove: boolean;
  seesAllSites: boolean;
}

const STATUS_VARIANT: Record<SiteRequest["status"], "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "secondary",
  ACCEPTED: "default",
  REJECTED: "destructive",
  CANCELLED: "outline",
};

const STATUS_LABEL: Record<SiteRequest["status"], string> = {
  PENDING: "Waiting",
  ACCEPTED: "Agreed",
  REJECTED: "Declined",
  CANCELLED: "Withdrawn",
};

function formatDate(d: Date) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(d));
}

/**
 * The two sides of an inter-site request: what we have been asked for, and what
 * we have asked others for.
 *
 * They are separate tables rather than one filtered list, because only one of
 * them is a queue with work in it.
 */
export function SiteRequestList({ incoming, outgoing, canApprove, seesAllSites }: Props) {
  if (incoming.length === 0 && outgoing.length === 0) return null;

  return (
    <div className="space-y-6">
      {incoming.length > 0 && (
        <RequestTable
          title={seesAllSites ? "Site requests" : "Asked of us"}
          description={
            seesAllSites
              ? "Every request between sites. You can answer any of them."
              : "Other sites waiting on stock we are holding"
          }
          rows={incoming}
          side="incoming"
          canApprove={canApprove}
          seesAllSites={seesAllSites}
        />
      )}
      {outgoing.length > 0 && (
        <RequestTable
          title="We have asked for"
          description="Stock we have asked other sites to send"
          rows={outgoing}
          side="outgoing"
          canApprove={canApprove}
          seesAllSites={seesAllSites}
        />
      )}
    </div>
  );
}

function RequestTable({
  title,
  description,
  rows,
  side,
  canApprove,
  seesAllSites,
}: {
  title: string;
  description: string;
  rows: SiteRequest[];
  side: "incoming" | "outgoing";
  canApprove: boolean;
  seesAllSites: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState<SiteRequest | null>(null);
  const [reason, setReason] = useState("");
  // Agreeing: all of it, or only part
  const [accepting, setAccepting] = useState<SiteRequest | null>(null);
  const [sendAll, setSendAll] = useState(true);
  const [sendQty, setSendQty] = useState("");

  function openAccept(request: SiteRequest) {
    setAccepting(request);
    setSendAll(true);
    setSendQty(String(request.quantity));
  }

  function accept() {
    if (!accepting) return;
    const quantity = sendAll ? accepting.quantity : Number(sendQty);
    startTransition(async () => {
      const result = await acceptSiteRequest(accepting.id, { quantity });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Agreed — raised ${result.dispatchNumber}`);
      setAccepting(null);
      router.refresh();
    });
  }

  function reject() {
    if (!rejecting) return;
    startTransition(async () => {
      const result = await rejectSiteRequest(rejecting.id, { reviewNote: reason });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Declined ${rejecting.requestNumber}`);
      setRejecting(null);
      setReason("");
      router.refresh();
    });
  }

  function cancel(request: SiteRequest) {
    startTransition(async () => {
      const result = await cancelSiteRequest(request.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Withdrew ${request.requestNumber}`);
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>
                  {seesAllSites ? "From → To" : side === "incoming" ? "Asked by" : "Asked of"}
                </TableHead>
                <TableHead>Raised</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.requestNumber}</TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.product.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {r.product.code}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.quantity} {r.product.unit}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {seesAllSites ? (
                      <span className="inline-flex items-center gap-1.5">
                        {r.fromLocation.name}
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                        {r.toLocation.name}
                      </span>
                    ) : side === "incoming" ? (
                      r.toLocation.name
                    ) : (
                      r.fromLocation.name
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={STATUS_VARIANT[r.status]}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                      {r.status === "ACCEPTED" && sentQuantity(r) !== null && (
                        <span className="text-xs text-muted-foreground">
                          {sentQuantity(r)! < r.quantity
                            ? `Partly — ${sentQuantity(r)} of ${r.quantity} sent`
                            : "In full"}
                        </span>
                      )}
                      {r.dispatch && (
                        <Link
                          href="/dispatch"
                          className="text-xs text-primary underline-offset-4 hover:underline"
                        >
                          {r.dispatch.dispatchNumber}
                        </Link>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.status === "PENDING" && side === "incoming" && canApprove && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => openAccept(r)} disabled={pending}>
                          {pending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Check className="size-4" />
                          )}
                          Agree
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRejecting(r)}
                          disabled={pending}
                        >
                          <X className="size-4" />
                          Decline
                        </Button>
                      </div>
                    )}
                    {/* Someone who sees every site is on both ends of this, so
                        they get the withdraw action as well as the answer. */}
                    {r.status === "PENDING" && (side === "outgoing" || seesAllSites) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => cancel(r)}
                        disabled={pending}
                      >
                        <Undo2 className="size-4" />
                        Withdraw
                      </Button>
                    )}
                    {r.reviewNote && r.status !== "PENDING" && (
                      <span className="text-xs text-muted-foreground">{r.reviewNote}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={accepting !== null} onOpenChange={(o) => !o && setAccepting(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Agree to {accepting?.requestNumber}</DialogTitle>
            <DialogDescription>
              {accepting?.toLocation.name} asked for {accepting?.quantity}{" "}
              {accepting?.product.unit} of {accepting?.product.name}. Say how much you can
              send — they only learn what you tell them here.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant={sendAll ? "default" : "outline"}
              onClick={() => {
                setSendAll(true);
                setSendQty(String(accepting?.quantity ?? ""));
              }}
            >
              In full — all {accepting?.quantity}
            </Button>
            <Button
              type="button"
              variant={sendAll ? "outline" : "default"}
              onClick={() => setSendAll(false)}
            >
              In part — fewer
            </Button>
          </div>

          {!sendAll && (
            <div className="space-y-2">
              <Label htmlFor="send-qty">How many can you send?</Label>
              <Input
                id="send-qty"
                type="number"
                min={1}
                max={accepting ? accepting.quantity - 1 : undefined}
                value={sendQty}
                onChange={(e) => setSendQty(e.target.value)}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAccepting(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={accept} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Agree and send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline {rejecting?.requestNumber}</DialogTitle>
            <DialogDescription>
              Nothing moves. Say why, so they know whether to ask again later or source it
              elsewhere.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Committed to an order next week"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={reject} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
