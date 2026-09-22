"use server";

import { prisma } from "@/lib/prisma";
import {
  requirePermission,
  requireAnyPermission,
  requireAuth,
  hasPermission,
} from "@/lib/rbac/check";
import { PERMISSIONS, PRODUCT_MANAGE_PERMISSIONS } from "@/lib/rbac/permissions";
import {
  createProductSchema,
  updateProductSchema,
  createProductCategorySchema,
  newCategorySchema,
  categoryPrefixSchema,
  subcategorySchema,
  updateSubcategorySchema,
  catalogRuleErrors,
} from "@/lib/validations/product";
import {
  composeProductCode,
  CODE_PREFIX_PATTERN,
  CODE_SUFFIX_PATTERN,
} from "@/lib/product-codes";
import { getCatalogRules } from "./catalog-config";
import {
  createProductRequestSchema,
  approveProductRequestSchema,
  rejectRequestSchema,
} from "@/lib/validations/request";
import { archive } from "@/lib/recycle-bin";
import { labelOfKind, isMadeKind } from "@/lib/vocabulary";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";
import { catalogDecided, catalogRequested } from "@/lib/notifications/events";

/**
 * The catalog: raw materials we buy, products we make, and the categories both
 * live in — plus the queue of things people have asked to be added.
 *
 * Called by: the Catalog page, and the product search on the stock entry form.
 *
 * The catalog is two levels. A category (Electronics, 1004) holds
 * subcategories (PCB, Resistor), and a product is filed under one of each:
 *
 *   Electronics → PCB → 3W_CONTROL_BOARD   "BLDC Control board"
 *
 * Three rules live here.
 *
 * A product CODE is assembled by the server, never posted by the browser. The
 * category contributes its fixed prefix, the subcategory contributes its code
 * if it has one, and a person types only the last part — so a submission cannot
 * claim a category or subcategory it does not belong to. See
 * `src/lib/product-codes.ts` for the composition itself.
 *
 * Whether a subcategory and a description are REQUIRED is configuration, not a
 * constant: `getCatalogRules()` reads it and `catalogRuleErrors()` applies it,
 * so the form and the server enforce one definition.
 *
 * Adding a raw material is a different grant from adding something we make,
 * because only the second needs a bill of materials to mean anything.
 */

/**
 * Turn a posted subcategory id into the row, having checked it belongs to the
 * category the product is being filed under.
 *
 * Both halves matter. Re-reading it means the CODE that goes into the product
 * code comes from the database rather than the browser. Checking the parent
 * means a subcategory cannot be borrowed across categories, which would file a
 * PCB under Mechanical and put "PCB" in the middle of a 1002- code.
 *
 * Returns `{ value: null }` for "none chosen", which is a valid answer unless
 * the catalog rules say otherwise — that check lives in `catalogRuleErrors()`,
 * not here.
 */
async function resolveSubcategory(
  subcategoryId: string | undefined,
  categoryId: string
): Promise<{ value: { id: string; code: string | null } | null } | { error: string }> {
  if (!subcategoryId) return { value: null };

  const subcategory = await prisma.productSubcategory.findUnique({
    where: { id: subcategoryId },
    select: { id: true, code: true, name: true, categoryId: true, isActive: true },
  });
  if (!subcategory) return { error: "Subcategory not found" };
  if (subcategory.categoryId !== categoryId) {
    return { error: `"${subcategory.name}" belongs to a different category` };
  }
  if (!subcategory.isActive) {
    return { error: `"${subcategory.name}" is no longer in use` };
  }
  return { value: { id: subcategory.id, code: subcategory.code } };
}

// ---------- Read (operators + admins) ----------

export async function getProductCategories() {
  await requireAnyPermission([PERMISSIONS.PRODUCTS_VIEW, ...PRODUCT_MANAGE_PERMISSIONS]);

  return prisma.productCategory.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      codePrefix: true,
      nextSequence: true,
      // The product form needs these to narrow its second dropdown and to
      // preview the code, so they come down with the category rather than
      // costing a second round trip when one is chosen.
      subcategories: {
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true },
      },
    },
  });
}

/**
 * Every active product, light enough to search in the browser — the pickers
 * on a delivery's lines, where several items from different categories are
 * chosen one after another and a round trip per keystroke would drag.
 */
export async function getProductOptions() {
  await requireAnyPermission([PERMISSIONS.PRODUCTS_VIEW, ...PRODUCT_MANAGE_PERMISSIONS]);
  return prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      unit: true,
      description: true,
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
}

