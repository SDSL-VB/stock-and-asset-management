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
import { moveStockToDepartment } from "@/lib/actions/stock";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2 } from "lucide-react";

interface Props {
  entryId: string;
  itemName: string;
  remainingQuantity: number;
  departments: { id: string; name: string }[];
}

export function MoveStockDialog({ entryId, itemName, remainingQuantity, departments }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [departmentId, setDepartmentId] = useState("");
  const [quantity, setQuantity] = useState(remainingQuantity);
  const [notes, setNotes] = useState("");
  const [isAsset, setIsAsset] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await moveStockToDepartment(entryId, {
        departmentId,
        quantity,
        isAsset,
        notes: notes || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Moved ${quantity} unit${quantity === 1 ? "" : "s"} to department as ${isAsset ? "an asset" : "stock"}`);
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
        <ArrowRightLeft className="mr-2 h-4 w-4" />
        Move to Department
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move Stock to Department</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {itemName} — <span className="font-semibold">{remainingQuantity}</span> unit
            {remainingQuantity === 1 ? "" : "s"} remaining in stock
          </p>
          <div className="space-y-2">
            <Label>Department *</Label>
            <Select
              value={departmentId}
              items={departments.map((d) => ({ value: d.id, label: d.name }))}
              onValueChange={(v) => setDepartmentId(v ?? "")}
            >
              <SelectTrigger>
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
            <Label htmlFor="move-qty">Quantity *</Label>
            <Input
              id="move-qty"
              type="number"
              min={1}
              max={remainingQuantity}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 0)}
              required
            />
          </div>
          {/* Everything sits in central stock as plain stock; the movement is
              where it is decided what the department receives it as. */}
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
            <Label htmlFor="move-notes">Notes (optional)</Label>
            <Textarea
              id="move-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason or reference for this movement"
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !departmentId || quantity < 1 || quantity > remainingQuantity}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Move Stock
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
