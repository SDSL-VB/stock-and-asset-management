"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requirePermission, resolveStockScope } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { stockLevelReport } from "@/lib/low-stock";
import { syncBomWatches } from "@/lib/low-stock-bom";
import { logActivity } from "@/lib/activity-log";

/**
 * FLOW: low stock — what is watched, what is running out, and when to order.
 *
 *   1. saveStockLevel     somebody with stock.lowstock.manage says "watch this
 *                         product at this site, never below N". Who supplies
 *                         it and in how many days is set separately, on the
 *                         product or the vendor — see suppliers.ts.
 *   2. getStockLevels     every watched product with its reorder point, for the
 *                         Procurement page. The arithmetic is src/lib/low-stock.ts.
 *   3. (the bell)         items that need action are announced to everyone
 *                         who sees low stock — src/lib/notifications/checks.ts.
 *   4. (raise needs)      the card's "Raise needs" opens the "What do you
 *                         need?" dialog filled in; requestNeeds() in needs.ts.
 *
 * A low-stock alert follows the same sites as the stock itself. Somebody who
 * cannot open Hyderabad's stock is not shown what Hyderabad is running out of,
 * whether the watch was added by hand or came from a bill of materials they
 * work with — knowing a site is short is knowing what that site holds.
 * Only stock.scope.all sees every site. The notifications follow the same rule
 * (src/lib/notifications/checks.ts).
 */

/**
 * The sites whose low stock this person may see: every site, or their own.
 * Someone scoped to a site but with no site on record sees none, rather than
 * all — the same choice the dispatch list makes.
 */
function visibleSites(user: {
  role: string;
  permissions: string[];
  locationId?: string | null;
}): { locationIds?: string[] } {
  if (resolveStockScope(user) === "all") return {};
  return { locationIds: user.locationId ? [user.locationId] : [] };
}

export async function getStockLevels() {
  const user = await requirePermission(PERMISSIONS.STOCK_LOWSTOCK_VIEW);
  return stockLevelReport(visibleSites(user));
}

/** What the "Watch a product" form offers. */
export async function getStockLevelFormData() {
  await requirePermission(PERMISSIONS.STOCK_LOWSTOCK_MANAGE);
  const [products, locations] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        unit: true,
        category: { select: { name: true } },
        subcategory: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { products, locations };
}

const stockLevelSchema = z.object({
  productId: z.string().min(1, "Pick a product"),
  locationId: z.string().min(1, "Pick a site"),
  minimum: z.number({ error: "Enter a minimum" }).min(0, "A minimum cannot be negative"),
});

/** Watch a product at a site, or change its minimum there. */
export async function saveStockLevel(data: unknown) {
  const user = await requirePermission(PERMISSIONS.STOCK_LOWSTOCK_MANAGE);
  const parsed = stockLevelSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { productId, locationId, minimum } = parsed.data;

  const [product, location] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { name: true, isActive: true } }),
    prisma.location.findUnique({ where: { id: locationId }, select: { name: true } }),
  ]);
  if (!product?.isActive) return { error: "That product is not in the catalog" };
  if (!location) return { error: "That site does not exist" };

  await prisma.stockLevel.upsert({
    where: { productId_locationId: { productId, locationId } },
    // Set by hand: no longer automatic, and watched again if it had been stopped
    update: { minimum, updatedById: user.id, fromBom: false, stopped: false },
    create: { productId, locationId, minimum, updatedById: user.id },
  });

  await logActivity("UPDATED", "StockLevel", productId, `Watching ${product.name} at ${location.name}: minimum ${minimum}`);

  revalidatePath("/procurement");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Stop watching a product at a site. Its vendor lead times are kept.
 *
 * The row is marked stopped rather than deleted, so the BOM sync does not
 * bring back a component somebody deliberately stopped watching.
 */
export async function removeStockLevel(stockLevelId: string) {
  await requirePermission(PERMISSIONS.STOCK_LOWSTOCK_MANAGE);

  const level = await prisma.stockLevel.findUnique({
    where: { id: stockLevelId },
    include: { product: { select: { name: true } }, location: { select: { name: true } } },
  });
  if (!level) return { error: "That product is not being watched" };

  await prisma.stockLevel.update({ where: { id: stockLevelId }, data: { stopped: true, fromBom: false } });
  await logActivity("DELETED", "StockLevel", level.productId, `Stopped watching ${level.product.name} at ${level.location.name}`);

  revalidatePath("/procurement");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * "Update from BOMs" on the low-stock card: bring the automatic watches in
 * line with the published bills of materials now, rather than waiting for the
 * next BOM change, build or approval to do it. See src/lib/low-stock-bom.ts.
 */
export async function updateWatchesFromBoms() {
  await requirePermission(PERMISSIONS.STOCK_LOWSTOCK_MANAGE);
  const result = await syncBomWatches();
  revalidatePath("/procurement");
  revalidatePath("/dashboard");
  return { success: true, ...result };
}
