"use server";

import { prisma } from "@/lib/prisma";
import { nextReference } from "@/lib/reference-numbers";
import { requireAuth, requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import {
  reviewIntentSchema,
  createPurchaseOrderSchema,
  closePurchaseOrderSchema,
} from "@/lib/validations/procurement";
import { deliveredEntriesWhere } from "@/lib/procurement-delivery";
import { dueDate, lineTiming, suggestedLeadTime } from "@/lib/order-timing";
import { needDecided } from "@/lib/notifications/events";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";
import { NO_SITE } from "@/lib/stock-visibility";

/**
 * FLOW: purchase — a need, an order, deliveries, and a close.
 *
 *   1. (a need is raised)      through the "What do you need?" dialog — see
 *                              requestNeeds() in needs.ts. It records the
 *                              department asking automatically.
 *   2. approveIntent           a buyer verifies it is worth ordering → APPROVED.
 *                              (Can be switched off in procurement_flow_config.)
 *      rejectIntent/cancel     or declines it, or the asker withdraws it.
 *   3. createPurchaseOrder     one or more verified needs become an order to a
 *                              single vendor, with agreed prices. The needs flip
 *                              to ORDERED so nothing is ordered twice.
 *   4. (a stock entry arrives) see stock.ts — booking goods against a line is
 *                              what "delivered" means.
 *   5. (the order closes itself) syncPurchaseOrderFromEntry, in
 *                              src/lib/procurement-delivery.ts, closes it when
 *                              the last unit is booked in and re-opens it if
 *                              that delivery is rejected.
 *      closePurchaseOrder      or someone closes it short, which is a decision
 *                              and is never undone automatically.
 */

/**
 * Procurement: a stated need, an order placed against it, and goods arriving.
 *
 * The one idea worth holding on to is that **nothing records how much is still
 * outstanding**. A line's delivered quantity is the sum of the stock entries
 * pointing at it, so a part delivery needs no bookkeeping beyond entering the
 * goods that actually turned up — and there is no second number to drift.
 */

/* ------------------------------------------------------------------------- */
/* The configurable step                                                     */
/* ------------------------------------------------------------------------- */

/**
 * One rule for the company, like the bill-of-materials flow: must a need be
 * verified before it is ordered? Stored in `procurement_flow_config`; nothing
 * changes it while the Configuration page is taken out.
 */
export async function getProcurementFlow() {
  await requireAuth();
  const config = await prisma.procurementFlowConfig.findUnique({
    where: { id: "singleton" },
    include: { approverRole: { select: { id: true, name: true } } },
  });

  return {
    requiresApproval: config?.requiresApproval ?? true,
    approverRoleId: config?.approverRoleId ?? null,
    approverRoleName: config?.approverRole?.name ?? null,
  };
}

/* ------------------------------------------------------------------------- */
/* Intents — "we need this"                                                  */
/* ------------------------------------------------------------------------- */

/** Intents the caller may see: their own, their department's, or all. */
export async function getIntents() {
  const user = await requireAnyPermission([
    PERMISSIONS.PROCUREMENT_INTENT_VIEW,
    PERMISSIONS.PROCUREMENT_INTENT_CREATE,
  ]);

  const seesAll =
    resolveStockScope(user) === "all" ||
    user.permissions.includes(PERMISSIONS.PROCUREMENT_INTENT_APPROVE);

  const intents = await prisma.purchaseIntent.findMany({
    where: seesAll
      ? {}
      : {
          OR: [
            { requestedById: user.id },
            ...(user.departmentId ? [{ departmentId: user.departmentId }] : []),
          ],
        },
    include: {
      product: { select: { code: true, name: true, unit: true } },
      vendor: { select: { name: true } },
      department: { select: { name: true } },
      location: { select: { name: true } },
      requestedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      // Raised as part of a list — the Needs table opens it from here
      needList: { select: { id: true, listNumber: true } },
      orderLines: {
        select: { purchaseOrder: { select: { id: true, poNumber: true, status: true } } },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return intents.map((i) => ({
    ...i,
    order: i.orderLines[0]?.purchaseOrder ?? null,
  }));
}

export async function approveIntent(id: string, data: unknown = {}) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_APPROVE);

  const parsed = reviewIntentSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const intent = await prisma.purchaseIntent.findUnique({
    where: { id },
    include: { product: { select: { name: true } } },
  });
  if (!intent) return { error: "That need no longer exists" };
  if (intent.status !== "PENDING") {
    return { error: `This has already been ${intent.status.toLowerCase()}` };
  }
  // Nobody signs off their own request
  if (intent.requestedById === user.id) return { error: "You raised this need, so someone else has to review it" };

  await prisma.purchaseIntent.update({
    where: { id },
    data: {
      status: "APPROVED",
      reviewNote: parsed.data.reviewNote?.trim() || null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
  });

  await logActivity(
    "APPROVED",
    "PurchaseIntent",
    id,
    `Verified ${intent.intentNumber} — ${intent.quantity} × ${intent.product.name} can be ordered`
  );

  await needDecided(
    { intentNumber: intent.intentNumber, productName: intent.product.name, requestedById: intent.requestedById },
    "verified",
    parsed.data.reviewNote?.trim() || undefined
  );
  revalidatePath("/procurement");
  return { success: true };
}

export async function rejectIntent(id: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_APPROVE);

  const parsed = reviewIntentSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const intent = await prisma.purchaseIntent.findUnique({
    where: { id },
    include: { product: { select: { name: true } } },
  });
  if (!intent) return { error: "That need no longer exists" };
  if (intent.status !== "PENDING") {
    return { error: `This has already been ${intent.status.toLowerCase()}` };
  }
  // Nobody signs off their own request
  if (intent.requestedById === user.id) return { error: "You raised this need, so someone else has to review it" };

  await prisma.purchaseIntent.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewNote: parsed.data.reviewNote?.trim() || null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
  });

  await logActivity(
    "REJECTED",
    "PurchaseIntent",
    id,
    `Declined ${intent.intentNumber} for ${intent.quantity} × ${intent.product.name}`
  );

  await needDecided(
    { intentNumber: intent.intentNumber, productName: intent.product.name, requestedById: intent.requestedById },
    "declined",
    parsed.data.reviewNote?.trim() || undefined
  );
  revalidatePath("/procurement");
  return { success: true };
}

/** Withdraw a need you raised, while nobody has acted on it. */
export async function cancelIntent(id: string) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_CREATE);

  const intent = await prisma.purchaseIntent.findUnique({
    where: { id },
    include: { product: { select: { name: true } } },
  });
  if (!intent) return { error: "That need no longer exists" };
  if (intent.status !== "PENDING" && intent.status !== "APPROVED") {
    return { error: "Only a need nobody has ordered against can be withdrawn" };
  }
  if (intent.requestedById !== user.id && resolveStockScope(user) !== "all") {
    return { error: "Only the person who raised this can withdraw it" };
  }

  await prisma.purchaseIntent.update({
    where: { id },
    data: { status: "CANCELLED", reviewedById: user.id, reviewedAt: new Date() },
  });

  await logActivity(
    "CANCELLED",
    "PurchaseIntent",
    id,
    `Withdrew ${intent.intentNumber} for ${intent.quantity} × ${intent.product.name}`
  );

  revalidatePath("/procurement");
  return { success: true };
}

