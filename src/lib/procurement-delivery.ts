import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";

/**
 * What counts as delivered against a purchase order line.
 *
 * Kept out of the actions file because a `"use server"` module may only export
 * async functions — and kept in one place for the same reason availability is:
 * the order page, the stock entry form and the auto-close all have to agree on
 * what "arrived" means, or an order closes at the wrong moment.
 *
 * A draft entry is someone part-way through typing and may never be finished,
 * so it does not yet mean the goods came. A rejected entry means they were
 * refused. Everything between is a real arrival.
 */
const DELIVERED_ENTRY_STATUSES = ["SUBMITTED", "APPROVED"] as const;

/** Prisma `where` fragment selecting the entries that count as delivered. */
export const deliveredEntriesWhere = {
  status: { in: [...DELIVERED_ENTRY_STATUSES] },
};


/*
 * The two checks below run inside the stock actions (booking goods in against
 * an order line, submitting, rejecting). They live here rather than in a
 * "use server" file, where they would be endpoints anyone could call.
 */

/**
 * Whether a line can take this many more units, or why not.
 *
 * Returns an error message, or null when the delivery fits. Called from every
 * point where the booked quantity can change — creating an entry, editing one,
 * and submitting it — because outstanding is DERIVED, and a check at only one
 * of those three leaves the other two as ways round it.
 *
 * `excludeEntryId` skips an entry's own contribution, so editing a submitted
 * delivery is measured against everything except itself.
 */
export async function checkOrderLineCapacity(
  purchaseOrderLineId: string,
  productId: string,
  quantity: number,
  excludeEntryId?: string
): Promise<string | null> {
  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: purchaseOrderLineId },
    include: {
      purchaseOrder: { select: { poNumber: true, status: true } },
      stockEntries: {
        where: {
          ...deliveredEntriesWhere,
          ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
        },
        select: { quantity: true },
      },
    },
  });

  if (!line) return "That purchase order line no longer exists";
  if (line.purchaseOrder.status !== "OPEN") {
    return `${line.purchaseOrder.poNumber} is already ${line.purchaseOrder.status.toLowerCase()}`;
  }
  if (line.productId !== productId) {
    return "That order line is for a different product";
  }

  const delivered = line.stockEntries.reduce((sum, e) => sum + e.quantity, 0);
  const outstanding = line.quantity - delivered;
  if (quantity > outstanding) {
    return `${line.purchaseOrder.poNumber} is only owed ${outstanding} more — enter ${outstanding} or less, or raise a separate entry`;
  }

  return null;
}

/**
 * Bring an order's status back in line with what has actually arrived: close
 * it when the last unit is in, re-open one that closed itself when a delivery
 * behind it is withdrawn. An order closed short by a person stays closed.
 */
export async function syncPurchaseOrderFromEntry(purchaseOrderLineId: string) {
  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: purchaseOrderLineId },
    select: { purchaseOrderId: true },
  });
  if (!line) return;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id: line.purchaseOrderId },
    select: {
      id: true,
      poNumber: true,
      status: true,
      closedById: true,
      lines: { select: { quantity: true, stockEntries: { where: deliveredEntriesWhere, select: { quantity: true } } } },
    },
  });
  if (!order) return;

  const outstanding = order.lines.reduce(
    (sum, l) => sum + Math.max(0, l.quantity - l.stockEntries.reduce((s, e) => s + e.quantity, 0)),
    0
  );

  if (order.status === "OPEN" && outstanding === 0) {
    await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    await logActivity("UPDATED", "PurchaseOrder", order.id, `${order.poNumber} closed automatically — everything ordered has arrived`);
    revalidatePath("/procurement");
    return;
  }

  const closedAutomatically = order.status === "CLOSED" && order.closedById === null;
  if (closedAutomatically && outstanding > 0) {
    await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: { status: "OPEN", closedAt: null, closeReason: null },
    });
    await logActivity(
      "UPDATED",
      "PurchaseOrder",
      order.id,
      `${order.poNumber} re-opened — ${outstanding} unit${outstanding === 1 ? "" : "s"} still owed after a delivery was withdrawn`
    );
    revalidatePath("/procurement");
  }
}
