"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth, requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { catalogSettingsSchema, type CatalogRules } from "@/lib/validations/product";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";

/**
 * How strict the catalog is, and how its codes are shaped.
 *
 * Called by: the product and category forms, the catalog actions that enforce
 * the rules, and the Catalog settings dialog that changes them.
 *
 * Four questions an admin answers once for everybody:
 *
 *   requireSubcategory      must a product be filed under one?
 *   requireSubcategoryCode  must a subcategory carry a code, which becomes the
 *                           middle segment of every product code under it?
 *   requireDescription      must a product say in words what it is?
 *   categoryCodeLength      how long a category code may be — the code itself
 *                           is letters, digits or both, and always typed
 *
 * The three rules ship OFF. Turning one on against a catalog that has no
 * subcategories yet would reject every product form until somebody backfilled
 * the data, so the order is: add the subcategories, then tighten the rule.
 *
 * Reading is deliberately behind no config permission — every product form
 * needs the answer, and the people filling that form are not the people who set
 * it. Writing needs `config.catalog`.
 */

/** The singleton row, created on first read if the migration's insert was lost. */
async function getCatalogConfig() {
  return prisma.catalogConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

/**
 * The settings every catalog form needs.
 *
 * A separate function because most callers want the settings, not the row — and
 * because it keeps every caller from having to know the table exists.
 */
export async function getCatalogRules(): Promise<CatalogRules> {
  await requireAuth();
  const config = await getCatalogConfig();
  return {
    requireSubcategory: config.requireSubcategory,
    requireSubcategoryCode: config.requireSubcategoryCode,
    requireDescription: config.requireDescription,
    categoryCodeLength: config.categoryCodeLength,
  };
}

/**
 * Change the settings. Existing categories keep the codes they were given, so
 * shortening the length only applies to codes typed from now on — the same way
 * a product keeps its code when its category's prefix changes.
 */
export async function saveCatalogSettings(data: unknown) {
  await requirePermission(PERMISSIONS.CONFIG_CATALOG);

  const parsed = catalogSettingsSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const before = await getCatalogConfig();
  const next = parsed.data;
  await prisma.catalogConfig.update({ where: { id: "singleton" }, data: next });

  // Only what actually moved, so the log reads as a change and not a dump
  const changes: string[] = [];
  const said = (on: boolean) => (on ? "required" : "optional");
  if (before.requireSubcategory !== next.requireSubcategory) {
    changes.push(`a subcategory is now ${said(next.requireSubcategory)}`);
  }
  if (before.requireSubcategoryCode !== next.requireSubcategoryCode) {
    changes.push(`a subcategory code is now ${said(next.requireSubcategoryCode)}`);
  }
  if (before.requireDescription !== next.requireDescription) {
    changes.push(`a description is now ${said(next.requireDescription)}`);
  }
  if (before.categoryCodeLength !== next.categoryCodeLength) {
    changes.push(
      `category codes may be up to ${next.categoryCodeLength} characters (was ${before.categoryCodeLength})`
    );
  }
  if (changes.length > 0) {
    await logActivity("UPDATED", "CatalogConfig", "singleton", `Catalog settings: ${changes.join("; ")}`);
  }

  revalidatePath("/stock/products");
  return { success: true };
}
