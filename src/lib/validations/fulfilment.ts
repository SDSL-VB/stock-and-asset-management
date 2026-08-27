import { z } from "zod";

export const createSiteRequestSchema = z.object({
  productId: z.string().min(1, "Choose which product you need"),
  fromLocationId: z.string().min(1, "Choose which site you are asking"),
  quantity: z.coerce
    .number()
    .int("Ask for a whole number of units")
    .positive("Ask for at least one"),
  notes: z.string().max(500, "Keep the note under 500 characters").optional(),
  /**
   * Which site the stock is for. Omitted by someone who belongs to a site —
   * it is theirs. Required from anyone who sees every site, because they have
   * no home site for it to default to.
   */
  toLocationId: z.string().optional(),
});

export const reviewSiteRequestSchema = z.object({
  reviewNote: z.string().max(500, "Keep the note under 500 characters").optional(),
});

