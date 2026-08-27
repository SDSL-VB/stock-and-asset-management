"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { warrantySchema } from "@/lib/validations/stock";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

/**
 * Warranty and registration details for a stock entry. Reading and writing are
 * separate grants: a department manager can see what is still under warranty
 * without being able to alter the record.
 */
export async function saveWarrantyDetails(stockEntryId: string, data: unknown) {
  await requirePermission(PERMISSIONS.STOCK_WARRANTY_EDIT);

  const parsed = warrantySchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const entry = await prisma.stockEntry.findUnique({
    where: { id: stockEntryId },
    select: { id: true, entryNumber: true },
  });
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
  await requirePermission(PERMISSIONS.STOCK_WARRANTY_EDIT);

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