// Search active products by name (or code) within a category — powers the
// autocomplete in the stock entry form.
export async function searchProducts(query: string, categoryId?: string) {
  await requireAnyPermission([PERMISSIONS.PRODUCTS_VIEW, ...PRODUCT_MANAGE_PERMISSIONS]);

  const q = query.trim();
  if (q.length < 1) return [];

  return prisma.product.findMany({
    where: {
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        // "control board" finds 3W_CONTROL_BOARD even when nobody remembers
        // how the name was punctuated.
        { description: { contains: q, mode: "insensitive" } },
        { subcategory: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      category: { select: { id: true, name: true } },
      subcategory: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
    take: 15,
  });
}

// ---------- Manage (granular per-action permissions) ----------

export async function getProductsForManagement() {
  await requireAnyPermission(PRODUCT_MANAGE_PERMISSIONS);

  return prisma.product.findMany({
    include: {
      category: { select: { id: true, name: true } },
      subcategory: { select: { id: true, name: true, code: true } },
      // billsOfMaterials tells the Products tab which ones still need a recipe
      _count: { select: { stockEntries: true, billsOfMaterials: true } },
    },
    orderBy: [
      { category: { name: "asc" } },
      { subcategory: { name: "asc" } },
      { name: "asc" },
    ],
  });
}

export async function getAllProductCategories() {
  await requireAnyPermission(PRODUCT_MANAGE_PERMISSIONS);

  return prisma.productCategory.findMany({
    include: {
      _count: { select: { products: true } },
      subcategories: {
        orderBy: { name: "asc" },
        include: { _count: { select: { products: true } } },
      },
    },
    orderBy: { name: "asc" },
  });
}

/**
 * Adds a catalog entry.
 *
 * Which permission is required depends on what is being added: a raw material
 * is something we buy, a finished or complete product is something we make, and
 * the two are handed out separately.
 */
export async function createProduct(data: unknown) {
  const parsed = createProductSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const kind = parsed.data.kind ?? "RAW";
  await requirePermission(
    // Bought (raw materials, ready goods) and made are separate grants
    isMadeKind(kind) ? PERMISSIONS.PRODUCTS_CREATE_MADE : PERMISSIONS.PRODUCTS_CREATE
  );

  const category = await prisma.productCategory.findUnique({
    where: { id: parsed.data.categoryId },
    include: { subcategories: { where: { isActive: true }, select: { id: true } } },
  });
  if (!category) return { error: "Category not found" };
  // Category codes are typed by people and never generated, so a category
  // without one cannot hand out a product code. Only categories that predate
  // codes can be in this state.
  const categoryCode = category.codePrefix;
  if (!categoryCode) {
    return {
      error: `"${category.name}" has no category code yet. Set one on the category first.`,
    };
  }

  // The subcategory is re-read rather than trusted, for the same reason the
  // category is: its CODE goes into the product code, and a posted one could
  // claim a segment it has no right to. Checking it belongs to the chosen
  // category also stops a PCB product being filed under Mechanical.
  const subcategory = await resolveSubcategory(parsed.data.subcategoryId, category.id);
  if ("error" in subcategory) return { error: subcategory.error };

  // What the admin decided everybody must supply — read here, not assumed, so
  // the rule and the form's copy of it come from one place.
  const ruleError = catalogRuleErrors(
    parsed.data,
    await getCatalogRules(),
    category.subcategories.length > 0
  );
  if (ruleError) return { error: ruleError };

  // A product code is the category's code, the subcategory's if it has one, and
  // the part the user typed. Only the last comes from the client.
  const product = await prisma.$transaction(async (tx) => {
    const code = composeProductCode(
      categoryCode,
      subcategory.value?.code,
      parsed.data.codeSuffix
    );

    const existing = await tx.product.findUnique({ where: { code } });
    if (existing) {
      throw new Error(`DUPLICATE:${code}:${existing.name}`);
    }

    return tx.product.create({
      data: {
        code,
        name: parsed.data.name.trim(),
        description: parsed.data.description?.trim() || null,
        categoryId: parsed.data.categoryId,
        subcategoryId: subcategory.value?.id ?? null,
        kind,
        unit: parsed.data.unit?.trim() || "pcs",
      },
    });
  }).catch((e: Error) => {
    if (e.message.startsWith("DUPLICATE:")) {
      const [, code, name] = e.message.split(":");
      return { duplicate: `Product code ${code} already exists (${name})` };
    }
    throw e;
  });

  if ("duplicate" in product) return { error: product.duplicate };

  await logActivity(
    "CREATED",
    "Product",
    product.id,
    `Created ${labelOfKind(kind).toLowerCase()} ${product.code} — ${product.name}`
  );

  revalidatePath("/stock/products");
  revalidatePath("/bom");
  return { success: true, product };
}

export async function updateProduct(id: string, data: unknown) {
  const currentUser = await requirePermission(PERMISSIONS.PRODUCTS_EDIT);

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return { error: "Product not found" };

  const parsed = updateProductSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Codes are permanent identifiers: only products.code.override may change
  // one. The prefix still comes from the category, never from the client.
  const canOverrideCode = currentUser.permissions.includes(
    PERMISSIONS.PRODUCTS_CODE_OVERRIDE
  );

  const category = await prisma.productCategory.findUnique({
    where: { id: parsed.data.categoryId },
    select: {
      codePrefix: true,
      subcategories: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!category) return { error: "Category not found" };

  const subcategory = await resolveSubcategory(parsed.data.subcategoryId, parsed.data.categoryId);
  if ("error" in subcategory) return { error: subcategory.error };

  const ruleError = catalogRuleErrors(
    parsed.data,
    await getCatalogRules(),
    category.subcategories.length > 0
  );
  if (ruleError) return { error: ruleError };

  // Moving a product to a subcategory with a different code would change its
  // code — and a code is an identifier that stock entries have already
  // snapshotted as `itemCode`. So the code only ever moves when somebody
  // holding products.code.override asks for it, and otherwise the product keeps
  // the code it was issued even if its filing changes underneath.
  let code = product.code;
  if (canOverrideCode && parsed.data.codeSuffix?.trim()) {
    if (!category.codePrefix) return { error: "That category has no code prefix" };
    code = composeProductCode(
      category.codePrefix,
      subcategory.value?.code,
      parsed.data.codeSuffix
    );
  }

  const duplicate = await prisma.product.findFirst({
    where: { code, id: { not: id } },
  });
  if (duplicate) {
    return { error: `Product code ${code} already exists (${duplicate.name})` };
  }

  // Changing what something *is* moves it between the catalog's two tabs, so it
  // needs the grant for whichever side it is becoming.
  const nextKind = parsed.data.kind ?? product.kind;
  if (nextKind !== product.kind) {
    const needed =
      isMadeKind(nextKind) ? PERMISSIONS.PRODUCTS_CREATE_MADE : PERMISSIONS.PRODUCTS_CREATE;
    if (!currentUser.permissions.includes(needed)) {
      return {
        error: `Changing ${product.code} into a ${labelOfKind(nextKind).toLowerCase()} needs a separate permission.`,
      };
    }
    // Something with a bill of materials is made here; calling it bought would
    // leave a recipe nobody can build from.
    if (!isMadeKind(nextKind) && (await prisma.billOfMaterials.count({ where: { productId: id } })) > 0) {
      return { error: `${product.code} has a bill of materials, so it is made here and cannot be marked as bought.` };
    }
  }

  const updated = await prisma.product.update({
    where: { id },
    data: {
      code,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() || null,
      categoryId: parsed.data.categoryId,
      subcategoryId: subcategory.value?.id ?? null,
      kind: nextKind,
      ...(parsed.data.unit?.trim() ? { unit: parsed.data.unit.trim() } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
  });

  await logActivity(
    "UPDATED",
    "Product",
    updated.id,
    nextKind !== product.kind
      ? `Updated ${updated.code} — ${updated.name}, now a ${labelOfKind(nextKind).toLowerCase()}`
      : `Updated ${labelOfKind(nextKind).toLowerCase()} ${updated.code} — ${updated.name}`
  );

  revalidatePath("/stock/products");
  revalidatePath("/bom");
  return { success: true, product: updated };
}

export async function toggleProductActive(id: string) {
  await requirePermission(PERMISSIONS.PRODUCTS_EDIT);

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return { error: "Product not found" };

  const updated = await prisma.product.update({
    where: { id },
    data: { isActive: !product.isActive },
  });

  await logActivity(
    "UPDATED",
    "Product",
    id,
    `${updated.isActive ? "Activated" : "Deactivated"} product ${updated.code}`
  );

  revalidatePath("/stock/products");
  return { success: true, product: updated };
}

/**
 * A new category, and any subcategories typed in the same form. Both are
 * created together or not at all, so a rejected subcategory never leaves a
 * half-made category behind. Subcategories follow the same rules as adding
 * one later (createSubcategory): names unique within the category, a code only
 * with `categories.prefix.edit`, and a code required if the catalog says so.
 */
export async function createProductCategory(data: unknown) {
  const user = await requirePermission(PERMISSIONS.CATEGORIES_CREATE);

  const parsed = newCategorySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const name = parsed.data.name.trim();
  const { codePrefix } = parsed.data;

  // A code posted without the grant is dropped, as in createSubcategory
  const maySetCode = user.permissions.includes(PERMISSIONS.CATEGORIES_PREFIX_EDIT);
  const subcategories = parsed.data.subcategories.map((sub) => ({
    name: sub.name,
    code: maySetCode ? sub.code ?? null : null,
  }));
  const seenNames = new Set<string>();
  const seenCodes = new Set<string>();
  for (const sub of subcategories) {
    const key = sub.name.toLowerCase();
    if (seenNames.has(key)) return { error: `"${sub.name}" is listed twice` };
    seenNames.add(key);
    if (sub.code) {
      if (seenCodes.has(sub.code)) return { error: `Code ${sub.code} is used twice` };
      seenCodes.add(sub.code);
    }
  }
  if (subcategories.length > 0) {
    const { requireSubcategoryCode } = await prisma.catalogConfig.upsert({
      where: { id: "singleton" },
      update: {},
      create: { id: "singleton" },
    });
    if (requireSubcategoryCode && subcategories.some((sub) => !sub.code)) {
      return {
        error: maySetCode
          ? "This catalog requires every subcategory to have a code"
          : "This catalog requires a subcategory code, and setting one needs the category code permission",
      };
    }
  }

  const existing = await prisma.productCategory.findUnique({ where: { name } });
  if (existing) return { error: `Category "${name}" already exists` };

  // Whoever creates the category chooses its code, so the only thing that can
  // go wrong is picking one already in use. There is no retry loop any more:
  // nothing is being allocated, so there is nothing to retry with.
  const clash = await prisma.productCategory.findUnique({ where: { codePrefix } });
  if (clash) {
    return { error: `Code ${codePrefix} is already used by "${clash.name}"` };
  }

  const category = await prisma.productCategory.create({
    data: { name, codePrefix, subcategories: { create: subcategories } },
  });

  await logActivity(
    "CREATED",
    "ProductCategory",
    category.id,
    `Created product category ${name} (code prefix ${category.codePrefix})` +
      (subcategories.length
        ? ` with subcategories ${subcategories.map((sub) => (sub.code ? `${sub.name} (${sub.code})` : sub.name)).join(", ")}`
        : "")
  );

  revalidatePath("/stock/products");
  return { success: true, category };
}

/**
 * Changes the fixed code prefix a category hands out. Applies to codes
 * generated from now on — products already created keep the code they were
 * given, since codes appear in stock history, exports, and printed labels.
 */
/* ---------- subcategories ------------------------------------------------ */

/**
 * Adding, renaming and retiring the second level of the catalog.
 *
 * These reuse the CATEGORY permissions rather than having their own. A
 * subcategory is the category tree, one level down, and a grant that let
 * somebody add "PCB" but not "Electronics" would be a distinction nobody in the
 * business actually wants to make. The subcategory's CODE follows the same
 * logic and is guarded by `categories.prefix.edit`, because it is a code
 * segment exactly as a category's prefix is.
 */
export async function createSubcategory(data: unknown) {
  const user = await requirePermission(PERMISSIONS.CATEGORIES_CREATE);

  const parsed = subcategorySchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { categoryId, name, code } = parsed.data;

  // Setting a code is its own grant, so a code posted without it is dropped
  // rather than refused — the subcategory is still worth creating.
  const maySetCode = user.permissions.includes(PERMISSIONS.CATEGORIES_PREFIX_EDIT);
  const wantedCode = maySetCode ? code ?? null : null;

  const category = await prisma.productCategory.findUnique({
    where: { id: categoryId },
    select: { name: true },
  });
  if (!category) return { error: "Category not found" };

  const { requireSubcategoryCode } = await prisma.catalogConfig.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
  if (requireSubcategoryCode && !wantedCode) {
    return {
      error: maySetCode
        ? "This catalog requires every subcategory to have a code"
        : "This catalog requires a code, and setting one needs the category code permission",
    };
  }

  const clashingName = await prisma.productSubcategory.findFirst({
    where: { categoryId, name },
  });
  if (clashingName) {
    return { error: `"${name}" already exists under ${category.name}` };
  }

  if (wantedCode) {
    const clashingCode = await prisma.productSubcategory.findFirst({
      where: { categoryId, code: wantedCode },
    });
    if (clashingCode) {
      return {
        error: `Code ${wantedCode} is already used by "${clashingCode.name}" in ${category.name}`,
      };
    }
  }

  const subcategory = await prisma.productSubcategory.create({
    data: { categoryId, name, code: wantedCode },
  });

  await logActivity(
    "CREATED",
    "ProductSubcategory",
    subcategory.id,
    `Added subcategory ${name}${wantedCode ? ` (${wantedCode})` : ""} under ${category.name}`
  );

  revalidatePath("/stock/products");
  return { success: true, subcategory };
}

export async function updateSubcategory(id: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.CATEGORIES_EDIT);

  const parsed = updateSubcategorySchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const existing = await prisma.productSubcategory.findUnique({
    where: { id },
    select: { id: true, categoryId: true, code: true, _count: { select: { products: true } } },
  });
  if (!existing) return { error: "Subcategory not found" };

  const { name, code, isActive } = parsed.data;
  const maySetCode = user.permissions.includes(PERMISSIONS.CATEGORIES_PREFIX_EDIT);
  // Without the grant the existing code is kept, never blanked by omission.
  const nextCode = maySetCode ? code ?? null : existing.code;

  // A subcategory's code is part of every product code beneath it, and those
  // codes are already snapshotted onto stock entries as `itemCode`. Changing it
  // would leave the catalog and the history disagreeing about what 1004-PCB-X
  // is, so it is refused once anything is filed here. Retire it and make a new
  // one instead — the same answer the app gives for a product code.
  if (nextCode !== existing.code && existing._count.products > 0) {
    return {
      error: `${existing._count.products} product${existing._count.products === 1 ? " is" : "s are"} filed under this subcategory, so its code is fixed. Retire it and add a new one instead.`,
    };
  }

  const clashingName = await prisma.productSubcategory.findFirst({
    where: { categoryId: existing.categoryId, name, id: { not: id } },
  });
  if (clashingName) return { error: `"${name}" already exists in this category` };

  if (nextCode) {
    const clashingCode = await prisma.productSubcategory.findFirst({
      where: { categoryId: existing.categoryId, code: nextCode, id: { not: id } },
    });
    if (clashingCode) {
      return { error: `Code ${nextCode} is already used by "${clashingCode.name}"` };
    }
  }

  const updated = await prisma.productSubcategory.update({
    where: { id },
    data: {
      name,
      code: nextCode,
      ...(isActive !== undefined ? { isActive } : {}),
    },
  });

  await logActivity(
    "UPDATED",
    "ProductSubcategory",
    id,
    `Updated subcategory ${updated.name}${updated.code ? ` (${updated.code})` : ""}`
  );

  revalidatePath("/stock/products");
  return { success: true, subcategory: updated };
}

/**
 * Retiring a subcategory, which is offered instead of deleting.
 *
 * An inactive subcategory disappears from the product form and keeps every
 * product already filed under it, along with their codes. Deleting one that
 * still has products is refused by the database itself (ON DELETE RESTRICT), so
 * there is no way to lose a product by tidying the catalog.
 */
export async function toggleSubcategoryActive(id: string) {
  await requirePermission(PERMISSIONS.CATEGORIES_EDIT);

  const subcategory = await prisma.productSubcategory.findUnique({ where: { id } });
  if (!subcategory) return { error: "Subcategory not found" };

  const updated = await prisma.productSubcategory.update({
    where: { id },
    data: { isActive: !subcategory.isActive },
  });

  await logActivity(
    updated.isActive ? "ACTIVATED" : "DEACTIVATED",
    "ProductSubcategory",
    id,
    `${updated.isActive ? "Restored" : "Retired"} subcategory ${updated.name}`
  );

  revalidatePath("/stock/products");
  return { success: true, isActive: updated.isActive };
}

export async function deleteSubcategory(id: string) {
  await requirePermission(PERMISSIONS.CATEGORIES_DELETE);

  const subcategory = await prisma.productSubcategory.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });
  if (!subcategory) return { error: "Subcategory not found" };

  if (subcategory._count.products > 0) {
    return {
      error: `"${subcategory.name}" still has ${subcategory._count.products} product${subcategory._count.products === 1 ? "" : "s"}. Retire it instead, which keeps them and their codes.`,
    };
  }

  await prisma.productSubcategory.delete({ where: { id } });

  await logActivity(
    "DELETED",
    "ProductSubcategory",
    id,
    `Deleted empty subcategory ${subcategory.name}`
  );

  revalidatePath("/stock/products");
  return { success: true };
}

export async function updateCategoryPrefix(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.CATEGORIES_PREFIX_EDIT);

  const category = await prisma.productCategory.findUnique({ where: { id } });
  if (!category) return { error: "Category not found" };

  const parsed = categoryPrefixSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { codePrefix } = parsed.data;

  const duplicate = await prisma.productCategory.findFirst({
    where: { codePrefix, id: { not: id } },
  });
  if (duplicate) {
    return { error: `Prefix ${codePrefix} is already used by "${duplicate.name}"` };
  }

  const updated = await prisma.productCategory.update({
    where: { id },
    data: { codePrefix },
  });

  await logActivity(
    "UPDATED",
    "ProductCategory",
    id,
    `Changed the code prefix for ${updated.name} from ${category.codePrefix ?? "none"} to ${codePrefix}`
  );

  revalidatePath("/stock/products");
  return { success: true, category: updated };
}

export async function updateProductCategory(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.CATEGORIES_EDIT);

  const category = await prisma.productCategory.findUnique({ where: { id } });
  if (!category) return { error: "Category not found" };

  const parsed = createProductCategorySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const name = parsed.data.name.trim();
  const duplicate = await prisma.productCategory.findFirst({
    where: { name, id: { not: id } },
  });
  if (duplicate) return { error: `Category "${name}" already exists` };

  const updated = await prisma.productCategory.update({ where: { id }, data: { name } });

  await logActivity("UPDATED", "ProductCategory", id, `Renamed product category to ${name}`);

  revalidatePath("/stock/products");
  return { success: true, category: updated };
}

/**
 * Removes a product outright.
 *
 * Deleting is offered but never made easy: unless the caller insists with
 * { force: true }, this reports what would be destroyed and recommends
 * deactivating instead, which hides the product from new entries while every
 * past record stays intact.
 *
 * Being a component of somebody's bill of materials is the one hard block —
 * deleting would silently change a recipe that other people build to.
 */
export async function deleteProduct(id: string, options: { force?: boolean } = {}) {
  const user = await requirePermission(PERMISSIONS.PRODUCTS_DELETE);

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          stockEntries: true,
          usedInBomLines: true,
          billsOfMaterials: true,
          builds: true,
        },
      },
    },
  });
  if (!product) return { error: "Product not found" };

  const c = product._count;

  if (c.usedInBomLines > 0) {
    return {
      blocked: true,
      error: `${product.code} is a component of ${c.usedInBomLines} bill${c.usedInBomLines === 1 ? "" : "s"} of materials. Deleting it would silently change what those products are made of — remove it from them first, or deactivate it instead.`,
    };
  }
  if (c.builds > 0) {
    return {
      blocked: true,
      error: `${product.code} has been built ${c.builds} time${c.builds === 1 ? "" : "s"}. Deleting it would leave those builds unable to say what they produced.`,
    };
  }

  if (!options.force && (c.stockEntries > 0 || c.billsOfMaterials > 0)) {
    const parts = [
      c.stockEntries > 0 && `${c.stockEntries} stock entr${c.stockEntries === 1 ? "y" : "ies"}`,
      c.billsOfMaterials > 0 &&
        `${c.billsOfMaterials} bill${c.billsOfMaterials === 1 ? "" : "s"} of materials`,
    ].filter(Boolean);

    return {
      needsConfirmation: true,
      message: `${product.code} ${product.name} is referenced by ${parts.join(" and ")}.`,
      recommendation:
        "Deactivating hides it from new entries and searches while every past record keeps its code and name.",
    };
  }

  let recycleId = "";
  await prisma.$transaction(async (tx) => {
    // Entries snapshot the code and name, so unlinking loses nothing readable —
    // but which entries were unlinked is recorded, so restoring re-points them
    const affected = await tx.stockEntry.findMany({
      where: { productId: id },
      select: { id: true },
    });

    const { _count, ...snapshot } = product;
    recycleId = await archive(tx, {
      entity: "Product",
      entityId: id,
      label: `${product.code} ${product.name}`,
      snapshot,
      relinks: [{ table: "StockEntry", field: "productId", ids: affected.map((e) => e.id) }],
      deletedById: user.id,
    });

    await tx.stockEntry.updateMany({ where: { productId: id }, data: { productId: null } });
    await tx.product.delete({ where: { id } });
  });

  await logActivity("DELETED", "Product", id, `Deleted product ${product.code} ${product.name}`);

  revalidatePath("/stock/products");
  revalidatePath("/bom");
  revalidatePath("/recycle-bin");
  return { success: true, recycleId };
}