/**
 * Needs that can go onto an order.
 *
 * When the verification step is switched off, a need is orderable the moment it
 * is raised — there is nobody to wait for.
 */
export async function getOrderableIntents() {
  await requirePermission(PERMISSIONS.PROCUREMENT_PO_CREATE);

  const { requiresApproval } = await getProcurementFlow();
  const statuses = requiresApproval
    ? (["APPROVED"] as const)
    : (["APPROVED", "PENDING"] as const);

  const intents = await prisma.purchaseIntent.findMany({
    where: { status: { in: [...statuses] } },
    include: {
      product: { select: { id: true, code: true, name: true, unit: true } },
      vendor: { select: { id: true, name: true } },
      department: { select: { name: true } },
      location: { select: { id: true, name: true } },
      requestedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return intents.map((i) => ({
    id: i.id,
    intentNumber: i.intentNumber,
    quantity: i.quantity,
    productId: i.product.id,
    productCode: i.product.code,
    productName: i.product.name,
    unit: i.product.unit,
    vendorId: i.vendor?.id ?? null,
    vendorName: i.vendor?.name ?? null,
    locationId: i.location?.id ?? null,
    departmentName: i.department?.name ?? null,
    requestedByName: i.requestedBy.name,
    neededBy: i.neededBy,
  }));
}

/* ------------------------------------------------------------------------- */
/* Purchase orders                                                           */
/* ------------------------------------------------------------------------- */

export async function createPurchaseOrder(data: unknown) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_PO_CREATE);

  const parsed = createPurchaseOrderSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { vendorId, locationId, expectedDate, notes, lines } = parsed.data;

  const [vendor, location] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true, isActive: true } }),
    prisma.location.findUnique({ where: { id: locationId }, select: { name: true } }),
  ]);
  if (!vendor || !vendor.isActive) return { error: "That vendor is not on the list" };
  if (!location) return { error: "That site no longer exists" };

  // A need can only be ordered once — otherwise two orders quietly cover the
  // same request and twice the goods arrive.
  const intentIds = lines.map((l) => l.intentId).filter((v): v is string => Boolean(v));
  if (new Set(intentIds).size !== intentIds.length) return { error: "The same need is on the order twice" };
  // With verification on, only verified needs can be ordered; with it off, a
  // waiting one can too. Each line must be for the product its need asked for.
  const { requiresApproval } = await getProcurementFlow();
  const orderable: ("PENDING" | "APPROVED")[] = requiresApproval ? ["APPROVED"] : ["PENDING", "APPROVED"];
  const intents = intentIds.length
    ? await prisma.purchaseIntent.findMany({
        where: { id: { in: intentIds } },
        select: { id: true, intentNumber: true, status: true, productId: true, requestedById: true, product: { select: { name: true } } },
      })
    : [];
  for (const line of lines) {
    if (!line.intentId) continue;
    const intent = intents.find((i) => i.id === line.intentId);
    if (!intent) return { error: "One of those needs no longer exists — refresh and try again" };
    if (!(orderable as string[]).includes(intent.status)) {
      return {
        error: intent.status === "PENDING"
          ? `${intent.intentNumber} has not been verified yet`
          : `${intent.intentNumber} is already ${intent.status.toLowerCase()} — refresh and try again`,
      };
    }
    if (intent.productId !== line.productId) return { error: `${intent.intentNumber} is for a different product` };
  }

  const poNumber = await nextReference("PO");

  // Each line is due its own lead time after today. The order as a whole is
  // expected when its last line is — unless a date was given for the order.
  const orderedAt = new Date();
  const lineDue = lines.map((l) => (l.leadTimeDays !== undefined ? dueDate(orderedAt, l.leadTimeDays) : null));
  const lastDue = lineDue.reduce<Date | null>((latest, d) => (d && (!latest || d > latest) ? d : latest), null);

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.purchaseOrder.create({
      data: {
        poNumber,
        vendorId,
        locationId,
        createdAt: orderedAt,
        expectedDate: expectedDate ? new Date(expectedDate) : lastDue,
        notes: notes?.trim() || null,
        createdById: user.id,
        lines: {
          create: lines.map((l, i) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            intentId: l.intentId || null,
            notes: l.notes?.trim() || null,
            leadTimeDays: l.leadTimeDays ?? null,
            expectedBy: lineDue[i],
          })),
        },
      },
    });

    if (intentIds.length > 0) {
      // Conditional, so two orders placed at the same moment cannot both take
      // the same need: the second finds it no longer orderable and rolls back
      const taken = await tx.purchaseIntent.updateMany({
        where: { id: { in: intentIds }, status: { in: orderable } },
        data: { status: "ORDERED" },
      });
      if (taken.count !== intentIds.length) throw new Error("NEED_TAKEN");
    }

    return created;
  }).catch((e: Error) => {
    if (e.message === "NEED_TAKEN") return null;
    throw e;
  });
  if (!order) return { error: "One of those needs was ordered by someone else just now — refresh and try again" };

  for (const intent of intents) {
    await needDecided({ intentNumber: intent.intentNumber, productName: intent.product.name, requestedById: intent.requestedById }, "ordered", `on ${order.poNumber}`);
  }

  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  await logActivity(
    "CREATED",
    "PurchaseOrder",
    order.id,
    `Raised ${order.poNumber} to ${vendor.name} for ${location.name} — ${lines.length} line${lines.length === 1 ? "" : "s"}, ₹${total.toFixed(2)}`
  );

  revalidatePath("/procurement");
  revalidatePath("/stock");
  return { success: true, order };
}

