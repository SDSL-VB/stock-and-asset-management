"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { EmptyState } from "@/components/shared/empty-state";
import {
  approveIntent,
  rejectIntent,
  cancelIntent,
  closePurchaseOrder,
  cancelPurchaseOrder,
} from "@/lib/actions/procurement";
import { NeedDialog, type NeedProduct } from "@/components/shared/need-dialog";
import { NeedListDialog } from "./need-list-dialog";
import { NewOrderDialog } from "./new-order-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ClipboardList, PackageSearch, Check, X, Undo2, Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { toneStyles, type StatusTone } from "@/lib/design/status";
import { updateLeadTimeFromOrder } from "@/lib/actions/suppliers";
import { NEED_STATUS_LABEL } from "@/lib/vocabulary";

/**
 * The Procurement page: stated needs, and the orders raised against them.
 *
 * Two tabs over one journey — an engineer says what is needed, a buyer decides
 * it is worth ordering, and verified needs become an order to a single vendor.
 * Each need can only be ordered once.
 *
 * Tabs are built from permissions rather than fixed, so somebody who may raise
 * needs but not orders sees one tab rather than two with one of them dead.
 *
 * The verification step can be switched off (the stored procurement flow), in
 * which case anything raised is immediately orderable — which is why
 * `requiresApproval` is passed in rather than assumed.
 *
 * Nothing here stores how much of an order is still outstanding. It is the
 * ordered quantity less the stock entries pointing at the line, so a part
 * delivery needs no bookkeeping beyond entering what turned up.
 */

type Intent = {
  id: string;
  intentNumber: string;
  quantity: number;
  status: "PENDING" | "APPROVED" | "ORDERED" | "REJECTED" | "CANCELLED";
  notes: string | null;
  reviewNote: string | null;
  neededBy: Date | null;
  createdAt: Date;
  requestedById: string;
  product: { code: string; name: string; unit: string };
  vendor: { name: string } | null;
  department: { name: string } | null;
  location: { name: string } | null;
  requestedBy: { name: string };
  reviewedBy: { name: string } | null;
  order: { id: string; poNumber: string; status: string } | null;
  needList: { id: string; listNumber: string } | null;
};

type OrderLine = {
  id: string;
  productId: string;
  leadTimeDays: number | null;
  expectedBy: Date | null;
  /** On time / late / overdue against the lead time — src/lib/order-timing.ts */
  timing: { state: "waiting" | "overdue" | "on-time" | "late" | "no-date"; days: number; label: string };
  recordedLeadTime: number | null;
  /** Days it actually took, when clearly longer than the lead time on record */
  suggestedLeadTime: number | null;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  delivered: number;
  outstanding: number;
  unitPrice: number | null;
  lineTotal: number | null;
  intentNumber: string | null;
  notes: string | null;
};

type Order = {
  id: string;
  poNumber: string;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  vendorId: string;
  vendorName: string;
  locationName: string;
  expectedDate: Date | null;
  notes: string | null;
  closeReason: string | null;
  createdAt: Date;
  createdByName: string;
  closedByName: string | null;
  lines: OrderLine[];
  outstanding: number;
  fullyDelivered: boolean;
  partiallyDelivered: boolean;
  total: number | null;
};

interface Props {
  intents: Intent[];
  orders: Order[];
  intentForm: {
    products: NeedProduct[];
    vendors: { id: string; name: string }[];
    locations: { id: string; name: string }[];
  } | null;
  orderableIntents: {
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
    departmentName: string | null;
    requestedByName: string;
    neededBy: Date | null;
  }[];
  orderForm: {
    vendors: { id: string; name: string }[];
    locations: { id: string; name: string }[];
    leadTimes: { productId: string; vendorId: string; leadTimeDays: number }[];
  } | null;
  requiresApproval: boolean;
  canSeeIntents: boolean;
  canRaiseIntent: boolean;
  canApproveIntent: boolean;
  /** Approvers and order raisers may download a need request as CSV / PDF */
  canDownloadLists: boolean;
  canSeeOrders: boolean;
  canRaiseOrder: boolean;
  canCloseOrder: boolean;
  canSeeValue: boolean;
  /** May update a vendor's recorded lead time from a late order */
  canEditLeadTimes: boolean;
  currentUserId: string;
}

