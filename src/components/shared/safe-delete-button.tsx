"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DeleteDialog } from "./delete-dialog";
import { toast } from "sonner";
import { announceDeleted } from "@/lib/deleted-toast";
import { Trash2 } from "lucide-react";

/**
 * What every delete action in this codebase returns.
 *
 * The first call reports what would be destroyed; the caller passes
 * { force: true } to insist. `blocked` is for the rare case where deleting
 * would genuinely corrupt something else and no amount of insisting helps.
 */
export type SafeDeleteResult = {
  error?: string;
  blocked?: boolean;
  needsConfirmation?: boolean;
  /** Id of the recycle-bin entry, so the toast can offer Undo */
  recycleId?: string;
  message?: string;
  recommendation?: string;
  success?: boolean;
};

interface Props {
  /** Shown in the dialog and typed by the user to confirm */
  name: string;
  /** Called with force:false first, then force:true if the user insists */
  onDelete: (options: { force: boolean }) => Promise<SafeDeleteResult>;
  /** Offered as the recommended alternative. Omit when there is nothing to deactivate. */
  onDeactivate?: () => Promise<{ error?: string } | void>;
  /** Fallback text when the action does not send one back */
  consequence?: string;
  deactivateHint?: string;
  label?: string;
  /** Icon-only button, for use inside a table row */
  compact?: boolean;
  onDone?: () => void;
}

/**
 * A delete button that steers to deactivating first and still lets you through.
 *
 * Blocking deletion outright is what this replaces: anything with a single
 * linked record could never be removed, which reads as a bug rather than a
 * safety feature.
 */
export function SafeDeleteButton({
  name,
  onDelete,
  onDeactivate,
  consequence,
  deactivateHint,
  label = "Delete",
  compact = false,
  onDone,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [warning, setWarning] = useState<{
    message?: string;
    recommendation?: string;
    blocked?: string;
  } | null>(null);

  function ask() {
    startTransition(async () => {
      const res = await onDelete({ force: false });

      if (res.blocked && res.error) {
        setWarning({ blocked: res.error });
        setOpen(true);
        return;
      }
      if (res.error) {
        toast.error(res.error);
        return;
      }
      if (res.needsConfirmation) {
        setWarning({ message: res.message, recommendation: res.recommendation });
        setOpen(true);
        return;
      }
      // Nothing referenced it, so it is already gone
      announceDeleted(name, res.recycleId, router.refresh);
      setOpen(false);
      onDone?.();
      router.refresh();
    });
  }

  function confirm() {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        const res = await onDelete({ force: true });
        if (res.error) toast.error(res.error);
        else {
          announceDeleted(name, res.recycleId, router.refresh);
          onDone?.();
          router.refresh();
        }
        resolve();
      });
    });
  }

  function deactivate() {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        const res = await onDeactivate?.();
        if (res && "error" in res && res.error) toast.error(res.error);
        else {
          toast.success(`${name} deactivated`);
          onDone?.();
          router.refresh();
        }
        resolve();
      });
    });
  }

  return (
    <>
      {compact ? (
        <Button
          size="icon"
          variant="ghost"
          onClick={ask}
          disabled={pending}
          aria-label={`${label} ${name}`}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={ask}
          disabled={pending}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {label}
        </Button>
      )}

      {open && (
        <DeleteDialog
          open
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setWarning(null);
          }}
          name={name}
          consequence={
            warning?.message ?? consequence ?? `This permanently removes ${name}.`
          }
          blockedReason={warning?.blocked ?? null}
          deactivateHint={
            onDeactivate
              ? (warning?.recommendation ??
                deactivateHint ??
                "Deactivating hides it from every list while keeping the record and its history.")
              : undefined
          }
          onDeactivate={onDeactivate ? deactivate : undefined}
          onDelete={confirm}
        />
      )}
    </>
  );
}
