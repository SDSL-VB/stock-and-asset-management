import { z } from "zod";
import { PRODUCT_KINDS } from "@/lib/vocabulary";

// A product code is two halves: the category supplies the first (its fixed
// 4-digit prefix) and a person types the second. The prefix is never entered
// by hand — the form shows it fixed and only the rest is editable.
export const createProductSchema = z.object({
  codeSuffix: z
    .string()
    .trim()
    .min(1, "Enter the rest of the product code")
    .max(40, "That part of the code is too long")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9-_]*$/,
      "Use letters, numbers, hyphens and underscores"
    ),
  name: z.string().min(2, "Product name must be at least 2 characters"),
  categoryId: z.string().min(1, "Please select a category"),
  // Omitted means a raw material — the common case, and what an approved
  // operator request creates.
  kind: z.enum(PRODUCT_KINDS).optional(),
  unit: z.string().trim().max(16, "Keep the unit short").optional(),
});

export const updateProductSchema = createProductSchema.extend({
  isActive: z.boolean().optional(),
  // Changing an existing code needs products.code.override; without it the
  // server keeps whatever code the product already has.
  codeSuffix: z.string().trim().optional(),
});

export const createProductCategorySchema = z.object({
  name: z.string().min(2, "Category name must be at least 2 characters"),
});

export const categoryPrefixSchema = z.object({
  codePrefix: z
    .string()
    .regex(/^\d{4}$/, "A code prefix must be exactly 4 digits (e.g. 1001)"),
});