/** Removes a category. Blocked while any product still belongs to it. */
export async function deleteProductCategory(id: string, options: { force?: boolean } = {}) {
  const user = await requirePermission(PERMISSIONS.CATEGORIES_DELETE);

  const category = await prisma.productCategory.findUnique({
    where: { id },
    include: { _count: { select: { products: true } } },
  });
  if (!category) return { error: "Category not found" };

  if (category._count.products > 0) {
    return {
      blocked: true,
      error: `${category.name} still holds ${category._count.products} product${category._count.products === 1 ? "" : "s"}, and a product cannot exist without a category. Move or delete them first, or deactivate the category instead.`,
    };
  }

  if (!options.force) {
    return {
      needsConfirmation: true,
      message: `This permanently removes the category ${category.name}${category.codePrefix ? ` and frees its code prefix ${category.codePrefix}` : ""}.`,
      recommendation:
        "Deactivating hides it from the new-product form while keeping its prefix reserved, so no future product ever reuses those codes.",
    };
  }

  let recycleId = "";
  await prisma.$transaction(async (tx) => {
    const { _count, ...snapshot } = category;
    recycleId = await archive(tx, {
      entity: "ProductCategory",
      entityId: id,
      label: category.name,
      snapshot,
      deletedById: user.id,
    });
    await tx.productCategory.delete({ where: { id } });
  });

  await logActivity("DELETED", "ProductCategory", id, `Deleted category ${category.name}`);

  revalidatePath("/stock/products");
  revalidatePath("/recycle-bin");
  return { success: true, recycleId };
}

