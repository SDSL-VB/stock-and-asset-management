/**
 * A product code has two halves. The category owns the first — a fixed 4-digit
 * prefix — and a person types the second:
 *
 *   Electronics (1001) + "TV55"  →  1001-TV55
 *
 * The category half is never entered on the product form. Every form that asks
 * for a product code shows it locked in front of the input, so the category is
 * always legible in the code itself.
 *
 * A category's own code is TYPED by whoever creates the category, and nothing
 * generates one. That is deliberate: the numbering is a decision about how the
 * catalog is organised, not a counter. Changing it afterwards needs
 * categories.prefix.edit.
 *
 * Everything here is a pure helper, safe to import from client components.
 */

/** A category code is exactly four digits */
export const CODE_PREFIX_PATTERN = /^\d{4}$/;
/** What a person may type as the second half of a code */
export const CODE_SUFFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-_]*$/;

/**
 * Joins the two halves of a product code:
 *   1001 + "TV55" → 1001-TV55
 */
export function composeProductCode(prefix: string, suffix: string): string {
  return `${prefix}-${suffix.trim().toUpperCase()}`;
}

/**
 * The fixed half a category contributes, shown locked in front of the input
 * the user types into — "1001-" for Electronics.
 */
export function codePrefixOf(
  category: { codePrefix: string | null } | null | undefined
): string | null {
  return category?.codePrefix ? `${category.codePrefix}-` : null;
}