// Tones rather than raw palette colours, so the badges follow the theme. The
// tone is chosen per state on purpose: a verified need is still waiting on the
// buyer (blue, in progress) and only an ordered one is settled (green).
const INTENT_STATUS: Record<Intent["status"], { label: string; className: string }> = {
  PENDING: { label: NEED_STATUS_LABEL.PENDING, className: toneStyles("pending").pill },
  APPROVED: { label: NEED_STATUS_LABEL.APPROVED, className: toneStyles("info").pill },
  ORDERED: { label: NEED_STATUS_LABEL.ORDERED, className: toneStyles("approved").pill },
  REJECTED: { label: NEED_STATUS_LABEL.REJECTED, className: toneStyles("rejected").pill },
  CANCELLED: { label: NEED_STATUS_LABEL.CANCELLED, className: toneStyles("draft").pill },
};

const ORDER_STATUS: Record<Order["status"], { label: string; className: string }> = {
  OPEN: { label: "Open", className: toneStyles("info").pill },
  CLOSED: { label: "Closed", className: toneStyles("approved").pill },
  CANCELLED: { label: "Cancelled", className: toneStyles("draft").pill },
};

function formatDate(d: Date | null) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(d));
}

export function ProcurementManager(props: Props) {
  const {
    intents,
    orders,
    intentForm,
    orderableIntents,
    orderForm,
    requiresApproval,
    canSeeIntents,
    canRaiseIntent,
    canApproveIntent,
    canDownloadLists,
    canSeeOrders,
    canRaiseOrder,
    canCloseOrder,
    canSeeValue,
    currentUserId,
    canEditLeadTimes,
  } = props;

  // Only render a tab someone can actually use
  const tabs = [
    canSeeIntents && { value: "needs", label: "Needs", icon: ClipboardList, count: intents.filter((i) => i.status === "PENDING").length },
    canSeeOrders && { value: "orders", label: "Orders", icon: PackageSearch, count: orders.filter((o) => o.status === "OPEN").length },
  ].filter(Boolean) as { value: string; label: string; icon: typeof ClipboardList; count: number }[];

  if (tabs.length === 0) return null;

  return (
    <Tabs defaultValue={tabs[0].value} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              <t.icon className="mr-2 size-4" />
              {t.label}
              {t.count > 0 && ` (${t.count})`}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex flex-wrap gap-2">
          {canRaiseIntent && intentForm && <NeedDialog {...intentForm} />}
          {canRaiseOrder && orderForm && (
            <NewOrderDialog
              {...orderForm}
              orderableIntents={orderableIntents}
              requiresApproval={requiresApproval}
            />
          )}
        </div>
      </div>

      {canSeeIntents && (
        <TabsContent value="needs">
          <IntentTable
            intents={intents}
            canApprove={canApproveIntent}
            canRaise={canRaiseIntent}
            canDownloadLists={canDownloadLists}
            currentUserId={currentUserId}
          />
        </TabsContent>
      )}

      {canSeeOrders && (
        <TabsContent value="orders">
          <OrderList
            orders={orders}
            canClose={canCloseOrder}
            canSeeValue={canSeeValue}
            canEditLeadTimes={canEditLeadTimes}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

function IntentTable({
  intents,
  canApprove,
  canRaise,
  canDownloadLists,
  currentUserId,
}: {
  intents: Intent[];
  canApprove: boolean;
  canRaise: boolean;
  canDownloadLists: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState<Intent | null>(null);
  const [note, setNote] = useState("");

  if (intents.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            emoji="📝"
            title="Nothing has been asked for yet"
            description="When someone needs something bought in, it starts here."
          />
        </CardContent>
      </Card>
    );
  }

  function run(fn: () => Promise<{ error?: string }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(ok);
      setRejecting(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Stated needs</CardTitle>
          <CardDescription>What people have asked to have bought in</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Need</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Asked by</TableHead>
                <TableHead>Suggested vendor</TableHead>
                <TableHead>Needed by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {intents.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">
                    {i.intentNumber}
                    {i.needList && (
                      <div>
                        <NeedListDialog list={i.needList} canDownload={canDownloadLists} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{i.product.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{i.product.code}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {i.quantity} {i.product.unit}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="min-w-0">
                      <p className="truncate">{i.requestedBy.name}</p>
                      {i.department && (
                        <p className="truncate text-xs text-muted-foreground">
                          {i.department.name}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {i.vendor?.name ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(i.neededBy)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant="outline" className={cn(INTENT_STATUS[i.status].className)}>
                        {INTENT_STATUS[i.status].label}
                      </Badge>
                      {i.order && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {i.order.poNumber}
                        </span>
                      )}
                      {i.reviewNote && i.status === "REJECTED" && (
                        <span className="text-xs text-muted-foreground">{i.reviewNote}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {canApprove && i.status === "PENDING" && (
                        <>
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() => run(() => approveIntent(i.id), `Verified ${i.intentNumber}`)}
                          >
                            {pending ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                            Verify
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            onClick={() => setRejecting(i)}
                          >
                            <X className="size-4" />
                            Decline
                          </Button>
                        </>
                      )}
                      {canRaise &&
                        i.requestedById === currentUserId &&
                        (i.status === "PENDING" || i.status === "APPROVED") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() =>
                              run(() => cancelIntent(i.id), `Withdrew ${i.intentNumber}`)
                            }
                          >
                            <Undo2 className="size-4" />
                            Withdraw
                          </Button>
                        )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline {rejecting?.intentNumber}</DialogTitle>
            <DialogDescription>
              Nothing is ordered. Say why, so they know whether to ask again or find another way.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="intent-reject-note">Reason (optional)</Label>
            <Textarea
              id="intent-reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="We already hold enough of these"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                rejecting &&
                run(
                  () => rejectIntent(rejecting.id, { reviewNote: note }),
                  `Declined ${rejecting.intentNumber}`
                )
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Tone for a line's timing: late or overdue stand out, on time is quiet */
const TIMING_TONE: Record<OrderLine["timing"]["state"], StatusTone> = {
  waiting: "info",
  overdue: "rejected",
  "on-time": "approved",
  late: "pending",
  "no-date": "draft",
};

function OrderList({
  orders,
  canClose,
  canSeeValue,
  canEditLeadTimes,
}: {
  orders: Order[];
  canClose: boolean;
  canSeeValue: boolean;
  /** May update a vendor's recorded lead time — see suppliers.ts */
  canEditLeadTimes: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [closing, setClosing] = useState<{ order: Order; mode: "close" | "cancel" } | null>(null);
  const [reason, setReason] = useState("");

  if (orders.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <EmptyState
            emoji="🧾"
            title="No orders yet"
            description="Verified needs become orders, and orders are what the vendor receives."
          />
        </CardContent>
      </Card>
    );
  }

  function run(fn: () => Promise<{ error?: string }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(ok);
      setClosing(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <div className="space-y-4">
        {orders.map((order) => (
          <Card key={order.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base">{order.poNumber}</span>
                    <Badge variant="outline" className={cn(ORDER_STATUS[order.status].className)}>
                      {ORDER_STATUS[order.status].label}
                    </Badge>
                    {order.status === "OPEN" && order.partiallyDelivered && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
                        Part delivered
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {order.vendorName} → {order.locationName} · raised by {order.createdByName}
                    {order.expectedDate && ` · expected ${formatDate(order.expectedDate)}`}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canSeeValue && order.total !== null && (
                    <span className="text-sm font-semibold tabular-nums">
                      {formatMoney(order.total)}
                    </span>
                  )}
                  {canClose && order.status === "OPEN" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setClosing({ order, mode: "close" })}
                      >
                        Close
                      </Button>
                      {!order.partiallyDelivered && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setClosing({ order, mode: "cancel" })}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          Cancel
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Still owed</TableHead>
                    {canSeeValue && <TableHead className="text-right">Unit price</TableHead>}
                    {canSeeValue && <TableHead className="text-right">Line total</TableHead>}
                    <TableHead>Timing</TableHead>
                    <TableHead>From</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{line.productName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {line.productCode}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.quantity} {line.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{line.delivered}</TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          line.outstanding > 0 ? "font-medium text-amber-700 dark:text-amber-500" : "text-muted-foreground"
                        )}
                      >
                        {line.outstanding > 0 ? line.outstanding : "—"}
                      </TableCell>
                      {canSeeValue && (
                        <TableCell className="text-right tabular-nums">
                          {line.unitPrice !== null ? formatMoney(line.unitPrice) : "—"}
                        </TableCell>
                      )}
                      {canSeeValue && (
                        <TableCell className="text-right tabular-nums">
                          {line.lineTotal !== null ? formatMoney(line.lineTotal) : "—"}
                        </TableCell>
                      )}
                      <TableCell>
                        <Badge variant="outline" className={toneStyles(TIMING_TONE[line.timing.state]).pill}>
                          {line.timing.label}
                        </Badge>
                        {line.expectedBy && (
                          <span className="mt-0.5 block text-micro text-muted-foreground">
                            {line.leadTimeDays} day{line.leadTimeDays === 1 ? "" : "s"} · due {formatDate(line.expectedBy)}
                          </span>
                        )}
                        {line.suggestedLeadTime !== null && (
                          <span className="mt-1 block text-micro">
                            Took {line.suggestedLeadTime} days; {order.vendorName} has {line.recordedLeadTime} on record.
                            {canEditLeadTimes && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="ml-1 h-6 px-2 text-micro"
                                disabled={pending}
                                onClick={() =>
                                  startTransition(async () => {
                                    const res = await updateLeadTimeFromOrder(line.productId, order.vendorId, line.suggestedLeadTime!);
                                    if ("error" in res) return void toast.error(res.error);
                                    toast.success(`${order.vendorName}: lead time now ${line.suggestedLeadTime} days`);
                                    router.refresh();
                                  })
                                }
                              >
                                Update lead time to {line.suggestedLeadTime} days
                              </Button>
                            )}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {line.intentNumber ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {order.closeReason && (
                <p className="mt-3 text-sm text-muted-foreground">
                  <span className="font-medium">Closed short:</span> {order.closeReason}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={closing !== null} onOpenChange={(o) => !o && setClosing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {closing?.mode === "cancel" ? "Cancel" : "Close"} {closing?.order.poNumber}
            </DialogTitle>
            <DialogDescription>
              {closing?.mode === "cancel"
                ? "Nothing has arrived against this order, so it can be cancelled outright. Any needs behind it go back to being needs."
                : closing?.order.outstanding
                  ? `${closing.order.outstanding} unit${closing.order.outstanding === 1 ? "" : "s"} are still owed. Closing now says they are never coming — the shortfall stays on the record.`
                  : "Everything ordered has arrived. Closing tidies it away."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="close-reason">Reason (optional)</Label>
            <Textarea
              id="close-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Vendor discontinued the part"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)} disabled={pending}>
              Back
            </Button>
            <Button
              disabled={pending}
              variant={closing?.mode === "cancel" ? "destructive" : "default"}
              onClick={() =>
                closing &&
                run(
                  () =>
                    closing.mode === "cancel"
                      ? cancelPurchaseOrder(closing.order.id, { closeReason: reason })
                      : closePurchaseOrder(closing.order.id, { closeReason: reason }),
                  closing.mode === "cancel"
                    ? `Cancelled ${closing.order.poNumber}`
                    : `Closed ${closing.order.poNumber}`
                )
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {closing?.mode === "cancel" ? "Cancel order" : "Close order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