/** Shape one order, with delivered and outstanding derived per line. */
function shapeOrder(
  order: {
    id: string;
    poNumber: string;
    status: string;
    expectedDate: Date | null;
    notes: string | null;
    closeReason: string | null;
    createdAt: Date;
    closedAt: Date | null;
    vendor: { id: string; name: string };
    location: { id: string; name: string };
    createdBy: { name: string };
    closedBy: { name: string } | null;
    lines: {
      id: string;
      quantity: number;
      unitPrice: number;
      notes: string | null;
      leadTimeDays: number | null;
      expectedBy: Date | null;
      product: { id: string; code: string; name: string; unit: string };
      intent: { intentNumber: string } | null;
      stockEntries: { quantity: number; createdAt: Date }[];
    }[];
  },
  canSeeValue: boolean,
  /** Lead time on record per "productId|vendorId", to spot one that needs updating */
  recordedLeadTimes: Map<string, number> = new Map()
) {
  const lines = order.lines.map((l) => {
    const delivered = l.stockEntries.reduce((sum, e) => sum + e.quantity, 0);
    const timing = lineTiming({
      quantity: l.quantity,
      expectedBy: l.expectedBy,
      orderedAt: order.createdAt,
      deliveries: l.stockEntries.map((e) => ({ quantity: e.quantity, at: e.createdAt })),
    });
    const recorded = recordedLeadTimes.get(`${l.product.id}|${order.vendor.id}`) ?? null;
    return {
      leadTimeDays: l.leadTimeDays,
      expectedBy: l.expectedBy,
      timing,
      recordedLeadTime: recorded,
      /** Set when this vendor took clearly longer than their recorded lead time */
      suggestedLeadTime: suggestedLeadTime(recorded, timing.tookDays),
      id: l.id,
      productId: l.product.id,
      productCode: l.product.code,
      productName: l.product.name,
      unit: l.product.unit,
      quantity: l.quantity,
      delivered,
      outstanding: Math.max(0, l.quantity - delivered),
      // Prices are a commercial detail, not a receiving detail
      unitPrice: canSeeValue ? l.unitPrice : null,
      lineTotal: canSeeValue ? l.quantity * l.unitPrice : null,
      intentNumber: l.intent?.intentNumber ?? null,
      notes: l.notes,
    };
  });

  const outstanding = lines.reduce((sum, l) => sum + l.outstanding, 0);

  return {
    id: order.id,
    poNumber: order.poNumber,
    status: order.status as "OPEN" | "CLOSED" | "CANCELLED",
    vendorId: order.vendor.id,
    vendorName: order.vendor.name,
    locationId: order.location.id,
    locationName: order.location.name,
    expectedDate: order.expectedDate,
    notes: order.notes,
    closeReason: order.closeReason,
    createdAt: order.createdAt,
    closedAt: order.closedAt,
    createdByName: order.createdBy.name,
    closedByName: order.closedBy?.name ?? null,
    lines,
    outstanding,
    /** Nothing left to come, whatever the stored status says */
    fullyDelivered: outstanding === 0,
    /** Some but not all — the state the operator cares about */
    partiallyDelivered:
      outstanding > 0 && lines.some((l) => l.delivered > 0),
    total: canSeeValue
      ? lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0)
      : null,
  };
}

