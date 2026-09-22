import { z } from "zod";

export const reviewIntentSchema = z.object({
  reviewNote: z.string().max(500, "Keep the note under 500 characters").optional(),
});

const purchaseOrderLineSchema = z.object({
  productId: z.string().min(1, "Every line needs a product"),
  quantity: z.coerce.number().int("Whole units only").positive("At least one"),
  unitPrice: z.coerce.number().nonnegative("A price cannot be negative"),
  intentId: z.string().optional(),
  notes: z.string().max(300).optional(),
  /** Days the vendor promised for this line; sets the date it is due */
  leadTimeDays: z.coerce.number().int("Whole days").min(0, "A lead time cannot be negative").max(365, "That lead time looks wrong").optional(),
});

export const createPurchaseOrderSchema = z.object({
  vendorId: z.string().min(1, "Choose the vendor this is going to"),
  locationId: z.string().min(1, "Choose where the goods should arrive"),
  expectedDate: z.string().optional(),
  notes: z.string().max(500, "Keep the note under 500 characters").optional(),
  lines: z.array(purchaseOrderLineSchema).min(1, "An order needs at least one line"),
});

export const closePurchaseOrderSchema = z.object({
  closeReason: z.string().max(500, "Keep the reason under 500 characters").optional(),
});

