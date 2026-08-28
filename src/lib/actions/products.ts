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
  categoryPrefixSchema,
} from "@/lib/validations/product";
import {
  composeProductCode,
  CODE_PREFIX_PATTERN,
  CODE_SUFFIX_PATTERN,
} from "@/lib/product-codes";
import {
  createProductRequestSchema,
  approveProductRequestSchema,
  rejectRequestSchema,
} from "@/lib/validations/request";
import { archive } from "@/lib/recycle-bin";
import { labelOfKind } from "@/lib/vocabulary";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

/**
 * The catalog: raw materials we buy, products we make, and the categories both
 * live in — plus the queue of things people have asked to be added.
 *
 * Called by: the Catalog page, and the product search on the stock entry form.
 *
 * Two rules live here. A product CODE is the category's fixed prefix plus a
 * suffix someone types, and the prefix is never accepted from the browser — the
 * server re-reads it from the category. And adding a raw material is a
 * different grant from adding something we make, because only the second needs
 * a bill of materials to mean anything.
 */

// ---------- Read (operators + admins) ----------

export async function getProductCategories() {
  await requireAnyPermission([PERMISSIONS.PRODUCTS_VIEW, ...PRODUCT_MANAGE_PERMISSIONS]);

  return prisma.productCategory.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, codePrefix: true, nextSequence: true },
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
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      category: { select: { id: true, name: true } },
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
      // billsOfMaterials tells the Products tab which ones still need a recipe
      _count: { select: { stockEntries: true, billsOfMaterials: true } },
    },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
  });
}

export async function getAllProductCategories() {
  await requireAnyPermission(PRODUCT_MANAGE_PERMISSIONS);

  return prisma.productCategory.findMany({
    include: { _count: { select: { products: true } } },
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
  const currentUser = await requirePermission(
    kind === "RAW" ? PERMISSIONS.PRODUCTS_CREATE : PERMISSIONS.PRODUCTS_CREATE_MADE
  );

  const category = await prisma.productCategory.findUnique({
    where: { id: parsed.data.categoryId },
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

  // A product code is the category's code plus the half the user typed. The
  // first half is never accepted from the client — it comes from the category.
  const product = await prisma.$transaction(async (tx) => {
    const code = composeProductCode(categoryCode, parsed.data.codeSuffix);

    const existing = await tx.product.findUnique({ where: { code } });
    if (existing) {
      throw new Error(`DUPLICATE:${code}:${existing.name}`);
    }

    return tx.product.create({
      data: {
        code,
        name: parsed.data.name.trim(),
        categoryId: parsed.data.categoryId,
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

  let code = product.code;
  if (canOverrideCode && parsed.data.codeSuffix?.trim()) {
    const category = await prisma.productCategory.findUnique({
      where: { id: parsed.data.categoryId },
      select: { codePrefix: true },
    });
    if (!category?.codePrefix) return { error: "That category has no code prefix" };
    code = composeProductCode(category.codePrefix, parsed.data.codeSuffix);
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
      nextKind === "RAW" ? PERMISSIONS.PRODUCTS_CREATE : PERMISSIONS.PRODUCTS_CREATE_MADE;
    if (!currentUser.permissions.includes(needed)) {
      return {
        error: `Changing ${product.code} into a ${labelOfKind(nextKind).toLowerCase()} needs a separate permission.`,
      };
    }
  }

  const updated = await prisma.product.update({
    where: { id },
    data: {
      code,
      name: parsed.data.name.trim(),
      categoryId: parsed.data.categoryId,
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

export async function createProductCategory(data: unknown) {
  await requirePermission(PERMISSIONS.CATEGORIES_CREATE);

  const parsed = createProductCategorySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const name = parsed.data.name.trim();
  const { codePrefix } = parsed.data;

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
    data: { name, codePrefix },
  });

  await logActivity(
    "CREATED",
    "ProductCategory",
    category.id,
    `Created product category ${name} (code prefix ${category.codePrefix})`
  );

  revalidatePath("/stock/products");
  return { success: true, category };
}

/**
 * Changes the fixed code prefix a category hands out. Applies to codes
 * generated from now on — products already created keep the code they were
 * given, since codes appear in stock history, exports, and printed labels.
 */
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

  const { type, name, categoryId, notes } = parsed.data;

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

  const request = await prisma.productRequest.create({
    data: {
      type,
      name: name.trim(),
      categoryId: type === "PRODUCT" ? categoryId : null,
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

  const product = await prisma.$transaction(async (tx) => {
    const code = composeProductCode(approvalPrefix, suffix);

    const duplicate = await tx.product.findUnique({ where: { code } });
    if (duplicate) {
      throw new Error(`DUPLICATE:${code}:${duplicate.name}`);
    }

    const created = await tx.product.create({
      data: { code, name, categoryId, kind: "RAW" },
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

  revalidatePath("/stock/products");
  return { success: true };
}

export async function rejectProductRequest(id: string, data: unknown) {
  const user = await requireAuth();

  const request = await prisma.productRequest.findUnique({ where: { id } });
  if (!request) return { error: "Request not found" };
  if (request.status !== "PENDING") return { error: "This request has already been processed" };

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
    href: "/stock/products",
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