const orderInclude = {
  vendor: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  closedBy: { select: { name: true } },
  lines: {
    include: {
      product: { select: { id: true, code: true, name: true, unit: true } },
      intent: { select: { intentNumber: true } },
      stockEntries: { where: deliveredEntriesWhere, select: { quantity: true, createdAt: true } },
    },
  },
} as const;

/**
 * Every order the caller may see.
 *
 * Location narrows, as everywhere: someone attached to a site sees the orders
 * coming to that site. Prices are stripped unless they hold the value key.
 */
export async function getPurchaseOrders() {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_PO_VIEW);
  const canSeeValue = user.permissions.includes(PERMISSIONS.PROCUREMENT_VALUE_VIEW);

  const seesEverySite = resolveStockScope(user) === "all";
  const orders = await prisma.purchaseOrder.findMany({
    // With no site on record, someone limited to their site sees none
    where: seesEverySite ? {} : { locationId: user.locationId ?? NO_SITE },
    include: orderInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  // Recorded lead times for every product–vendor pair on these orders
  const pairs = await prisma.productVendor.findMany({
    where: {
      OR: orders.flatMap((o) => o.lines.map((l) => ({ productId: l.product.id, vendorId: o.vendor.id }))),
    },
    select: { productId: true, vendorId: true, leadTimeDays: true },
  });
  const recorded = new Map(pairs.map((p) => [`${p.productId}|${p.vendorId}`, p.leadTimeDays]));

  return orders.map((order) => shapeOrder(order, canSeeValue, recorded));
}

/**
 * Lines still expecting goods, for the stock entry form.
 *
 * Gated on stock entry rather than procurement: the person booking a delivery
 * in needs to find the order it belongs to, without being let into the rest of
 * procurement. Prices are deliberately not returned.
 */
export async function getOpenOrderLines() {
  const user = await requireAnyPermission([
    PERMISSIONS.STOCK_CREATE,
    PERMISSIONS.PROCUREMENT_PO_VIEW,
  ]);

  const seesAll = resolveStockScope(user) === "all";
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      status: "OPEN",
      ...(seesAll ? {} : { locationId: user.locationId ?? NO_SITE }),
    },
    include: {
      vendor: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
              category: { select: { id: true, name: true } },
            },
          },
          stockEntries: { where: deliveredEntriesWhere, select: { quantity: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows = [];
  for (const order of orders) {
    for (const line of order.lines) {
      const delivered = line.stockEntries.reduce((sum, e) => sum + e.quantity, 0);
      const outstanding = line.quantity - delivered;
      if (outstanding <= 0) continue;
      rows.push({
        lineId: line.id,
        orderId: order.id,
        poNumber: order.poNumber,
        vendorId: order.vendor.id,
        vendorName: order.vendor.name,
        locationId: order.location.id,
        locationName: order.location.name,
        productId: line.product.id,
        productCode: line.product.code,
        productName: line.product.name,
        unit: line.product.unit,
        categoryId: line.product.category.id,
        categoryName: line.product.category.name,
        ordered: line.quantity,
        delivered,
        outstanding,
      });
    }
  }
  return rows;
}

/**
 * Close an order once nothing more is coming.
 *
 * Called automatically when the last outstanding unit is booked in, and by hand
 * when a vendor simply will not supply the rest — which is why the reason is
 * kept. Closing short does not pretend the goods arrived: the line still shows
 * what was ordered against what came.
 */
export async function closePurchaseOrder(id: string, data: unknown = {}) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_PO_CLOSE);

  const parsed = closePurchaseOrderSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order) return { error: "That order no longer exists" };
  if (order.status !== "OPEN") {
    return { error: `This order is already ${order.status.toLowerCase()}` };
  }
  // Closed by the site it is coming to, like everything else about it
  if (resolveStockScope(user) !== "all" && order.locationId !== user.locationId) {
    return { error: "That order is for another site" };
  }

  const shaped = shapeOrder(order, true);

  await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "CLOSED",
      closeReason: parsed.data.closeReason?.trim() || null,
      closedById: user.id,
      closedAt: new Date(),
    },
  });

  await logActivity(
    "UPDATED",
    "PurchaseOrder",
    id,
    shaped.fullyDelivered
      ? `Closed ${order.poNumber} — everything delivered`
      : `Closed ${order.poNumber} short with ${shaped.outstanding} unit${shaped.outstanding === 1 ? "" : "s"} outstanding${parsed.data.closeReason ? `: ${parsed.data.closeReason.trim()}` : ""}`
  );

  revalidatePath("/procurement");
  return { success: true };
}

