"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import { isStockVisible } from "@/lib/stock-visibility";
import { warrantySchema } from "@/lib/validations/stock";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";

/**
 * Warranty and registration details for a stock entry. Reading and writing are
 * separate grants: a department manager can see what is still under warranty
 * without being able to alter the record.
 */
/** The entry, if this person may see it — warranty follows stock visibility. */
async function visibleEntry(
  user: Parameters<typeof isStockVisible>[1] & Parameters<typeof resolveStockScope>[0],
  stockEntryId: string
) {
  const entry = await prisma.stockEntry.findUnique({
    where: { id: stockEntryId },
    include: { issues: { select: { quantity: true, departmentId: true } } },
  });
  return entry && isStockVisible(entry, user, resolveStockScope(user)) ? entry : null;
}

export async function saveWarrantyDetails(stockEntryId: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.STOCK_WARRANTY_EDIT);

  const parsed = warrantySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const entry = await visibleEntry(user, stockEntryId);
  if (!entry) return { error: "Stock entry not found" };

  const purchaseDate = new Date(parsed.data.purchaseDate);
  const warrantyTill = new Date(parsed.data.warrantyTill);
  if (Number.isNaN(purchaseDate.getTime()) || Number.isNaN(warrantyTill.getTime())) {
    return { error: "Those dates are not valid" };
  }
  if (warrantyTill < purchaseDate) {
    return { error: "Warranty cannot end before the item was bought" };
  }

  const values = {
    purchaseDate,
    warrantyTill,
    modelNumber: parsed.data.modelNumber.trim(),
    serialNumber: parsed.data.serialNumber.trim(),
    modelName: parsed.data.modelName?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
  };

  await prisma.stockEntryWarranty.upsert({
    where: { stockEntryId },
    update: values,
    create: { stockEntryId, ...values },
  });

  await logActivity(
    "UPDATED",
    "StockEntry",
    stockEntryId,
    `Recorded warranty details for ${entry.entryNumber} (serial ${values.serialNumber})`
  );

  revalidatePath(`/stock/${stockEntryId}`);
  revalidatePath("/stock");
  return { success: true };
}

export async function removeWarrantyDetails(stockEntryId: string) {
  const user = await requirePermission(PERMISSIONS.STOCK_WARRANTY_EDIT);
  if (!(await visibleEntry(user, stockEntryId))) return { error: "Stock entry not found" };

  const existing = await prisma.stockEntryWarranty.findUnique({
    where: { stockEntryId },
    select: { id: true },
  });
  if (!existing) return { error: "There are no warranty details to remove" };

  await prisma.stockEntryWarranty.delete({ where: { stockEntryId } });

  await logActivity(
    "UPDATED",
    "StockEntry",
    stockEntryId,
    "Removed the warranty and registration details"
  );

  revalidatePath(`/stock/${stockEntryId}`);
  return { success: true };
}
