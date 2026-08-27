import { z } from "zod";

export const dispatchItemSchema = z.object({
  stockEntryId: z.string().min(1, "Pick a stock item"),
  quantity: z.number().int().positive("Quantity must be a positive number"),
  isAsset: z.boolean().optional(),
});

export const createDispatchSchema = z
  .object({
    // Only used by someone with cross-location scope, who has no location of
    // their own to dispatch from
    originLocationId: z.string().optional(),
    destination: z.enum(["LOCATION", "CLIENT"]),
    toLocationId: z.string().optional(),
    clientId: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(dispatchItemSchema).min(1, "Add at least one item to dispatch"),
  })
  .superRefine((data, ctx) => {
    if (data.destination === "LOCATION" && !data.toLocationId?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["toLocationId"],
        message: "Please select the destination location",
      });
    }
    if (data.destination === "CLIENT" && !data.clientId?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["clientId"],
        message: "Please select the client",
      });
    }
  });

export const rejectDispatchSchema = z.object({
  rejectionReason: z.string().min(3, "Please give a reason"),
});

