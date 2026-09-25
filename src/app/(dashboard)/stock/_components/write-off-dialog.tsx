"use client";

/**
 * Reporting stock as unusable.
 *
 * Called by: the stock entry detail page (for central stock), the assets list
 * (for what a department holds), and the Wastage page, which picks the holding
 * first and then shows this same form. One form serves all three — the only
 * difference is which server action it calls, which the `target` prop decides.
 *
 * Nothing is deducted when this is submitted. The write-off is raised as
 * pending and a manager decides; until then the goods stay counted as held but
 * cannot be promised to a dispatch, transfer or build. The copy below says so,
 * because a form that silently did nothing would look broken.
 */

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
import { cn } from "@/lib/utils";
import { createWriteOff, createDepartmentWriteOff } from "@/lib/actions/write-offs";
import {
  WRITE_OFF_REASONS,
  WRITE_OFF_REASON_LABEL,
  WRITE_OFF_REASON_HINT,
} from "@/lib/validations/write-off";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";

export type WriteOffTarget =
  /** Central stock: the loss comes off the stock entry */
  | { kind: "entry"; stockEntryId: string }
  /** A department's holding: the loss comes off that holding only */
  | { kind: "issue"; stockIssueId: string; departmentName: string };

interface Props {
  target: WriteOffTarget;
  itemName: string;
  /** How much can still be written off, after anything already pending */
  available: number;
  unit?: string;
  /** Rendered as a compact row action rather than a full button */
  compact?: boolean;
}

export function WriteOffDialog({ target, itemName, available, unit = "unit", compact }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size={compact ? "sm" : "default"}
            className={cn(
              "border-status-rejected/30 text-status-rejected hover:bg-status-rejected-bg"
            )}
          />
        }
      >
        <TriangleAlert className={cn("h-4 w-4", !compact && "mr-2")} />
        {compact ? <span className="text-xs">Report loss</span> : "Write Off"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report stock as unusable</DialogTitle>
        </DialogHeader>
        <WriteOffForm
          target={target}
          itemName={itemName}
          available={available}
          unit={unit}
          onCancel={() => setOpen(false)}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The form itself: how many, what happened, and in whose words.
 *
 * Separate from the dialog so the Wastage page can put it behind its own
 * "which holding?" step without a second copy of these fields drifting from
 * this one.
 */
export function WriteOffForm({
  target,
  itemName,
  available,
  unit = "unit",
  onCancel,
  onDone,
}: {
  target: WriteOffTarget;
  itemName: string;
  available: number;
  unit?: string;
  onCancel: () => void;
  /** Raised successfully — the caller closes, resets or reloads as it likes */
  onDone: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [quantity, setQuantity] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [notes, setNotes] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        quantity: Number(quantity),
        reason,
        notes,
      };
      const result =
        target.kind === "entry"
          ? await createWriteOff(target.stockEntryId, payload)
          : await createDepartmentWriteOff(target.stockIssueId, payload);

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.writeOffNumber} raised — waiting for a manager to approve it`
      );
      setQuantity("");
      setReason("");
      setNotes("");
      onDone();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  const chosen = WRITE_OFF_REASONS.find((r) => r === reason);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {itemName} — <span className="font-semibold">{available}</span> {unit}
        {available === 1 ? "" : "s"}{" "}
        {target.kind === "issue" ? `held by ${target.departmentName}` : "in central stock"}
      </p>

      <div className="space-y-2">
        <Label htmlFor="writeoff-qty">How many *</Label>
        <Input
          id="writeoff-qty"
          type="number"
          min={0}
          max={available}
          step="any"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder={`Up to ${available}`}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>What happened *</Label>
        <Select
          value={reason}
          items={WRITE_OFF_REASONS.map((r) => ({
            value: r,
            label: WRITE_OFF_REASON_LABEL[r],
          }))}
          onValueChange={(v) => setReason(v ?? "")}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick a reason" />
          </SelectTrigger>
          <SelectContent>
            {WRITE_OFF_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {WRITE_OFF_REASON_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {chosen && (
          <p className="text-caption text-muted-foreground">
            {WRITE_OFF_REASON_HINT[chosen]}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="writeoff-notes">Notes *</Label>
        <Textarea
          id="writeoff-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Corroded in monsoon storage, found at the November stock count…"
          rows={3}
          required
        />
        <p className="text-caption text-muted-foreground">
          Whoever reads the wastage report in six months only has these words
          to go on.
        </p>
      </div>

      <div className="rounded-lg border border-status-pending/30 bg-status-pending-bg p-3 text-caption text-foreground">
        This does not remove the stock yet. A manager has to approve it
        first — until then it stays counted, but nobody can dispatch it or
        build with it.
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading || !reason}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Raise write-off
        </Button>
      </div>
    </form>
  );
}
