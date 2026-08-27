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
import { cn } from "@/lib/utils";
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

interface Props {
  entryId: string;
  itemName: string;
  availableQuantity: number;
  departments: { id: string; name: string }[];
}

export function RequestTransferDialog({ entryId, itemName, availableQuantity, departments }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [quantity, setQuantity] = useState(availableQuantity);
  const [notes, setNotes] = useState("");
  const [isAsset, setIsAsset] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await createTransferRequest(entryId, {
        departmentId,
        quantity,
        isAsset,
        notes: notes.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Transfer request sent to the department manager for approval");
      setOpen(false);
      setDepartmentId("");
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
          <Button className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold" />
        }
      >
        <SendHorizonal className="mr-2 h-4 w-4" />
        Request Transfer
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Stock Transfer</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {itemName} — <span className="font-semibold">{availableQuantity}</span> unit
            {availableQuantity === 1 ? "" : "s"} available. The receiving department&apos;s
            manager must approve before the stock moves.
          </p>
          <div className="space-y-2">
            <Label>Department *</Label>
            <Select
              value={departmentId}
              items={departments.map((d) => ({ value: d.id, label: d.name }))}
              onValueChange={(v) => setDepartmentId(v ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select receiving department" />
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
            <Label htmlFor="transfer-qty">Quantity *</Label>
            <Input
              id="transfer-qty"
              type="number"
              min={1}
              max={availableQuantity}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
              required
            />
          </div>
          {/* Everything sits in central stock as plain stock; this is where it
              is decided what the department receives it as. */}
          <div className="space-y-2">
            <Label>Receive as *</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsAsset(false)}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition",
                  !isAsset
                    ? "border-brand-green bg-brand-green/10 font-medium"
                    : "hover:bg-muted/60"
                )}
              >
                Stock
                <span className="block text-xs text-muted-foreground">
                  Consumable, drawn down over time
                </span>
              </button>
              <button
                type="button"
                onClick={() => setIsAsset(true)}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition",
                  isAsset
                    ? "border-brand-green bg-brand-green/10 font-medium"
                    : "hover:bg-muted/60"
                )}
              >
                Asset
                <span className="block text-xs text-muted-foreground">
                  Retained and tracked by the department
                </span>
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-notes">Notes (optional)</Label>
            <Textarea
              id="transfer-notes"
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
              disabled={loading || !departmentId || quantity < 1 || quantity > availableQuantity}
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