/* ========================================================================= */
/* Requests — asking for a product or category you cannot add yourself       */
/* ========================================================================= */

/**
 * FLOW: catalog request — someone who may not change the catalog asks for
 * something to be added, and whoever may add it reviews the ask.
 *
 *   1. createProductRequest    an operator or engineer asks, with a note
 *   2. approveProductRequest   a reviewer types the second half of the code and
 *                              the product IS created by the approval
 *      rejectProductRequest    or declines, with a reason
 *
 * Someone holding products.create sees "Create" and never lands here.
 */

export async function createProductRequest(data: unknown) {
  const user = await requireAuth();

  const parsed = createProductRequestSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { type, name, categoryId, subcategoryId, description, notes } = parsed.data;

  // Product and category requests are separately permissioned
  const neededPermission =
    type === "PRODUCT"
      ? PERMISSIONS.PRODUCTS_REQUEST_CREATE
      : PERMISSIONS.CATEGORIES_REQUEST_CREATE;
  if (!hasPermission(user.permissions, neededPermission)) {
    return {
      error: `You do not have permission to request new ${type === "PRODUCT" ? "products" : "categories"}`,
    };
  }

  if (type === "PRODUCT" && categoryId) {
    const category = await prisma.productCategory.findUnique({ where: { id: categoryId } });
    if (!category) return { error: "Category not found" };
  }

  if (type === "CATEGORY") {
    const existing = await prisma.productCategory.findUnique({ where: { name: name.trim() } });
    if (existing) return { error: `Category "${name.trim()}" already exists` };
  }

  // A suggestion, not a decision: it is kept only when it really belongs to the
  // category asked for, so a stale dropdown cannot file the request nonsensically.
  let suggestedSubcategoryId: string | null = null;
  if (type === "PRODUCT" && subcategoryId && categoryId) {
    const suggestion = await resolveSubcategory(subcategoryId, categoryId);
    if (!("error" in suggestion)) suggestedSubcategoryId = suggestion.value?.id ?? null;
  }

  const request = await prisma.productRequest.create({
    data: {
      type,
      name: name.trim(),
      categoryId: type === "PRODUCT" ? categoryId : null,
      subcategoryId: suggestedSubcategoryId,
      description: type === "PRODUCT" ? description?.trim() || null : null,
      notes: notes?.trim() || null,
      requestedById: user.id,
    },
  });

  await logActivity(
    "REQUESTED",
    "ProductRequest",
    request.id,
    `Requested new ${type === "PRODUCT" ? "product" : "category"}: ${request.name}`
  );

  await catalogRequested({ name: request.name, type: request.type, requestedById: user.id });
  return { success: true, request };
}

