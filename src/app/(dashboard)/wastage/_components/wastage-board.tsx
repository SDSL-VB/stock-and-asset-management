"use client";

/**
 * The Wastage page's two halves: what still needs deciding, and what has
 * already been lost.
 *
 * Called by: src/app/(dashboard)/wastage/page.tsx
 *
 * Every action button here is driven by `canDecide` / `canReverse`, which the
 * server computed per row — including the rule that you never review your own
 * write-off. A button the action would refuse is not rendered at all, so the
 * queue only ever offers work this person can actually do.
 */

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  approveWriteOff,
  rejectWriteOff,
  reverseWriteOff,
  type WriteOffRow,
} from "@/lib/actions/write-offs";
import { WRITE_OFF_REASON_LABEL } from "@/lib/validations/write-off";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Check, Loader2, X, Undo2, TriangleAlert, IndianRupee, PackageX } from "lucide-react";
import { statusPill } from "@/lib/design/status";

type Tally = { key: string; quantity: number; value: number; count: number };

interface Summary {
  rows: WriteOffRow[];
  pendingCount: number;
  approvedCount: number;
  totalQuantity: number;
  totalValue: number | null;
  byReason: Tally[];
  byItem: Tally[];
  byPlace: Tally[];
}

interface Props {
  summary: Summary;
  canSeeValue: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Written off",
  REJECTED: "Declined",
  REVERSED: "Reversed",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("text-micro", statusPill(status))}>
      {STATUS_LABEL[status] ?? status}
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

