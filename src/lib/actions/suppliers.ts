"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { logActivity } from "@/lib/activity-log";

/**
 * Who supplies what, and how long each takes.
 *
 * Called by: the Suppliers dialog, opened from a vendor on the Vendors page
 * ("what does this vendor supply?") and from a product in the Catalog ("who
 * supplies this?"). Both read and write the same ProductVendor rows, so the two
 * views can never disagree.
 *
 * A lead time belongs to the PAIR, never to a product or a vendor alone. Vendor
 * A supplying boards and resistors has one lead time for each; Vendor B's board
 * has its own again. So a vendor with ten products has ten lead times, and a
 * product with three vendors has three.
 *
 * One vendor per product can be PREFERRED — the one the low-stock alert orders
 * from and pre-fills on a need. Marking one clears the others for that product.
 *
 * Reading needs nothing beyond opening either page. Changing is for anyone who
 * maintains vendors, maintains products, or runs low stock — the three people
 * who might learn that a supplier has become slower.
 */

const EDIT_PERMISSIONS = [
  PERMISSIONS.VENDORS_EDIT,
  PERMISSIONS.PRODUCTS_EDIT,
  PERMISSIONS.STOCK_LOWSTOCK_MANAGE,
];

/** The pairs for one product or one vendor, with both names for display. */
export async function getSuppliers(filter: { productId?: string; vendorId?: string }) {
  await requireAnyPermission([
    PERMISSIONS.VENDORS_VIEW,
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.STOCK_LOWSTOCK_VIEW,
    ...EDIT_PERMISSIONS,
  ]);
  if (!filter.productId && !filter.vendorId) return [];

  return prisma.productVendor.findMany({
    where: filter.productId ? { productId: filter.productId } : { vendorId: filter.vendorId },
    select: {
      id: true,
      leadTimeDays: true,
      isPreferred: true,
      product: { select: { id: true, code: true, name: true } },
      vendor: { select: { id: true, name: true, isActive: true } },
    },
    orderBy: filter.productId ? [{ isPreferred: "desc" }, { leadTimeDays: "asc" }] : { product: { name: "asc" } },
  });
}

/**
 * What the dialog's pickers offer when adding a pair: active products (from a
 * vendor's side) and active vendors (from a product's side). Loaded when the
 * dialog opens, and only for someone who can add one.
 */
export async function getSupplierOptions() {
  await requireAnyPermission(EDIT_PERMISSIONS);
  const [products, vendors] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        category: { select: { name: true } },
        subcategory: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.vendor.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { products, vendors };
}

const supplierSchema = z.object({
  productId: z.string().min(1, "Pick a product"),
  vendorId: z.string().min(1, "Pick a vendor"),
  leadTimeDays: z.number({ error: "Say how many days" }).int("Whole days").min(0).max(365, "That lead time looks wrong"),
  isPreferred: z.boolean(),
});

/** Add a pair, or change its lead time or preference. */
export async function saveSupplier(data: unknown) {
  await requireAnyPermission(EDIT_PERMISSIONS);
  const parsed = supplierSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { productId, vendorId, leadTimeDays, isPreferred } = parsed.data;

  const [product, vendor] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { name: true } }),
    prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true } }),
  ]);
  if (!product) return { error: "That product does not exist" };
  if (!vendor) return { error: "That vendor does not exist" };

  await prisma.$transaction(async (tx) => {
    if (isPreferred) {
      await tx.productVendor.updateMany({
        where: { productId, vendorId: { not: vendorId } },
        data: { isPreferred: false },
      });
    }
    await tx.productVendor.upsert({
      where: { productId_vendorId: { productId, vendorId } },
      update: { leadTimeDays, isPreferred },
      create: { productId, vendorId, leadTimeDays, isPreferred },
    });
  });

  await logActivity(
    "UPDATED",
    "ProductVendor",
    productId,
    `${vendor.name} supplies ${product.name} in ${leadTimeDays} day${leadTimeDays === 1 ? "" : "s"}${isPreferred ? " (preferred)" : ""}`
  );

  revalidatePath("/vendors");
  revalidatePath("/stock/products");
  revalidatePath("/procurement");
  return { success: true };
}

export async function removeSupplier(id: string) {
  await requireAnyPermission(EDIT_PERMISSIONS);
  const pair = await prisma.productVendor.findUnique({
    where: { id },
    include: { product: { select: { name: true } }, vendor: { select: { name: true } } },
  });
  if (!pair) return { error: "That supplier link no longer exists" };

  await prisma.productVendor.delete({ where: { id } });
  await logActivity("DELETED", "ProductVendor", pair.productId, `${pair.vendor.name} no longer listed as supplying ${pair.product.name}`);

  revalidatePath("/vendors");
  revalidatePath("/stock/products");
  revalidatePath("/procurement");
  return { success: true };
}

/**
 * "Update lead time to N days" on a late order line: the vendor took clearly
 * longer than recorded (src/lib/order-timing.ts), so record what they actually
 * take. Keeps whether they are the preferred vendor.
 */
export async function updateLeadTimeFromOrder(productId: string, vendorId: string, leadTimeDays: number) {
  await requireAnyPermission(EDIT_PERMISSIONS);
  const existing = await prisma.productVendor.findUnique({
    where: { productId_vendorId: { productId, vendorId } },
    select: { isPreferred: true },
  });
  return saveSupplier({ productId, vendorId, leadTimeDays, isPreferred: existing?.isPreferred ?? false });
}