export async function getProductRequests() {
  const user = await requireAuth();

  const canApproveProducts = hasPermission(user.permissions, PERMISSIONS.PRODUCTS_REQUEST_APPROVE);
  const canApproveCategories = hasPermission(user.permissions, PERMISSIONS.CATEGORIES_REQUEST_APPROVE);
  // Approvers see every request of the types they can approve; everyone else
  // sees only their own requests
  const where =
    canApproveProducts && canApproveCategories
      ? {}
      : {
          OR: [
            { requestedById: user.id },
            ...(canApproveProducts ? [{ type: "PRODUCT" as const }] : []),
            ...(canApproveCategories ? [{ type: "CATEGORY" as const }] : []),
          ],
        };

  return prisma.productRequest.findMany({
    where,
    include: {
      category: { select: { id: true, name: true } },
      subcategory: { select: { id: true, name: true, code: true } },
      requestedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

// Approving a PRODUCT request creates the product (admin supplies the final
// code); approving a CATEGORY request creates the category.
export async function approveProductRequest(id: string, data: unknown) {
  const user = await requireAuth();

  const request = await prisma.productRequest.findUnique({ where: { id } });
  if (!request) return { error: "Request not found" };
  if (request.status !== "PENDING") return { error: "This request has already been processed" };
  // Somebody else decides what gets added on your request
  if (request.requestedById === user.id) return { error: "You asked for this, so someone else has to review it" };

  const neededPermission =
    request.type === "PRODUCT"
      ? PERMISSIONS.PRODUCTS_REQUEST_APPROVE
      : PERMISSIONS.CATEGORIES_REQUEST_APPROVE;
  if (!hasPermission(user.permissions, neededPermission)) {
    return {
      error: `You do not have permission to approve ${request.type === "PRODUCT" ? "product" : "category"} requests`,
    };
  }

  const parsed = approveProductRequestSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const name = parsed.data.name.trim();

  if (request.type === "CATEGORY") {
    const existing = await prisma.productCategory.findUnique({ where: { name } });
    if (existing) return { error: `Category "${name}" already exists` };

    // The requester asked for a name; the code is the reviewer's to choose,
    // because they are the one who knows the numbering scheme.
    const codePrefix = parsed.data.codePrefix?.trim();
    if (!codePrefix || !CODE_PREFIX_PATTERN.test(codePrefix)) {
      return { error: "Enter a 4-digit code for the new category (e.g. 1001)" };
    }
    const clash = await prisma.productCategory.findUnique({ where: { codePrefix } });
    if (clash) {
      return { error: `Code ${codePrefix} is already used by "${clash.name}"` };
    }

    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.productCategory.create({ data: { name, codePrefix } });
      await tx.productRequest.update({
        where: { id },
        data: {
          status: "APPROVED",
          reviewedById: user.id,
          reviewNote: parsed.data.reviewNote?.trim() || null,
        },
      });
      return created;
    });

    await logActivity(
      "APPROVED",
      "ProductRequest",
      id,
      `Approved category request — created "${category.name}" (code prefix ${category.codePrefix})`
    );

    await catalogDecided({ name: request.name, requestedById: request.requestedById }, true);
    revalidatePath("/stock/products");
    return { success: true };
  }

  // PRODUCT request — always a RAW material. An operator asks for something we
  // *buy*; adding something we *make* is a separate act behind its own key,
  // because only that one needs a bill of materials to mean anything.
  //
  // The code comes from the category's prefix, so approving no longer requires
  // typing one. A reviewer holding products.code.override may supply their own.
  const categoryId = parsed.data.categoryId ?? request.categoryId;
  if (!categoryId) return { error: "Please select a category" };

  const category = await prisma.productCategory.findUnique({ where: { id: categoryId } });
  if (!category) return { error: "Category not found" };

  // The reviewer types the second half; the prefix comes from the category.
  const suffix = parsed.data.code?.trim();
  if (!suffix) {
    return { error: "Enter the rest of the product code" };
  }
  if (!CODE_SUFFIX_PATTERN.test(suffix)) {
    return { error: "Use letters, numbers, hyphens and underscores for the code" };
  }

  const approvalCategory = await prisma.productCategory.findUnique({
    where: { id: categoryId },
    select: { name: true, codePrefix: true },
  });
  if (!approvalCategory) return { error: "Category not found" };
  if (!approvalCategory.codePrefix) {
    return {
      error: `"${approvalCategory.name}" has no category code yet. Set one on the category first.`,
    };
  }
  const approvalPrefix = approvalCategory.codePrefix;

  // The reviewer's choice wins over the asker's suggestion; falling back to it
  // means a reviewer who agrees does not have to re-pick what was already said.
  const subcategory = await resolveSubcategory(
    parsed.data.subcategoryId ?? request.subcategoryId ?? undefined,
    categoryId
  );
  if ("error" in subcategory) return { error: subcategory.error };

  const description = parsed.data.description?.trim() || request.description?.trim() || null;

  const available = await prisma.productSubcategory.count({
    where: { categoryId, isActive: true },
  });
  const ruleError = catalogRuleErrors(
    { subcategoryId: subcategory.value?.id, description },
    await getCatalogRules(),
    available > 0
  );
  if (ruleError) return { error: ruleError };

  const product = await prisma.$transaction(async (tx) => {
    const code = composeProductCode(approvalPrefix, subcategory.value?.code, suffix);

    const duplicate = await tx.product.findUnique({ where: { code } });
    if (duplicate) {
      throw new Error(`DUPLICATE:${code}:${duplicate.name}`);
    }

    const created = await tx.product.create({
      data: {
        code,
        name,
        description,
        categoryId,
        subcategoryId: subcategory.value?.id ?? null,
        kind: "RAW",
      },
    });
    await tx.productRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedById: user.id,
        reviewNote: parsed.data.reviewNote?.trim() || null,
      },
    });
    return created;
  }).catch((e: Error) => {
    if (e.message.startsWith("DUPLICATE:")) {
      const [, code, existing] = e.message.split(":");
      return { duplicate: `Product code ${code} already exists (${existing})` };
    }
    throw e;
  });

  if ("duplicate" in product) return { error: product.duplicate };

  await logActivity(
    "APPROVED",
    "ProductRequest",
    id,
    `Approved product request — created ${product.code} (${product.name})`
  );

  await catalogDecided({ name: request.name, requestedById: request.requestedById }, true);
  revalidatePath("/stock/products");
  return { success: true };
}

