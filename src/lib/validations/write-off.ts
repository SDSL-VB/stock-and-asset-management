import { z } from "zod";

/**
 * What a write-off form has to contain.
 *
 * Used by: src/lib/actions/write-offs.ts, and the dialogs that call it.
 *
 * The notes field is required and has a real minimum length. "Why" is the
 * entire point of the record — a write-off that says only "damaged: 4" tells
 * whoever reads the wastage report in six months nothing they can act on.
 */

export const WRITE_OFF_REASONS = [
  "DAMAGED",
  "LOST",
  "EXPIRED",
  "DEFECTIVE",
  "OBSOLETE",
  "OTHER",
] as const;

/** What each reason means, for the moment someone has to choose one. */
export const WRITE_OFF_REASON_LABEL: Record<(typeof WRITE_OFF_REASONS)[number], string> = {
  DAMAGED: "Damaged",
  LOST: "Lost",
  EXPIRED: "Expired",
  DEFECTIVE: "Defective",
  OBSOLETE: "Obsolete",
  OTHER: "Other",
};

export const WRITE_OFF_REASON_HINT: Record<(typeof WRITE_OFF_REASONS)[number], string> = {
  DAMAGED: "Broke, got wet, was dropped or crushed.",
  LOST: "Not there at a stock count, and nobody knows where it went.",
  EXPIRED: "Shelf life ran out — adhesives, batteries, chemicals.",
  DEFECTIVE: "Arrived unusable, or failed the first time it was used.",
  OBSOLETE: "Still fine, but nothing we make uses it any more.",
  OTHER: "Something else — say what in the notes.",
};

export const createWriteOffSchema = z.object({
  // Float rather than int: 3.5 metres of damaged cable is a real write-off.
  quantity: z.number().positive("Quantity must be more than zero"),
  reason: z.enum(WRITE_OFF_REASONS),
  notes: z
    .string()
    .trim()
    .min(5, "Say what happened — a few words is enough, but not none"),
});

export const rejectWriteOffSchema = z.object({
  rejectionReason: z
    .string()
    .trim()
    .min(3, "Say why this is not being written off"),
});

export const reverseWriteOffSchema = z.object({
  reversalReason: z
    .string()
    .trim()
    .min(3, "Say why this write-off is being undone"),
});
