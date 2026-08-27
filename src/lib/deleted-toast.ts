"use client";

import { toast } from "sonner";
import { restoreRecord } from "@/lib/actions/recycle-bin";
import { RECYCLE_BIN_DAYS } from "@/lib/recycle-bin";

/**
 * The "deleted" toast, with the Undo that makes deleting feel safe.
 *
 * Undo here is not a special code path — it calls the same restore the recycle
 * bin page uses. The toast is simply the fastest way to reach it, for the
 * ten seconds when it is still on your mind.
 */
export function announceDeleted(name: string, recycleId?: string, onRestored?: () => void) {
  if (!recycleId) {
    toast.success(`${name} deleted`);
    return;
  }

  toast.success(`${name} deleted`, {
    description: `Kept in the recycle bin for ${RECYCLE_BIN_DAYS} days.`,
    duration: 10_000,
    action: {
      label: "Undo",
      onClick: async () => {
        const res = await restoreRecord(recycleId);
        if (res?.error) toast.error(res.error);
        else {
          toast.success(`${name} restored`);
          onRestored?.();
        }
      },
    },
  });
}
