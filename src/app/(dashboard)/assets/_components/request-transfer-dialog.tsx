"use client";

import { useState } from "react";
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
import { createTransferRequest } from "@/lib/actions/assets";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2, SendHorizonal } from "lucide-react";

interface TransferableEntry {
  id: string;
  entryNumber: string;
  itemCode: string | null;
  itemName: string;
  available: number;
}

interface Props {
  entries: TransferableEntry[];
  departments: { id: string; name: string }[];
}

/**
 * Ask for central stock to be moved into a department — pick the stock first.
 *
 * Lives on the Assets page, because a transfer is how a department comes to
 * hold something. Someone who may move stock directly sees "Move" instead of
 * "Request" and never waits for anyone.
 */
export function RequestTransferPickerDialog({ entries, departments }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entryId, setEntryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const selectedEntry = entries.find((e) => e.id === entryId) ?? null;
  const maxQty = selectedEntry?.available ?? 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entryId) return;
    setLoading(true);
    try {
      const result = await createTransferRequest(entryId, {
        departmentId,
        quantity,
        notes: notes.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Transfer request sent to the department manager for approval");
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
        <SendHorizonal className="mr-2 h-4 w-4" />
        Request transfer
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Stock Transfer</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Stock Item *</Label>
            <Select
              value={entryId}
              items={entries.map((e) => ({
                value: e.id,
                label: `${e.itemName}${e.itemCode ? ` (${e.itemCode})` : ""} — ${e.available} available`,
              }))}
              onValueChange={(v) => {
                const next = v ?? "";
                setEntryId(next);
                const entry = entries.find((en) => en.id === next);
                if (entry) setQuantity(Math.min(quantity, entry.available) || entry.available);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={entries.length === 0 ? "No stock available to request" : "Select approved stock"} />
              </SelectTrigger>
              <SelectContent>
                {entries.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.itemName}
                    {e.itemCode ? ` (${e.itemCode})` : ""} — {e.available} available
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Receiving Department *</Label>
            <Select
              value={departmentId}
              items={departments.map((d) => ({ value: d.id, label: d.name }))}
              onValueChange={(v) => setDepartmentId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="picker-qty">Quantity *</Label>
            <Input
              id="picker-qty"
              type="number"
              min={1}
              max={maxQty || undefined}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
              required
            />
            {selectedEntry && (
              <p className="text-xs text-muted-foreground">
                {selectedEntry.available} unit{selectedEntry.available === 1 ? "" : "s"} available
                (excludes pending requests)
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="picker-notes">Notes (optional)</Label>
            <Textarea
              id="picker-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why the department needs this stock"
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !entryId || !departmentId || quantity < 1 || quantity > maxQty}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Request
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
