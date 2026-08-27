"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { vendorSchema } from "@/lib/validations/vendor";
import { toCsv } from "@/lib/csv";
import { archive } from "@/lib/recycle-bin";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

const VENDOR_MANAGE_PERMISSIONS = [
  PERMISSIONS.VENDORS_VIEW,
  PERMISSIONS.VENDORS_CREATE,
  PERMISSIONS.VENDORS_EDIT,
];

export async function getVendors() {
  await requireAnyPermission(VENDOR_MANAGE_PERMISSIONS);

  return prisma.vendor.findMany({
    include: { _count: { select: { stockEntries: true } } },
    orderBy: { name: "asc" },
  });
}

/**
 * Vendors for the stock entry form. Naming a supplier is part of creating
 * stock, so this is gated on the stock keys rather than vendors.view — and it
 * deliberately returns no GST number or address, which stay behind vendors.view.
 */
export async function getVendorsForEntryForm() {
  await requireAnyPermission([PERMISSIONS.STOCK_CREATE, PERMISSIONS.STOCK_EDIT]);

  return prisma.vendor.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * The vendor list as a CSV.
 *
 * Its own permission: taking the list away as a file is a different act from
 * reading it on screen, and this one carries GST numbers and addresses.
 */
export async function exportVendors() {
  await requirePermission(PERMISSIONS.VENDORS_EXPORT);

  const vendors = await prisma.vendor.findMany({
    include: { _count: { select: { stockEntries: true } } },
    orderBy: { name: "asc" },
  });

  const headers = ["Name", "GST Number", "Address", "Status", "Stock Entries", "Added On"];

  const rows = vendors.map((v) => [
    v.name,
    v.gstNumber ?? "",
    v.address ?? "",
    v.isActive ? "Active" : "Inactive",
    v._count.stockEntries.toString(),
    new Date(v.createdAt).toLocaleDateString("en-IN"),
  ]);

  await logActivity(
    "EXPORTED",
    "Vendor",
    undefined,
    `Exported the vendor list (${rows.length} vendors)`
  );

  return { success: true as const, csv: toCsv(headers, rows), rowCount: rows.length };
}

export async function createVendor(data: unknown) {
  await requirePermission(PERMISSIONS.VENDORS_CREATE);

  const parsed = vendorSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const name = parsed.data.name.trim();
  const existing = await prisma.vendor.findUnique({ where: { name } });
  if (existing) return { error: `Vendor "${name}" already exists` };

  const vendor = await prisma.vendor.create({
    data: {
      name,
      gstNumber: parsed.data.gstNumber?.trim() || null,
      address: parsed.data.address?.trim() || null,
    },
  });

  await logActivity("CREATED", "Vendor", vendor.id, `Added vendor ${vendor.name}`);

  revalidatePath("/vendors");
  return { success: true, vendor };
}

export async function updateVendor(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.VENDORS_EDIT);

  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) return { error: "Vendor not found" };

  const parsed = vendorSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const name = parsed.data.name.trim();
  const duplicate = await prisma.vendor.findFirst({
    where: { name, id: { not: id } },
  });
  if (duplicate) return { error: `Vendor "${name}" already exists` };

  const updated = await prisma.vendor.update({
    where: { id },
    data: {
      name,
      gstNumber: parsed.data.gstNumber?.trim() || null,
      address: parsed.data.address?.trim() || null,
    },
  });

  await logActivity("UPDATED", "Vendor", id, `Updated vendor ${updated.name}`);

  revalidatePath("/vendors");
  return { success: true, vendor: updated };
}

export async function toggleVendorActive(id: string) {
  await requirePermission(PERMISSIONS.VENDORS_EDIT);

  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) return { error: "Vendor not found" };

  const updated = await prisma.vendor.update({
    where: { id },
    data: { isActive: !vendor.isActive },
  });

  await logActivity(
    "UPDATED",
    "Vendor",
    id,
    `${updated.isActive ? "Activated" : "Deactivated"} vendor ${updated.name}`
  );

  revalidatePath("/vendors");
  return { success: true, vendor: updated };
}

/**
 * Removes a vendor. Entries snapshot the supplier's name at the time, so
 * unlinking loses nothing readable — but deactivating is still the better move,
 * since it keeps the record for reporting.
 */
export async function deleteVendor(id: string, options: { force?: boolean } = {}) {
  const user = await requirePermission(PERMISSIONS.VENDORS_DELETE);

  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: { _count: { select: { stockEntries: true } } },
  });
  if (!vendor) return { error: "Vendor not found" };

  const used = vendor._count.stockEntries;

  if (!options.force && used > 0) {
    return {
      needsConfirmation: true,
      message: `${vendor.name} is named on ${used} stock entr${used === 1 ? "y" : "ies"}.`,
      recommendation:
        "Deactivating removes them from the entry form while every past entry keeps the supplier name it was created with.",
    };
  }

  let recycleId = "";
  await prisma.$transaction(async (tx) => {
    const affected = await tx.stockEntry.findMany({
      where: { vendorId: id },
      select: { id: true },
    });

    const { _count, ...snapshot } = vendor;
    recycleId = await archive(tx, {
      entity: "Vendor",
      entityId: id,
      label: vendor.name,
      snapshot,
      relinks: [{ table: "StockEntry", field: "vendorId", ids: affected.map((e) => e.id) }],
      deletedById: user.id,
    });

    await tx.stockEntry.updateMany({ where: { vendorId: id }, data: { vendorId: null } });
    await tx.vendor.delete({ where: { id } });
  });

  await logActivity("DELETED", "Vendor", id, `Deleted vendor ${vendor.name}`);

  revalidatePath("/vendors");
  revalidatePath("/recycle-bin");
  return { success: true, recycleId };
}
