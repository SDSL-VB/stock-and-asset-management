import { z } from "zod";
import { PRODUCT_KINDS } from "@/lib/vocabulary";
import {
  SUBCATEGORY_CODE_PATTERN,
  CATEGORY_CODE_PATTERN,
  CATEGORY_CODE_CEILING,
} from "@/lib/product-codes";

/**
 * What the catalog forms accept.
 *
 * Two of these fields are conditionally required, and the condition lives in
 * the database (`catalog_config`) rather than here: it records
 * whether a product must carry a subcategory and a description. So the schemas
 * below accept them as optional and `catalogRuleErrors()` applies the rules —
 * one function, called by the server action and by the form, so the two cannot
 * disagree about what is required.
 */

// A product code is the category's code, optionally the subcategory's, and a
// number the server hands out — 1001-RESI-001, then 002. None of the three is
// typed on the ordinary form; the first two are re-read from the database and
// the third is allocated inside the same transaction that creates the product.
export const createProductSchema = z.object({
  // Optional: the number is given out by the server (001, 002, … within the
  // subcategory). Only somebody holding products.code.override may say what it
  // should be instead, and the server checks that before honouring this.
  codeSuffix: z
    .string()
    .trim()
    .max(40, "That part of the code is too long")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9-_]*$/,
      "Use letters, numbers, hyphens and underscores"
    )
    .optional()
    .or(z.literal("").transform(() => undefined)),
  name: z.string().min(2, "Product name must be at least 2 characters"),
  categoryId: z.string().min(1, "Please select a category"),
  // Optional here whatever the rules say — see catalogRuleErrors().
  subcategoryId: z.string().optional(),
  description: z
    .string()
    .trim()
    .max(300, "Keep the description to a line or two")
    .optional(),
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

/**
 * The rules an admin switched on, applied to one submission.
 *
 * Returns the first thing wrong, or null. Kept separate from the Zod schemas
 * above because these requirements are configuration, not shape: the same
 * payload is valid on one deployment and rejected on another.
 */
export type CatalogRules = {
  requireSubcategory: boolean;
  /** Must every subcategory carry a code of its own? */
  requireSubcategoryCode: boolean;
  requireDescription: boolean;
  /** The longest a category code may be, in characters */
  categoryCodeLength: number;
};

export function catalogRuleErrors(
  value: { subcategoryId?: string | null; description?: string | null },
  rules: Pick<CatalogRules, "requireSubcategory" | "requireDescription">,
  /** False when the chosen category has no subcategories to offer yet. */
  subcategoriesAvailable = true
): string | null {
  if (rules.requireSubcategory && subcategoriesAvailable && !value.subcategoryId) {
    return "Pick a subcategory — this catalog requires one";
  }
  if (rules.requireDescription && !value.description?.trim()) {
    return "Add a description — this catalog requires one";
  }
  return null;
}

/**
 * The category's own code — the fixed first part of every product code it hands
 * out. A person types it; nothing generates it. The same rule applies whether it
 * is being set at creation or changed afterwards, so both schemas share this.
 *
 * Only the SHAPE is checked here: letters, digits or both. How long a code may
 * be is configuration (`categoryCodeLength`), so the action checks that with
 * `categoryCodeError()` once it has read the setting. The ceiling below only
 * keeps a pathological string out of the database.
 */
const codePrefixField = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "Enter a category code")
  .max(CATEGORY_CODE_CEILING, `Keep the category code to ${CATEGORY_CODE_CEILING} characters`)
  .regex(
    CATEGORY_CODE_PATTERN,
    "A category code is letters and digits only — no spaces, hyphens or symbols"
  );

export const createProductCategorySchema = z.object({
  name: z.string().min(2, "Category name must be at least 2 characters"),
  codePrefix: codePrefixField,
});

export const categoryPrefixSchema = z.object({
  codePrefix: codePrefixField,
});

/**
 * A subcategory: a name, and optionally a code that becomes the middle segment
 * of every product code filed under it.
 *
 * An empty code is normalised to null rather than "" — the two would behave
 * differently in `composeProductCode` and in the per-category unique index,
 * where several subcategories may have no code but only one may have "PCB".
 */
export const subcategorySchema = z.object({
  categoryId: z.string().min(1, "Please select a category"),
  name: z.string().trim().min(2, "Subcategory name must be at least 2 characters"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      SUBCATEGORY_CODE_PATTERN,
      "Use 1–8 letters or digits, no spaces or hyphens"
    )
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/**
 * A new category, optionally with its subcategories typed in the same form —
 * "Electronics" with PCB and Resistor in one go, rather than creating the
 * category and then opening its Subcategories dialog.
 */
export const newCategorySchema = createProductCategorySchema.extend({
  subcategories: z
    .array(subcategorySchema.omit({ categoryId: true }))
    .max(50, "Add at most 50 subcategories at once")
    .default([]),
});

export const updateSubcategorySchema = subcategorySchema
  .omit({ categoryId: true })
  .extend({ isActive: z.boolean().optional() });

/**
 * The catalog settings themselves, as saved from the Catalog settings dialog.
 *
 * The length is bounded here rather than left open: a code longer than the
 * ceiling would still be accepted by `codePrefixField` and then rejected by
 * nothing, and a length of zero would make every category uncodeable.
 */
export const catalogSettingsSchema = z.object({
  requireSubcategory: z.boolean(),
  requireSubcategoryCode: z.boolean(),
  requireDescription: z.boolean(),
  categoryCodeLength: z
    .number()
    .int("Give a whole number of characters")
    .min(1, "A category code needs at least 1 character")
    .max(CATEGORY_CODE_CEILING, `A category code may be at most ${CATEGORY_CODE_CEILING} characters`),
});
