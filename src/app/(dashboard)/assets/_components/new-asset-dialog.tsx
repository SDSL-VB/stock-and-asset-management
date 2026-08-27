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
import { moveStockToDepartment } from "@/lib/actions/stock";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";

type CentralEntry = {
  id: string;
  entryNumber: string;
  itemCode: string | null;
  itemName: string;
  locationName: string | null;
  available: number;
};

interface Props {
  entries: CentralEntry[];
  departments: { id: string; name: string }[];
}

/**
 * Turns existing central stock into a department's asset. Assets are never
 * created from nothing — this picks approved stock that is already in central
 * and moves the chosen quantity in as an asset.
 */
export function NewAssetDialog({ entries, departments }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entryId, setEntryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const selected = entries.find((e) => e.id === entryId);
  const max = selected?.available ?? 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await moveStockToDepartment(entryId, {
        departmentId,
        quantity,
        isAsset: true,
        notes: notes.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${quantity} × ${selected?.itemName ?? "item"} is now an asset of the department`
      );
      setOpen(false);
      setEntryId("");
      setDepartmentId("");
      setQuantity(1);
      setNotes("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
          />
        }
      >
        <Plus className="mr-2 h-4 w-4" />
        New Asset
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Asset from Central Stock</DialogTitle>
        </DialogHeader>

        {entries.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              There is no approved central stock available to turn into an asset.
              Stock has to be received and approved first.
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Stock item *</Label>
              <Select
                value={entryId}
                items={entries.map((e) => ({
                  value: e.id,
                  label: `${e.itemName} — ${e.available} available`,
                }))}
                onValueChange={(v) => {
                  const next = (v as string) ?? "";
                  setEntryId(next);
                  const entry = entries.find((x) => x.id === next);
                  setQuantity(entry ? Math.min(1, entry.available) || 1 : 1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick from central stock" />
                </SelectTrigger>
                <SelectContent>
                  {entries.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.itemName}
                      {e.itemCode ? ` (${e.itemCode})` : ""} — {e.available} available
                      {e.locationName ? ` · ${e.locationName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Department *</Label>
              <Select
                value={departmentId}
                items={departments.map((d) => ({ value: d.id, label: d.name }))}
                onValueChange={(v) => setDepartmentId((v as string) ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Which department will hold it" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="asset-qty">Quantity *</Label>
              <Input
                id="asset-qty"
                type="number"
                min={1}
                max={max || 1}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
                disabled={!entryId}
                required
              />
              {selected && (
                <p className="text-xs text-muted-foreground">
                  {selected.available} available in central stock
                  {selected.locationName ? ` at ${selected.locationName}` : ""}.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="asset-notes">Notes (optional)</Label>
              <Textarea
                id="asset-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Serial number, who it is assigned to, or any reference"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  loading || !entryId || !departmentId || quantity < 1 || quantity > max
                }
                className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Asset
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
