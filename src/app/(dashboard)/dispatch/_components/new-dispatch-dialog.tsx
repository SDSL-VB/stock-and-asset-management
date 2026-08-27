"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createDispatch } from "@/lib/actions/dispatch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Loader2, Trash2, Search } from "lucide-react";

type StockOption = {
  id: string;
  locationId: string | null;
  entryNumber: string;
  itemCode: string | null;
  itemName: string;
  locationName: string | null;
  available: number;
};

type Line = { stockEntryId: string; quantity: number; isAsset: boolean };

interface Props {
  stock: StockOption[];
  locations: { id: string; name: string }[];
  clients: { id: string; name: string; city: string }[];
  /** Cross-location users have no site of their own and pick the origin */
  needsOriginChoice?: boolean;
  allLocations?: { id: string; name: string }[];
  /** The site this person belongs to, when they have one */
  myLocationId?: string | null;
}

export function NewDispatchDialog({
  stock,
  locations,
  clients,
  needsOriginChoice = false,
  allLocations = [],
  myLocationId = null,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [originLocationId, setOriginLocationId] = useState("");
  const [destination, setDestination] = useState<"LOCATION" | "CLIENT">("LOCATION");
  const [toLocationId, setToLocationId] = useState("");
  const [clientId, setClientId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  // Picking items one dropdown at a time meant a consignment of fifteen took
  // fifteen separate selections. Search, tick what is going, add them together.
  const [picking, setPicking] = useState(true);
  const [pickQuery, setPickQuery] = useState("");
  const [pickSelected, setPickSelected] = useState<Set<string>>(new Set());

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  // Where the goods are actually leaving from: the site chosen above, or the
  // one this person belongs to.
  const effectiveOriginId = needsOriginChoice ? originLocationId : myLocationId;

  // Only stock standing at that site can go on the consignment. Filtering on
  // the origin rather than on `needsOriginChoice` matters for somebody who has
  // a site AND sees every site: they were being offered another site's stock,
  // which the server then refused on submit.
  const originStock = effectiveOriginId
    ? stock.filter((s) => s.locationId === effectiveOriginId)
    : stock;

  function optionsFor(index: number) {
    const takenElsewhere = new Set(
      lines.filter((_, i) => i !== index).map((l) => l.stockEntryId).filter(Boolean)
    );
    return originStock.filter((s) => !takenElsewhere.has(s.id));
  }

  // What is left to choose from: everything at the origin not already on a line
  const alreadyAdded = new Set(lines.map((l) => l.stockEntryId).filter(Boolean));
  const pickable = originStock.filter((s) => !alreadyAdded.has(s.id));

  const originName =
    allLocations.find((l) => l.id === effectiveOriginId)?.name ??
    locations.find((l) => l.id === effectiveOriginId)?.name ??
    "this site";

  /** Why there is nothing to choose from, said plainly. */
  const emptyPickerReason = !effectiveOriginId
    ? "Choose which site this is leaving from first."
    : originStock.length === 0
      ? `There is no uncommitted central stock at ${originName} to dispatch.`
      : pickable.length === 0
        ? "Everything available here is already on the consignment."
        : "Nothing matches that search.";

  const pickMatches = pickable.filter((s) => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      s.itemName.toLowerCase().includes(q) ||
      (s.itemCode ?? "").toLowerCase().includes(q) ||
      s.entryNumber.toLowerCase().includes(q)
    );
  });

  function togglePick(id: string) {
    setPickSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addPicked() {
    const added = [...pickSelected].map((id) => ({
      stockEntryId: id,
      // One of each by default — the common case, and easy to raise per line
      quantity: 1,
      isAsset: false,
    }));
    setLines((prev) => [...prev, ...added]);
    setPickSelected(new Set());
    setPickQuery("");
    setPicking(false);
  }

  const validLines = lines.filter((l) => l.stockEntryId && l.quantity > 0);
  const overCommitted = lines.some((l) => {
    const entry = originStock.find((s) => s.id === l.stockEntryId);
    return entry ? l.quantity > entry.available : false;
  });
  const destinationChosen =
    destination === "LOCATION" ? !!toLocationId : !!clientId;
  const originChosen = !needsOriginChoice || !!originLocationId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await createDispatch({
        originLocationId: needsOriginChoice ? originLocationId : undefined,
        destination,
        toLocationId: destination === "LOCATION" ? toLocationId : undefined,
        clientId: destination === "CLIENT" ? clientId : undefined,
        notes: notes.trim() || undefined,
        items: validLines,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        destination === "LOCATION"
          ? "Dispatch raised — waiting for the destination to accept"
          : "Dispatch raised and on its way to the client"
      );
      setOpen(false);
      setToLocationId("");
      setClientId("");
      setNotes("");
      setLines([{ stockEntryId: "", quantity: 1, isAsset: false }]);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold" />
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        New Dispatch
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Dispatch</DialogTitle>
        </DialogHeader>

        {stock.length === 0 && !needsOriginChoice ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              There is no approved central stock available at your location to
              dispatch.
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {needsOriginChoice && (
              <div className="space-y-2">
                <Label>Dispatch from *</Label>
                <Select
                  value={originLocationId}
                  items={allLocations.map((l) => ({ value: l.id, label: l.name }))}
                  onValueChange={(v) => {
                    setOriginLocationId((v as string) ?? "");
                    setLines([{ stockEntryId: "", quantity: 1, isAsset: false }]);
                    setToLocationId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Which site is this leaving from" />
                  </SelectTrigger>
                  <SelectContent>
                    {allLocations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  You see every location, so pick the one this consignment leaves.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Send to *</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDestination("LOCATION")}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm transition",
                    destination === "LOCATION"
                      ? "border-brand-green bg-brand-green/10 font-medium"
                      : "hover:bg-muted/60"
                  )}
                >
                  Another location
                  <span className="block text-xs text-muted-foreground">
                    They accept it, then confirm receipt
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDestination("CLIENT")}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm transition",
                    destination === "CLIENT"
                      ? "border-brand-green bg-brand-green/10 font-medium"
                      : "hover:bg-muted/60"
                  )}
                >
                  A client
                  <span className="block text-xs text-muted-foreground">
                    Goes out straight away
                  </span>
                </button>
              </div>
            </div>

            {destination === "LOCATION" ? (
              <div className="space-y-2">
                <Label>Destination location *</Label>
                <Select
                  value={toLocationId}
                  items={locations
                    .filter((l) => l.id !== originLocationId)
                    .map((l) => ({ value: l.id, label: l.name }))}
                  onValueChange={(v) => setToLocationId((v as string) ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Where is it going" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations
                      .filter((l) => l.id !== originLocationId)
                      .map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Client *</Label>
                <Select
                  value={clientId}
                  items={clients.map((c) => ({
                    value: c.id,
                    label: `${c.name} — ${c.city}`,
                  }))}
                  onValueChange={(v) => setClientId((v as string) ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Which client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — {c.city}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  Items *
                  {lines.length > 0 && (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {lines.length} on this consignment
                    </span>
                  )}
                </Label>
                {!picking && pickable.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPicking(true)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add items
                  </Button>
                )}
              </div>

              {picking && (
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={pickQuery}
                      onChange={(e) => setPickQuery(e.target.value)}
                      placeholder="Search by item, code or entry number"
                      className="pl-9"
                      autoComplete="off"
                    />
                  </div>

                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border bg-background p-1">
                    {pickMatches.length === 0 ? (
                      <p className="px-2 py-6 text-center text-caption text-muted-foreground">
                        {/* Four different reasons the list can be empty, and
                            they need four different answers. It used to say
                            "everything is already on the consignment" for all
                            of them, which reads as a bug when the truth is
                            that no site has been chosen yet. */}
                        {emptyPickerReason}
                      </p>
                    ) : (
                      pickMatches.map((s) => {
                        const ticked = pickSelected.has(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => togglePick(s.id)}
                            className={cn(
                              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                              ticked ? "bg-primary/10" : "hover:bg-muted/60"
                            )}
                          >
                            <Checkbox checked={ticked} className="pointer-events-none" />
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-baseline gap-x-2">
                                <span className="font-mono text-caption text-muted-foreground">
                                  {s.itemCode ?? s.entryNumber}
                                </span>
                                <span className="text-sm font-medium">{s.itemName}</span>
                              </span>
                              <span className="mt-0.5 block text-caption text-muted-foreground">
                                {s.available} available
                                {s.locationName ? ` · ${s.locationName}` : ""}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={addPicked}
                      disabled={pickSelected.size === 0}
                    >
                      Add {pickSelected.size > 0 ? pickSelected.size : ""}{" "}
                      {pickSelected.size === 1 ? "item" : "items"}
                    </Button>
                    {pickMatches.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setPickSelected(
                            pickSelected.size === pickMatches.length
                              ? new Set()
                              : new Set(pickMatches.map((s) => s.id))
                          )
                        }
                      >
                        {pickSelected.size === pickMatches.length
                          ? "Clear all"
                          : `Select all ${pickMatches.length}`}
                      </Button>
                    )}
                    {lines.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPicking(false);
                          setPickSelected(new Set());
                        }}
                      >
                        Done
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {lines.map((line, index) => {
                  const entry = originStock.find((s) => s.id === line.stockEntryId);
                  const options = optionsFor(index);
                  return (
                    <div key={index} className="space-y-2 rounded-lg border p-3">
                      <Select
                        value={line.stockEntryId}
                        items={options.map((s) => ({
                          value: s.id,
                          label: `${s.itemName} — ${s.available} available`,
                        }))}
                        onValueChange={(v) =>
                          updateLine(index, { stockEntryId: (v as string) ?? "" })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pick from central stock" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.itemName}
                              {s.itemCode ? ` (${s.itemCode})` : ""} — {s.available}{" "}
                              available
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <div className="flex flex-wrap items-end gap-2">
                        <div className="flex-1 min-w-[110px] space-y-1">
                          <Label htmlFor={`qty-${index}`} className="text-xs">
                            Quantity
                          </Label>
                          <Input
                            id={`qty-${index}`}
                            type="number"
                            min={1}
                            max={entry?.available ?? 1}
                            value={line.quantity}
                            onChange={(e) =>
                              updateLine(index, {
                                quantity: parseInt(e.target.value, 10) || 0,
                              })
                            }
                            disabled={!line.stockEntryId}
                          />
                        </div>
                        <label className="flex items-center gap-2 pb-2 text-sm">
                          <input
                            type="checkbox"
                            checked={line.isAsset}
                            onChange={(e) =>
                              updateLine(index, { isAsset: e.target.checked })
                            }
                          />
                          Asset
                        </label>
                        {lines.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="pb-2 text-destructive"
                            onClick={() =>
                              setLines((prev) => prev.filter((_, i) => i !== index))
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>

                      {entry && line.quantity > entry.available && (
                        <p className="text-xs text-destructive">
                          Only {entry.available} available.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dispatch-notes">Notes (optional)</Label>
              <Textarea
                id="dispatch-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Courier, docket number, or any reference"
                rows={2}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Each line is stamped with its own batch number when the dispatch is
              raised.
            </p>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  loading ||
                  !originChosen ||
                  !destinationChosen ||
                  validLines.length === 0 ||
                  overCommitted
                }
                className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Raise Dispatch
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
