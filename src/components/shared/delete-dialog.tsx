"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RECYCLE_BIN_DAYS } from "@/lib/recycle-bin";
import { Loader2, Archive, Trash2, AlertTriangle, ChevronRight } from "lucide-react";

/**
 * Two choices you read and click, not three buttons competing in a footer.
 *
 * The old version put Cancel, a red "Delete permanently" and a green
 * "Deactivate instead" side by side, so the eye had to work out which was safe
 * and the recommendation was the loudest thing on screen. Here each option is a
 * row that says what it does and what it costs; the recommended one is marked,
 * and neither shouts.
 *
 * No typing the name to confirm — the recycle bin makes that ceremony
 * unnecessary, because deleting is now recoverable.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being removed, e.g. "1001-0043 Monitor" */
  name: string;
  /** What deleting would affect, in the user's own terms */
  consequence: string;
  /** What deactivating does instead. Omit when the record cannot be deactivated. */
  deactivateHint?: string;
  onDeactivate?: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  /** Set when deletion is genuinely impossible, with the reason why */
  blockedReason?: string | null;
}

export function DeleteDialog({
  open,
  onOpenChange,
  name,
  consequence,
  deactivateHint,
  onDeactivate,
  onDelete,
  blockedReason,
}: Props) {
  const [busy, setBusy] = useState<"deactivate" | "delete" | null>(null);

  async function run(which: "deactivate" | "delete", fn: () => Promise<void> | void) {
    setBusy(which);
    try {
      await fn();
      onOpenChange(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">Remove {name}?</DialogTitle>
          <DialogDescription>{consequence}</DialogDescription>
        </DialogHeader>

        {blockedReason ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{blockedReason}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {onDeactivate && (
              <Choice
                icon={Archive}
                title="Deactivate"
                recommended
                busy={busy === "deactivate"}
                disabled={busy !== null}
                onClick={() => run("deactivate", onDeactivate)}
              >
                {deactivateHint ??
                  "Hidden from every list, and reversible at any time. Nothing is lost."}
              </Choice>
            )}

            <Choice
              icon={Trash2}
              title="Delete"
              busy={busy === "delete"}
              disabled={busy !== null}
              onClick={() => run("delete", onDelete)}
            >
              Removed from the app, and kept in the recycle bin for{" "}
              {RECYCLE_BIN_DAYS} days in case you need it back.
            </Choice>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  icon: Icon,
  title,
  children,
  recommended = false,
  busy = false,
  disabled = false,
  onClick,
}: {
  icon: typeof Archive;
  title: string;
  children: React.ReactNode;
  recommended?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group flex w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-60",
        recommended
          ? "border-primary/40 bg-primary/[0.04] hover:bg-primary/[0.08]"
          : "hover:bg-muted/60"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
          recommended ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {recommended && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-primary">
              Recommended
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-caption text-muted-foreground">{children}</span>
      </span>

      <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
