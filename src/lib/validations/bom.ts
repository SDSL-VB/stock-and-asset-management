import { z } from "zod";
import { PRODUCT_KINDS } from "@/lib/vocabulary";

export const productKindSchema = z.object({
  kind: z.enum(PRODUCT_KINDS),
  unit: z.string().trim().min(1, "Unit is required").max(16, "Keep the unit short"),
});

export const bomLineSchema = z.object({
  componentProductId: z.string().min(1, "Pick a component"),
  quantityPerUnit: z
    .number({ error: "Quantity must be a number" })
    .positive("Quantity must be more than zero")
    .max(1_000_000, "That quantity looks wrong"),
  isOptional: z.boolean().optional(),
  notes: z.string().trim().max(300).optional().or(z.literal("")),
});

export const bomLinesSchema = z.object({
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  lines: z.array(bomLineSchema).min(1, "A bill of materials needs at least one component"),
});

export const buildSchema = z.object({
  productId: z.string().min(1, "Pick what to build"),
  quantity: z
    .number({ error: "How many?" })
    .int("Build a whole number of units")
    .positive("Build at least one")
    .max(100_000, "That is more than anyone builds at once"),
  locationId: z.string().min(1, "Pick the site building it"),
  // Empty means the build number is used, which is what a recall follows
  batchNumber: z.string().trim().max(60, "That batch number is too long").optional().or(z.literal("")),
  // Consume the components and leave the run on the floor, to be finished later
  startOnly: z.boolean().optional(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

/** Why one person is being given a permission their role does not carry. */
export const grantPermissionSchema = z.object({
  permissionKey: z.string().min(1, "Pick a permission"),
  reason: z
    .string()
    .trim()
    .min(5, "Say why — a grant with no reason is impossible to review later")
    .max(300, "Keep the reason short"),
  // Empty means it never expires
  expiresAt: z.string().trim().optional().or(z.literal("")),
  // Set once the granter has answered the linked-permissions prompt
  alsoGrant: z.boolean().optional(),
});

