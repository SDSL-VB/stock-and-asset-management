"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { reverseBuild, finishBuild, closeBuildShort } from "@/lib/actions/builds";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Search,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Undo2,
  Hammer,
  Loader2,
} from "lucide-react";

type Build = {
  id: string;
  buildNumber: string;
  quantity: number;
  status: string;
  notes: string | null;
  createdAt: Date;
  reversedAt: Date | null;
  product: { id: string; code: string; name: string; unit: string };
  locationName: string;
  builtByName: string;
  bomVersion: number;
  finished: number;
  onFloor: number;
  outputEntryNumbers: string[];
  closedShortReason: string | null;
  completedAt: Date | null;
  consumptions: {
    quantity: number;
    entryNumber: string;
    itemCode: string | null;
    itemName: string;
    batchNumber: string | null;
  }[];
};

interface Props {
  builds: Build[];
  canReverse: boolean;
  canFinish: boolean;
  canSetBatch: boolean;
}

function formatQty(n: number) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

export function BuildList({ builds, canReverse, canFinish, canSetBatch }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [reversing, setReversing] = useState<Build | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Finishing a run: how many are done, and what batch they carry
  const [finishing, setFinishing] = useState<Build | null>(null);
  const [finishQty, setFinishQty] = useState("");
  const [finishBatch, setFinishBatch] = useState("");
  const [closing, setClosing] = useState<Build | null>(null);
  const [closeReason, setCloseReason] = useState("");

  const onFloorTotal = builds.reduce((sum, b) => sum + b.onFloor, 0);

  function finish() {
    if (!finishing) return;
    startTransition(async () => {
      const res = await finishBuild(
        finishing.id,
        Number(finishQty),
        canSetBatch ? finishBatch : undefined
      );
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.complete
          ? `${finishing.buildNumber} complete — ${res.finished} booked into stock`
          : `${res.finished} booked in; the rest are still on the floor`
      );
      setFinishing(null);
      setFinishQty("");
      setFinishBatch("");
      router.refresh();
    });
  }

  function closeShort() {
    if (!closing) return;
    startTransition(async () => {
      const res = await closeBuildShort(closing.id, closeReason);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${closing.buildNumber} closed`);
      setClosing(null);
      setCloseReason("");
      router.refresh();
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return builds;
    return builds.filter(
      (b) =>
        b.buildNumber.toLowerCase().includes(q) ||
        b.product.name.toLowerCase().includes(q) ||
        b.product.code.toLowerCase().includes(q) ||
        b.locationName.toLowerCase().includes(q) ||
        b.consumptions.some((c) => c.itemName.toLowerCase().includes(q))
    );
  }, [builds, search]);

  function reverse(build: Build) {
    startTransition(async () => {
      const res = await reverseBuild(build.id);
      setReversing(null);
      if (res?.error) return setError(res.error);
      setError(null);
      router.refresh();
    });
  }

  if (builds.length === 0) {
    return (
      <EmptyState
        emoji="🔨"
        title="Nothing built yet"
        description="Use New build to turn components into the thing they make, or open a product's bill of materials and use its Build tab."
        action={{ label: "Bills of materials", href: "/bom" }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {onFloorTotal > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Hammer className="h-4 w-4 shrink-0" />
          <span>
            <strong>{onFloorTotal}</strong> unit{onFloorTotal === 1 ? "" : "s"} on the floor
            across {builds.filter((b) => b.onFloor > 0).length} run
            {builds.filter((b) => b.onFloor > 0).length === 1 ? "" : "s"} — components consumed,
            not yet finished.
          </span>
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by build number, product, site or component"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {filtered.map((b) => {
            const expanded = open === b.id;
            const reversed = b.status === "REVERSED";
            return (
              <div key={b.id}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : b.id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm">{b.buildNumber}</span>
                      <span className={cn("font-medium", reversed && "line-through opacity-60")}>
                        {b.quantity} × {b.product.name}
                      </span>
                      {reversed && (
                        <Badge
                          variant="outline"
                          className="border-slate-200 bg-slate-50 text-micro text-slate-600"
                        >
                          reversed
                        </Badge>
                      )}
                      {b.status === "IN_PROGRESS" && (
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-50 text-micro text-amber-900"
                        >
                          {b.onFloor} on the floor
                          {b.finished > 0 ? ` · ${b.finished} done` : ""}
                        </Badge>
                      )}
                      {b.closedShortReason && (
                        <Badge
                          variant="outline"
                          className="border-slate-200 bg-slate-50 text-micro text-slate-600"
                        >
                          closed short
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {b.locationName} · {b.builtByName} · version {b.bomVersion} ·{" "}
                      {new Date(b.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {b.consumptions.length > 0 &&
                        ` · consumed ${b.consumptions.length} entr${b.consumptions.length === 1 ? "y" : "ies"}`}
                    </p>
                  </div>
                </button>

                {expanded && (
                  <div className="space-y-3 border-t bg-muted/20 px-4 py-3">
                    <div>
                      <h4 className="mb-1.5 text-micro font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        What went in
                      </h4>
                      <div className="space-y-1">
                        {b.consumptions.map((c, i) => (
                          <div
                            key={`${c.entryNumber}-${i}`}
                            className="flex flex-wrap items-center gap-2 text-sm"
                          >
                            <span className="font-mono text-caption text-muted-foreground">
                              {c.itemCode ?? c.entryNumber}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{c.itemName}</span>
                            {c.batchNumber && (
                              <Badge variant="outline" className="text-micro">
                                batch {c.batchNumber}
                              </Badge>
                            )}
                            <span className="tabular-nums">{formatQty(c.quantity)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {b.outputEntryNumbers.length > 0 && !reversed && (
                        <span className="text-caption text-muted-foreground">
                          Came out as{" "}
                          <span className="font-mono">
                            {b.outputEntryNumbers.join(", ")}
                          </span>
                        </span>
                      )}
                      {b.closedShortReason && (
                        <span className="text-caption text-muted-foreground">
                          Closed short: {b.closedShortReason}
                        </span>
                      )}
                      {b.notes && <span className="text-caption">{b.notes}</span>}
                      <Link
                        href={`/bom/${b.product.id}`}
                        className="text-caption text-muted-foreground underline-offset-2 hover:underline"
                      >
                        View its bill of materials
                      </Link>
                      {canFinish && b.status === "IN_PROGRESS" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => {
                              setFinishing(b);
                              setFinishQty(String(b.onFloor));
                              setFinishBatch("");
                            }}
                            disabled={pending}
                          >
                            <Hammer className="mr-1.5 h-3.5 w-3.5" />
                            Finish
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setClosing(b)}
                            disabled={pending}
                          >
                            Close short
                          </Button>
                        </>
                      )}
                      {canReverse && !reversed && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setReversing(b)}
                          disabled={pending}
                        >
                          <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                          Undo this build
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {finishing && (
        <Dialog open onOpenChange={(o) => !o && setFinishing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Finish {finishing.product.name}</DialogTitle>
              <DialogDescription>
                {finishing.onFloor} of {finishing.buildNumber} are on the floor. Book in however
                many are actually done — the rest stay there.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="finish-qty">How many are finished</Label>
                <Input
                  id="finish-qty"
                  type="number"
                  min="1"
                  max={finishing.onFloor}
                  step="1"
                  value={finishQty}
                  onChange={(e) => setFinishQty(e.target.value)}
                  className="tabular-nums"
                />
              </div>

              {canSetBatch && (
                <div className="space-y-1.5">
                  <Label htmlFor="finish-batch">Batch number</Label>
                  <Input
                    id="finish-batch"
                    value={finishBatch}
                    onChange={(e) => setFinishBatch(e.target.value)}
                    placeholder={`Leave empty to use ${finishing.buildNumber}`}
                  />
                  <p className="text-micro text-muted-foreground">
                    Each batch out of a run can carry its own number, so a recall can tell them
                    apart.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setFinishing(null)} disabled={pending}>
                Cancel
              </Button>
              <Button
                onClick={finish}
                disabled={
                  pending ||
                  Number(finishQty) < 1 ||
                  Number(finishQty) > finishing.onFloor
                }
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Book {finishQty || 0} into stock
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {closing && (
        <Dialog open onOpenChange={(o) => !o && setClosing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Close {closing.buildNumber} short?</DialogTitle>
              <DialogDescription>
                {closing.finished} of {closing.quantity} were made. The components for the
                remaining {closing.onFloor} stay consumed — they are in scrap or half-built
                units, not back on the shelf.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="close-reason">Why is the rest not being made?</Label>
              <Input
                id="close-reason"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder="Damaged in assembly, design changed…"
              />
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setClosing(null)} disabled={pending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={closeShort}
                disabled={pending || closeReason.trim().length < 3}
              >
                Close the run
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {reversing && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setReversing(null)}
          destructive
          title={`Undo ${reversing.buildNumber}?`}
          description={`This puts ${reversing.quantity} × ${reversing.product.name} back into its components and removes the stock entry the build produced. It only works while nothing has been moved or dispatched from it.`}
          confirmLabel="Undo the build"
          onConfirm={() => reverse(reversing)}
        />
      )}
    </div>
  );
}