/** Withdraw an order nothing has arrived against. */
export async function cancelPurchaseOrder(id: string, data: unknown = {}) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_PO_CLOSE);

  const parsed = closePurchaseOrderSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: orderInclude,
  });
  if (!order) return { error: "That order no longer exists" };
  if (order.status !== "OPEN") {
    return { error: `This order is already ${order.status.toLowerCase()}` };
  }
  // Closed by the site it is coming to, like everything else about it
  if (resolveStockScope(user) !== "all" && order.locationId !== user.locationId) {
    return { error: "That order is for another site" };
  }

  const shaped = shapeOrder(order, true);
  if (shaped.lines.some((l) => l.delivered > 0)) {
    return {
      error:
        "Some of this order has already arrived — close it instead, so what was delivered stays on the record",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: "CANCELLED",
        closeReason: parsed.data.closeReason?.trim() || null,
        closedById: user.id,
        closedAt: new Date(),
      },
    });

    // The needs behind it were never met, so they go back to being needs
    const intentIds = order.lines
      .map((l) => l.intentId)
      .filter((v): v is string => Boolean(v));
    if (intentIds.length > 0) {
      await tx.purchaseIntent.updateMany({
        where: { id: { in: intentIds }, status: "ORDERED" },
        data: { status: "APPROVED" },
      });
    }
  });

  await logActivity(
    "CANCELLED",
    "PurchaseOrder",
    id,
    `Cancelled ${order.poNumber}${parsed.data.closeReason ? `: ${parsed.data.closeReason.trim()}` : ""}`
  );

  revalidatePath("/procurement");
  return { success: true };
}

