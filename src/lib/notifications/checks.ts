import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { stockLevelReport } from "@/lib/low-stock";
import { bomOwnerOf } from "@/lib/low-stock-bom";
import { deliveredEntriesWhere } from "@/lib/procurement-delivery";
import { formatDateTime } from "@/lib/format";
import { notify, notifyHolders } from "./notify";

/**
 * The two things nobody presses a button for: stock running low and orders
 * running late. Found by looking, not by an event, so they are checked:
 *
 *   - after page loads, at most once every CHECK_EVERY_MINUTES (the layout
 *     calls this after the response; the time of the last run is kept in
 *     SystemState, so every instance shares it), and
 *   - every morning by the daily job (src/app/api/cron/daily/route.ts).
 *
 * Each condition is announced once. A low-stock episode is keyed by when it
 * went low, so the same shortage is not repeated but a new one after a restock
 * is; a late order line is announced once.
 */
const CHECK_EVERY_MINUTES = 15;

export async function runWatchChecks(options: { force?: boolean } = {}): Promise<void> {
  const due = new Date(Date.now() - CHECK_EVERY_MINUTES * 60_000);
  // Claim the run: only one caller gets past this when several arrive at once
  const claimed = await prisma.systemState.updateMany({
    where: options.force ? { id: "singleton" } : { id: "singleton", OR: [{ watchChecksAt: null }, { watchChecksAt: { lt: due } }] },
    data: { watchChecksAt: new Date() },
  });
  if (claimed.count === 0) {
    const exists = await prisma.systemState.findUnique({ where: { id: "singleton" } });
    if (exists) return;
    await prisma.systemState.create({ data: { id: "singleton", watchChecksAt: new Date() } });
  }

  await Promise.all([announceLowStock(), announceLateOrders()]);
}

/**
 * Every watched product that needs ordering, told to the people who can see
 * that site — and only them. Somebody who cannot open Hyderabad's stock is not
 * told what Hyderabad is short of, even when the watch came from a bill of
 * materials they work with.
 *
 * Components of one BOM at one site are tagged with the same group, so the
 * bell shows "4 components low for BLDC_Controller at Bengaluru" and opens to
 * the four. They stay four notifications: each is a separate thing to order,
 * to read and to mark read.
 */
async function announceLowStock() {
  const rows = (await stockLevelReport()).filter((r) => r.needsAction);
  const owners = await bomOwnerOf([...new Set(rows.map((r) => r.productId))]);

  for (const r of rows) {
    const owner = owners.get(r.productId);
    await notifyHolders(
      PERMISSIONS.STOCK_LOWSTOCK_VIEW,
      { locationId: r.locationId },
      {
        kind: "LOW_STOCK",
        title: `${r.name} needs ordering at ${r.locationName}`,
        body: `${r.available} ${r.unit} left${r.lowSince ? `, low since ${formatDateTime(r.lowSince.at)}` : ""} — ask for ${r.suggestedQuantity} ${r.unit}`,
        href: "/procurement#low-stock",
        dedupeKey: `low:${r.stockLevelId}:${r.lowSince?.at.toISOString() ?? "unknown"}`,
        ...(owner
          ? {
              groupKey: `bom:${owner.bomId}:${r.locationId}`,
              groupLabel: `${owner.productName} at ${r.locationName}`,
            }
          : {}),
      }
    );
  }
}

async function announceLateOrders() {
  const lines = await prisma.purchaseOrderLine.findMany({
    where: { expectedBy: { lt: new Date() }, purchaseOrder: { status: "OPEN" } },
    include: {
      product: { select: { name: true, unit: true } },
      purchaseOrder: { select: { poNumber: true, locationId: true, createdById: true, vendor: { select: { name: true } } } },
      stockEntries: { where: deliveredEntriesWhere, select: { quantity: true } },
    },
  });
  for (const line of lines) {
    const delivered = line.stockEntries.reduce((sum, e) => sum + e.quantity, 0);
    if (delivered >= line.quantity) continue;
    const message = {
      kind: "ORDER_LATE" as const,
      title: `${line.purchaseOrder.poNumber} is late: ${line.product.name}`,
      body: `${line.purchaseOrder.vendor.name} was due to deliver ${line.quantity - delivered} ${line.product.unit} by ${line.expectedBy!.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
      href: "/procurement",
      dedupeKey: `late:${line.id}`,
    };
    // Whoever raised it, and the buyers for that site
    await notify([line.purchaseOrder.createdById], message);
    await notifyHolders(PERMISSIONS.PROCUREMENT_PO_CREATE, { locationId: line.purchaseOrder.locationId }, message);
  }
}
