"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWriteOffCandidates, type WriteOffCandidate } from "@/lib/actions/write-offs";
import { WriteOffForm } from "@/app/(dashboard)/stock/_components/write-off-dialog";
import { ArrowLeft, Loader2, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

/**
 * Reporting wastage from the Wastage page itself.
 *
 * Until now a loss could only be reported from the stock entry it came off, or
 * from the assets list — so the page that exists to show wastage was the one
 * place you could not record any. This asks the same two questions in one
 * dialog: WHICH holding, then the ordinary write-off form.
 *
 * The list is every holding this person can already see with something free on
 * it: central stock at their sites, and what their departments hold.
 */
export function RecordWastageDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<WriteOffCandidate[] | null>(null);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<WriteOffCandidate | null>(null);

  /**
   * Opening is what loads the list — not the page, because most visits here
   * are to review what other people raised.
   */
  function openDialog() {
    setOpen(true);
    if (candidates) return;
    setLoading(true);
    getWriteOffCandidates()
      .then(setCandidates)
      .catch(() => toast.error("Could not load what is in stock"))
      .finally(() => setLoading(false));
  }

  const q = search.trim().toLowerCase();
  const shown = (candidates ?? []).filter(
    (c) =>
      !q ||
      c.itemName.toLowerCase().includes(q) ||
      (c.itemCode ?? "").toLowerCase().includes(q) ||
      c.entryNumber.toLowerCase().includes(q) ||
      c.place.toLowerCase().includes(q) ||
      (c.batchNumber ?? "").toLowerCase().includes(q)
  );

  function close() {
    setOpen(false);
    // Next time starts clean, and the list is re-read so a holding written off
    // in the meantime is no longer offered.
    setChosen(null);
    setSearch("");
    setCandidates(null);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : close())}>
      <Button
        variant="outline"
        className="border-status-rejected/30 text-status-rejected hover:bg-status-rejected-bg"
        onClick={openDialog}
      >
        <TriangleAlert className="mr-2 h-4 w-4" />
        Report wastage
      </Button>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {chosen ? `Report ${chosen.itemName} as unusable` : "What was lost or damaged?"}
          </DialogTitle>
        </DialogHeader>

        {chosen ? (
          <div className="space-y-3">
            <Button variant="ghost" size="sm" onClick={() => setChosen(null)}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Pick something else
            </Button>
            <WriteOffForm
              target={chosen.target}
              itemName={`${chosen.itemName} (${chosen.entryNumber})`}
              available={chosen.available}
              unit={chosen.unit}
              onCancel={close}
              onDone={close}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by item, code, entry, batch or where it is..."
                className="pl-9"
              />
            </div>

            {loading ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading what is in stock…
              </p>
            ) : shown.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                {candidates && candidates.length === 0
                  ? "Nothing you can see has any stock left on it to report."
                  : "Nothing matches that."}
              </p>
            ) : (
              <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
                {shown.map((c) => (
                  <li key={c.key}>
                    <button
                      type="button"
                      onClick={() => setChosen(c)}
                      className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {c.itemName}
                          {c.isAsset && <span className="ml-1.5 text-xs text-muted-foreground">· asset</span>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.entryNumber}
                          {c.itemCode ? ` · ${c.itemCode}` : ""}
                          {c.batchNumber ? ` · batch ${c.batchNumber}` : ""} · {c.place}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums">
                        {c.available} {c.unit}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