export function WastageBoard({ summary, canSeeValue }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  /** The one dialog that collects a reason, for both declining and reversing. */
  const [reasonFor, setReasonFor] = useState<
    { row: WriteOffRow; kind: "reject" | "reverse" } | null
  >(null);
  const [reasonText, setReasonText] = useState("");

  const pending = summary.rows.filter((r) => r.status === "PENDING");
  const decided = summary.rows.filter((r) => r.status !== "PENDING");

  async function handleApprove(row: WriteOffRow) {
    setBusyId(row.id);
    try {
      const result = await approveWriteOff(row.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${row.writeOffNumber} approved — the stock is now written off`);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function submitReason() {
    if (!reasonFor) return;
    const { row, kind } = reasonFor;
    setBusyId(row.id);
    try {
      const result =
        kind === "reject"
          ? await rejectWriteOff(row.id, { rejectionReason: reasonText })
          : await reverseWriteOff(row.id, { reversalReason: reasonText });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        kind === "reject"
          ? `${row.writeOffNumber} declined — the stock stays available`
          : `${row.writeOffNumber} reversed — the stock is back`
      );
      setReasonFor(null);
      setReasonText("");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const filteredDecided = decided.filter((row) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      row.itemName.toLowerCase().includes(q) ||
      (row.itemCode ?? "").toLowerCase().includes(q) ||
      row.writeOffNumber.toLowerCase().includes(q) ||
      row.place.toLowerCase().includes(q) ||
      row.notes.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* What has actually been lost. Only approved write-offs count — pending
          ones have not been agreed, and declined or reversed ones were never
          real, so folding them in would overstate the damage. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Awaiting a decision"
          value={summary.pendingCount}
          description="Frozen, but still counted as stock"
          icon={TriangleAlert}
          tone="pending"
        />
        <StatCard
          title="Written off"
          value={summary.approvedCount}
          description={`${summary.totalQuantity.toLocaleString("en-IN")} units in total`}
          icon={PackageX}
          tone="rejected"
        />
        {canSeeValue && summary.totalValue !== null && (
          <StatCard
            title="Value lost"
            value={formatCurrency(summary.totalValue)}
            description="At what the stock cost"
            icon={IndianRupee}
            tone="rejected"
          />
        )}
        <StatCard
          title="Biggest cause"
          value={
            summary.byReason.length > 0
              ? WRITE_OFF_REASON_LABEL[
                  summary.byReason[0].key as keyof typeof WRITE_OFF_REASON_LABEL
                ] ?? summary.byReason[0].key
              : "—"
          }
          description={
            summary.byReason.length > 0
              ? `${summary.byReason[0].count} write-off${summary.byReason[0].count === 1 ? "" : "s"}`
              : "Nothing written off yet"
          }
          icon={TriangleAlert}
          tone="info"
        />
      </div>

      <Tabs defaultValue={pending.length > 0 ? "queue" : "history"}>
        <TabsList>
          <TabsTrigger value="queue">
            To decide {pending.length > 0 && `(${pending.length})`}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
        </TabsList>

        {/* ---------------- the queue ---------------- */}
        <TabsContent value="queue">
          <Card>
            <CardContent className="p-0">
              {pending.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Nothing is waiting on a decision.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ref</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Where</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      {canSeeValue && <TableHead className="text-right">Value</TableHead>}
                      <TableHead>Reported by</TableHead>
                      <TableHead className="text-right">Decision</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pending.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{row.writeOffNumber}</TableCell>
                        <TableCell>
                          <Link
                            href={`/stock/${row.entryId}`}
                            className="font-medium hover:underline"
                          >
                            {row.itemName}
                          </Link>
                          <span className="block text-micro text-muted-foreground">
                            {row.notes}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">{row.place}</TableCell>
                        <TableCell className="text-xs">
                          {WRITE_OFF_REASON_LABEL[
                            row.reason as keyof typeof WRITE_OFF_REASON_LABEL
                          ] ?? row.reason}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {row.quantity.toLocaleString("en-IN")}
                        </TableCell>
                        {canSeeValue && (
                          <TableCell className="text-right tabular-nums">
                            {row.value !== null ? formatCurrency(row.value) : "—"}
                          </TableCell>
                        )}
                        <TableCell className="text-xs">
                          {row.raisedByName}
                          <span className="block text-muted-foreground">
                            {formatDate(row.createdAt)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.canDecide ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyId === row.id}
                                onClick={() => {
                                  setReasonText("");
                                  setReasonFor({ row, kind: "reject" });
                                }}
                              >
                                <X className="mr-1 h-3.5 w-3.5" />
                                Decline
                              </Button>
                              <Button
                                size="sm"
                                disabled={busyId === row.id}
                                onClick={() => handleApprove(row)}
                              >
                                {busyId === row.id ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="mr-1 h-3.5 w-3.5" />
                                )}
                                Approve
                              </Button>
                            </div>
                          ) : (
                            /* Not "disabled" — the reason it cannot be acted on
                               is worth saying, since the commonest one is that
                               this is your own report. */
                            <span className="text-micro text-muted-foreground">
                              Waiting on someone else
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- the history ---------------- */}
        <TabsContent value="history">
          <Card>
            <CardHeader>
              <div className="max-w-sm">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by item, reference, place or note..."
                />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Where</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    {canSeeValue && <TableHead className="text-right">Value</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDecided.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={canSeeValue ? 8 : 7}
                        className="h-24 text-center text-muted-foreground"
                      >
                        {decided.length > 0
                          ? "Nothing matches your search."
                          : "Nothing has been decided yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredDecided.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">{row.writeOffNumber}</TableCell>
                        <TableCell>
                          <Link
                            href={`/stock/${row.entryId}`}
                            className="font-medium hover:underline"
                          >
                            {row.itemName}
                          </Link>
                          <span className="block text-micro text-muted-foreground">
                            {row.notes}
                          </span>
                          {row.rejectionReason && (
                            <span className="block text-micro text-status-rejected">
                              Declined: {row.rejectionReason}
                            </span>
                          )}
                          {row.reversalReason && (
                            <span className="block text-micro text-status-info">
                              Reversed: {row.reversalReason}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{row.place}</TableCell>
                        <TableCell className="text-xs">
                          {WRITE_OFF_REASON_LABEL[
                            row.reason as keyof typeof WRITE_OFF_REASON_LABEL
                          ] ?? row.reason}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {row.quantity.toLocaleString("en-IN")}
                        </TableCell>
                        {canSeeValue && (
                          <TableCell className="text-right tabular-nums">
                            {row.value !== null ? formatCurrency(row.value) : "—"}
                          </TableCell>
                        )}
                        <TableCell>
                          <StatusBadge status={row.status} />
                          <span className="block text-micro text-muted-foreground">
                            {row.reviewedByName ?? row.raisedByName} ·{" "}
                            {formatDate(row.createdAt)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.canReverse && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === row.id}
                              onClick={() => {
                                setReasonText("");
                                setReasonFor({ row, kind: "reverse" });
                              }}
                            >
                              <Undo2 className="mr-1 h-3.5 w-3.5" />
                              Put back
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- the breakdown ---------------- */}
        <TabsContent value="breakdown">
          <div className="grid gap-6 lg:grid-cols-3">
            <BreakdownCard
              title="By cause"
              rows={summary.byReason}
              canSeeValue={canSeeValue}
              labelOf={(key) =>
                WRITE_OFF_REASON_LABEL[key as keyof typeof WRITE_OFF_REASON_LABEL] ?? key
              }
            />
            <BreakdownCard title="By item" rows={summary.byItem} canSeeValue={canSeeValue} />
            <BreakdownCard title="By place" rows={summary.byPlace} canSeeValue={canSeeValue} />
          </div>
        </TabsContent>
      </Tabs>

      {/* One dialog, two jobs — declining and reversing both need a reason and
          nothing else. */}
      <Dialog open={reasonFor !== null} onOpenChange={(o) => !o && setReasonFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonFor?.kind === "reject" ? "Decline this write-off" : "Put this stock back"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {reasonFor?.row.quantity} × {reasonFor?.row.itemName} ·{" "}
              {reasonFor?.row.writeOffNumber}
            </p>
            <div className="space-y-2">
              <Label htmlFor="wastage-reason">
                {reasonFor?.kind === "reject"
                  ? "Why is this not being written off? *"
                  : "Why is this being undone? *"}
              </Label>
              <Textarea
                id="wastage-reason"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                rows={3}
                placeholder={
                  reasonFor?.kind === "reject"
                    ? "It can be repaired — send it back to the supplier first"
                    : "Found behind the rack at the December stock count"
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReasonFor(null)}>
                Cancel
              </Button>
              <Button
                onClick={submitReason}
                disabled={busyId !== null || reasonText.trim().length < 3}
              >
                {busyId !== null && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {reasonFor?.kind === "reject" ? "Decline" : "Put back"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One "what did we lose most to" list. Ranked by value where that is visible. */
function BreakdownCard({
  title,
  rows,
  canSeeValue,
  labelOf = (key: string) => key,
}: {
  title: string;
  rows: Tally[];
  canSeeValue: boolean;
  labelOf?: (key: string) => string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet</p>
        ) : (
          <div className="space-y-2">
            {rows.slice(0, 8).map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{labelOf(row.key)}</p>
                  <p className="text-micro text-muted-foreground">
                    {row.quantity.toLocaleString("en-IN")} units · {row.count} write-off
                    {row.count === 1 ? "" : "s"}
                  </p>
                </div>
                {canSeeValue && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-status-rejected">
                    {formatCurrency(row.value)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
