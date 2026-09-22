import { z } from "zod";

export const createProductRequestSchema = z
  .object({
    type: z.enum(["PRODUCT", "CATEGORY"]),
    name: z.string().min(2, "Name must be at least 2 characters"),
    categoryId: z.string().optional(),
    // What the asker thinks it is. Both are suggestions — the reviewer decides,
    // because they are the one the catalog rules are enforced against.
    subcategoryId: z.string().optional(),
    description: z.string().trim().max(300, "Keep the description to a line or two").optional(),
    notes: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "PRODUCT" && !data.categoryId) {
      ctx.addIssue({
        code: "custom",
        path: ["categoryId"],
        message: "Please select a category for the product",
      });
    }
  });

export const approveProductRequestSchema = z.object({
  // Admin finalizes the exact code/name when approving a product request
  code: z
    .string()
    .min(2, "Product code must be at least 2 characters")
    .max(50, "Product code must be at most 50 characters")
    .regex(/^[A-Za-z0-9][A-Za-z0-9-_]*$/, "Code can only contain letters, numbers, hyphens, and underscores")
    .optional(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  categoryId: z.string().optional(),
  // Read only for a PRODUCT request. The reviewer confirms or changes what the
  // asker suggested, and must satisfy whatever the catalog rules require — they
  // are the one creating the product.
  subcategoryId: z.string().optional(),
  description: z.string().trim().max(300, "Keep the description to a line or two").optional(),
  // Only read when approving a CATEGORY request: the reviewer types the code
  // the new category will hand out. Optional here because this schema covers
  // product approvals too; approveProductRequest insists on it for categories.
  codePrefix: z.string().optional(),
  reviewNote: z.string().optional(),
});

export const rejectRequestSchema = z.object({
  reviewNote: z.string().min(1, "Please give a reason for rejecting"),
});

export const createTransferRequestSchema = z.object({
  departmentId: z.string().min(1, "Please select a department"),
  quantity: z.number().int().positive("Quantity must be a positive number"),
  // Everything sits in central stock as plain stock; this is where the
  // requester says what it should become in the receiving department.
  isAsset: z.boolean().optional(),
  notes: z.string().optional(),
});

