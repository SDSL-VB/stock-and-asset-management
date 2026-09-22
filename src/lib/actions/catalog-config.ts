"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/rbac/check";
import type { CatalogRules } from "@/lib/validations/product";

/**
 * How strict the catalog is.
 *
 * Called by: the product form and the catalog actions, to know what to require.
 * Nothing in the app changes the rules while the Configuration page is taken
 * out; they stay as stored in the `catalog_config` row.
 *
 * Three questions an admin answers once for everybody:
 *
 *   requireSubcategory      must a product be filed under one?
 *   requireSubcategoryCode  must a subcategory carry a code, which becomes the
 *                           middle segment of every product code under it?
 *   requireDescription      must a product say in words what it is?
 *
 * All three ship OFF. Turning one on against a catalog that has no
 * subcategories yet would reject every product form until somebody backfilled
 * the data, so the order is: add the subcategories, then tighten the rule.
 *
 * Reading is deliberately behind no config permission — every product form
 * needs the answer, and the people filling that form are not the people who set
 * it.
 */

/** The singleton row, created on first read if the migration's insert was lost. */
async function getCatalogConfig() {
  await requireAuth();

  return prisma.catalogConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

/**
 * Just the two booleans the product form and `catalogRuleErrors()` need.
 *
 * A separate function because most callers want the rules, not the row — and
 * because it keeps every caller from having to know the table exists.
 */
export async function getCatalogRules(): Promise<CatalogRules> {
  const config = await getCatalogConfig();
  return {
    requireSubcategory: config.requireSubcategory,
    requireDescription: config.requireDescription,
  };
}

