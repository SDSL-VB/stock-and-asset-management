/**
 * How a product code is built. The one place that decides it.
 *
 * A code has up to three parts, and only the last is ever typed on the product
 * form:
 *
 *   Electronics (1004) + PCB + "3W_CONTROL_BOARD" → 1004-PCB-3W_CONTROL_BOARD
 *   Electronics (1004) +     + "TV55"             → 1004-TV55
 *
 * The middle part comes from the subcategory and is OPTIONAL. A subcategory
 * with no code contributes nothing, which produces exactly the two-part code
 * every product had before subcategories existed — so adding this feature
 * reissued nothing. Whether a subcategory must have a code at all is a stored
 * setting (`catalog_config`), not a rule in here.
 *
 * The category half is never accepted from the browser. Every form shows it
 * locked in front of the input and the server re-reads it from the category, so
 * a posted code cannot claim to belong to a category it does not.
 *
 * Everything here is a pure helper, safe to import from client components.
 */

/** A category code is exactly four digits */
export const CODE_PREFIX_PATTERN = /^\d{4}$/;
/** What a person may type as the last part of a code */
export const CODE_SUFFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-_]*$/;
/**
 * A subcategory code. Letters and digits only — no hyphen, because the hyphen
 * is what separates the parts, and "PC-B" would make `1004-PC-B-TV55` ambiguous
 * about where the subcategory ends.
 */
export const SUBCATEGORY_CODE_PATTERN = /^[A-Za-z0-9]{1,8}$/;

/**
 * Joins the parts of a product code. A null or empty subcategory code is simply
 * left out rather than producing an empty segment.
 *
 *   ("1004", "PCB", "3w_control_board") → "1004-PCB-3W_CONTROL_BOARD"
 *   ("1004", null,  "tv55")             → "1004-TV55"
 */
export function composeProductCode(
  categoryCode: string,
  subcategoryCode: string | null | undefined,
  suffix: string
): string {
  const middle = subcategoryCode?.trim().toUpperCase();
  return [categoryCode, middle || null, suffix.trim().toUpperCase()]
    .filter(Boolean)
    .join("-");
}

/**
 * The fixed part a category contributes, shown locked in front of the input —
 * "1004-" for Electronics.
 */
export function codePrefixOf(
  category: { codePrefix: string | null } | null | undefined
): string | null {
  return category?.codePrefix ? `${category.codePrefix}-` : null;
}

/**
 * Everything to the left of what a person types, so the form can show the whole
 * locked part in one go: "1004-" or "1004-PCB-".
 *
 * Used by the product form and by the reviewer's approval dialog, which both
 * have to preview the same code the server will build.
 */
export function codeLeaderOf(
  category: { codePrefix: string | null } | null | undefined,
  subcategory: { code: string | null } | null | undefined
): string | null {
  if (!category?.codePrefix) return null;
  const middle = subcategory?.code?.trim().toUpperCase();
  return middle ? `${category.codePrefix}-${middle}-` : `${category.codePrefix}-`;
}

/**
 * The typed part of an existing code — what goes back into the input when
 * somebody edits a product.
 *
 * It cannot be found by splitting on "-" and taking the rest, because the typed
 * part may itself contain hyphens (`1004-PCB-3W-CONTROL`). So the known leader
 * is stripped from the front instead, and anything that does not start with it
 * (a code from before this leader applied) is returned whole for the person to
 * correct.
 */
export function codeSuffixOf(code: string, leader: string | null): string {
  if (leader && code.startsWith(leader)) return code.slice(leader.length);
  // Fall back to the old two-part assumption for codes that predate a
  // subcategory being given one.
  const dash = code.indexOf("-");
  return dash === -1 ? code : code.slice(dash + 1);
}