/**
 * Vendors and sites for the order form, and every recorded lead time so each
 * line can start with what that vendor usually takes for that product.
 */
export async function getPurchaseOrderFormData() {
  await requirePermission(PERMISSIONS.PROCUREMENT_PO_CREATE);

  const [vendors, locations, leadTimes] = await Promise.all([
    prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.productVendor.findMany({ select: { productId: true, vendorId: true, leadTimeDays: true } }),
  ]);

  return { vendors, locations, leadTimes };
}

/** Catalog for stating a need — raw materials are what gets bought in. */
export async function getIntentFormData() {
  await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_CREATE);

  const [products, vendors, locations] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        unit: true,
        kind: true,
        category: { select: { name: true } },
        subcategory: { select: { name: true } },
        // So the dialog can pre-pick the preferred vendor and show lead times
        vendors: { select: { vendorId: true, leadTimeDays: true, isPreferred: true } },
      },
      orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
    }),
    prisma.vendor.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    products: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      unit: p.unit,
      kind: p.kind,
      category: p.category,
      subcategory: p.subcategory,
      suppliers: p.vendors,
    })),
    vendors,
    locations,
  };
}

/**
 * Pending needs waiting on this person, for the dashboard review queue.
 */
export async function getReviewableIntents() {
  await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_APPROVE);

  const intents = await prisma.purchaseIntent.findMany({
    where: { status: "PENDING" },
    include: {
      product: { select: { name: true, unit: true } },
      department: { select: { name: true } },
      requestedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return intents.map((i) => ({
    kind: "PURCHASE_INTENT" as const,
    id: i.id,
    title: `${i.quantity} ${i.product.unit} · ${i.product.name}`,
    subtitle: `${i.intentNumber} · ${i.requestedBy.name}${i.department ? ` (${i.department.name})` : ""}`,
    href: "/procurement",
  }));
}