export async function rejectProductRequest(id: string, data: unknown) {
  const user = await requireAuth();

  const request = await prisma.productRequest.findUnique({ where: { id } });
  if (!request) return { error: "Request not found" };
  if (request.status !== "PENDING") return { error: "This request has already been processed" };
  // Somebody else decides what gets added on your request
  if (request.requestedById === user.id) return { error: "You asked for this, so someone else has to review it" };

  const neededPermission =
    request.type === "PRODUCT"
      ? PERMISSIONS.PRODUCTS_REQUEST_APPROVE
      : PERMISSIONS.CATEGORIES_REQUEST_APPROVE;
  if (!hasPermission(user.permissions, neededPermission)) {
    return {
      error: `You do not have permission to review ${request.type === "PRODUCT" ? "product" : "category"} requests`,
    };
  }

  const parsed = rejectRequestSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  await prisma.productRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedById: user.id,
      reviewNote: parsed.data.reviewNote.trim(),
    },
  });

  await logActivity("REJECTED", "ProductRequest", id, `Rejected request for "${request.name}"`);
  await catalogDecided({ name: request.name, requestedById: request.requestedById }, false, parsed.data.reviewNote.trim());

  return { success: true };
}

/** Pending catalog requests waiting on this person, for the dashboard queue. */
export async function getReviewableCatalogRequests() {
  const user = await requireAuth();

  const canProducts = hasPermission(user.permissions, PERMISSIONS.PRODUCTS_REQUEST_APPROVE);
  const canCategories = hasPermission(user.permissions, PERMISSIONS.CATEGORIES_REQUEST_APPROVE);
  if (!canProducts && !canCategories) return [];

  const requests = await prisma.productRequest.findMany({
    where: {
      status: "PENDING",
      // Only the types this person can actually act on
      ...(canProducts && canCategories
        ? {}
        : { type: canProducts ? ("PRODUCT" as const) : ("CATEGORY" as const) }),
    },
    take: 10,
    orderBy: { createdAt: "desc" },
    include: { requestedBy: { select: { name: true } } },
  });

  return requests.map((r) => ({
    kind: r.type === "PRODUCT" ? ("PRODUCT" as const) : ("CATEGORY" as const),
    id: r.id,
    title: r.name,
    subtitle: `Requested by ${r.requestedBy.name}`,
    href: "/stock/products?tab=requests",
  }));
}

/** How many catalog requests are waiting, for the dashboard tile. */
export async function getPendingRequestCount() {
  const user = await requireAuth();

  const canProducts = hasPermission(user.permissions, PERMISSIONS.PRODUCTS_REQUEST_APPROVE);
  const canCategories = hasPermission(user.permissions, PERMISSIONS.CATEGORIES_REQUEST_APPROVE);

  // Reviewers count everything of the types they review; everyone else counts
  // only what they asked for themselves.
  return prisma.productRequest.count({
    where:
      canProducts && canCategories
        ? { status: "PENDING" }
        : {
            status: "PENDING",
            OR: [
              { requestedById: user.id },
              ...(canProducts ? [{ type: "PRODUCT" as const }] : []),
              ...(canCategories ? [{ type: "CATEGORY" as const }] : []),
            ],
          },
  });
}
