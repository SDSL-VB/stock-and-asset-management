import { z } from "zod";

export const createProductRequestSchema = z
  .object({
    type: z.enum(["PRODUCT", "CATEGORY"]),
    name: z.string().min(2, "Name must be at least 2 characters"),
    categoryId: z.string().optional(),
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

