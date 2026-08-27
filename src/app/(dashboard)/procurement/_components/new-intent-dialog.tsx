"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { createIntent } from "@/lib/actions/procurement";
import { toast } from "sonner";
import { Plus, Search, Check, Loader2 } from "lucide-react";

type Product = {
  id: string;
  code: string;
  name: string;
  unit: string;
  kind: string;
  categoryName: string;
};

interface Props {
  products: Product[];
  vendors: { id: string; name: string }[];
  locations: { id: string; name: string }[];
}

/**
 * "We need this."
 *
 * Deliberately short: the person raising it knows what and how many, and may
 * know who to buy from. Everything commercial belongs on the order, not here.
 */
export function NewIntentDialog({ products, vendors, locations }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, startSaving] = useTransition();

  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [vendorId, setVendorId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          p.categoryName.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [products, query]);

  function reset() {
    setQuery("");
    setPicked(null);
    setQuantity("1");
    setVendorId("");
    setLocationId("");
    setNeededBy("");
    setNotes("");
  }

  function submit() {
    if (!picked) {
      toast.error("Choose what is needed");
      return;
    }
    startSaving(async () => {
      const result = await createIntent({
        productId: picked.id,
        quantity: Number(quantity),
        vendorId: vendorId || undefined,
        locationId: locationId || undefined,
        neededBy: neededBy || undefined,
        notes,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Raised ${result.intent?.intentNumber ?? "the need"}`);
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <Plus className="size-4" />
        State a need
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What do you need?</DialogTitle>
          <DialogDescription>
            This goes to whoever buys. You do not have to know the price or the terms.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="intent-product">Item</Label>
            {picked ? (
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2">
                <Check className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-medium">{picked.name}</span>{" "}
                  <span className="text-muted-foreground">({picked.code})</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="intent-product"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, code or category"
                    className="pl-9"
                  />
                </div>
                <div className="max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {matches.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      Nothing matches “{query}”.
                    </p>
                  ) : (
                    matches.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setPicked(p);
                          setQuery("");
                        }}
                        className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">
                          <span className="font-medium">{p.name}</span>{" "}
                          <span className="text-muted-foreground">{p.code}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {p.categoryName}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="intent-qty">
                How many{picked ? ` (${picked.unit})` : ""}
              </Label>
              <Input
                id="intent-qty"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="intent-needed">Needed by (optional)</Label>
              <Input
                id="intent-needed"
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Suggested vendor (optional)</Label>
              <Select
                value={vendorId}
                items={vendors.map((v) => ({ value: v.id, label: v.name }))}
                onValueChange={(v) => setVendorId((v as string) ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No preference" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Deliver to (optional)</Label>
              <Select
                value={locationId}
                items={locations.map((l) => ({ value: l.id, label: l.name }))}
                onValueChange={(v) => setLocationId((v as string) ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Your own site" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="intent-notes">Why (optional)</Label>
            <Textarea
              id="intent-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What it is for, or anything that helps them buy the right thing"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !picked}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Raise it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
