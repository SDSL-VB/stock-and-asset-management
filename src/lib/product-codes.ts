import type { Prisma } from "@prisma/client";

/**
 * A product code has two halves. The category owns the first — a fixed 4-digit
 * prefix — and a person types the second:
 *
 *   Electronics (1001) + "TV55"  →  1001-TV55
 *
 * The prefix half is never entered by hand. Every form that asks for a code
 * shows it locked in front of the input, so the category is always legible in
 * the code itself. Prefixes are auto-assigned when a category is created
 * (1001, 1002, …) and can only be changed with categories.prefix.edit.
 *
 * The pure helpers at the top are safe to import from client components; the
 * prefix allocator below takes a transaction client and runs server-side.
 */

/** First prefix handed out when no category has one yet */
export const FIRST_CODE_PREFIX = 1001;
/** A prefix is exactly four digits */
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

/**
 * Lowest unused 4-digit prefix, starting at 1001. Callers should run this
 * inside the same transaction as the insert that consumes it; the unique index
 * on codePrefix is the final guard against a concurrent duplicate.
 */
export async function nextFreeCodePrefix(
  tx: Prisma.TransactionClient
): Promise<string> {
  const categories = await tx.productCategory.findMany({
    where: { codePrefix: { not: null } },
    select: { codePrefix: true },
  });

  const highest = categories.reduce((max, c) => {
    const value = Number(c.codePrefix);
    return Number.isFinite(value) && value > max ? value : max;
  }, FIRST_CODE_PREFIX - 1);

  return String(highest + 1);
}

/**
 * Ensures a category has a prefix, assigning the next free one if it predates
 * prefixes. Returns it ready to sit in front of a typed suffix.
 */
export async function ensureCodePrefix(
  tx: Prisma.TransactionClient,
  categoryId: string
): Promise<string> {
  const category = await tx.productCategory.findUnique({
    where: { id: categoryId },
    select: { codePrefix: true },
  });
  if (!category) throw new Error("Category not found");
  if (category.codePrefix) return category.codePrefix;

  const prefix = await nextFreeCodePrefix(tx);
  await tx.productCategory.update({
    where: { id: categoryId },
    data: { codePrefix: prefix },
  });
  return prefix;
}
