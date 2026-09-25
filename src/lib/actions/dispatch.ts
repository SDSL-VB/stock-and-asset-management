"use server";

import { prisma } from "@/lib/prisma";
import { nextReference } from "@/lib/reference-numbers";
import {
  requirePermission,
  requireAnyPermission,
  resolveStockScope,
} from "@/lib/rbac/check";
import { PERMISSIONS, DISPATCH_PERMISSIONS } from "@/lib/rbac/permissions";
import {
  createDispatchSchema,
  rejectDispatchSchema,
} from "@/lib/validations/dispatch";
import {
  availableQuantity,
  availabilityInclude,
} from "@/lib/stock-availability";
import { SELF_APPROVAL_REFUSAL } from "@/lib/review-rules";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";
import { lockEntries } from "@/lib/stock-locks";
import { NO_SITE } from "@/lib/stock-visibility";
import { toCsv } from "@/lib/csv";
import { DISPATCH_STATUS_LABEL } from "@/lib/vocabulary";
import { renderDispatchReceiptPdf } from "@/lib/dispatch-receipt-pdf";

/**
 * FLOW: goods leaving — to another site, or to a client.
 *
 *   TO ANOTHER SITE
 *   1. createDispatch       origin picks stock and raises it → PENDING
 *   2. acceptDispatch       the DESTINATION agrees → IN_TRANSIT
 *      rejectDispatch       or refuses it, with a reason
 *   3. markDispatchReceived arrival is confirmed → RECEIVED, and the stock is
 *                           booked in as central stock at the destination, so
 *                           every existing query sees it with no special case.
 *
 *   TO A CLIENT
 *   Starts at IN_TRANSIT — there is nobody at the far end to accept — and is
 *   received when it lands. Goods bought to ship straight to a customer raise
 *   theirs automatically when the entry is approved; see client-dispatch.ts.
 *
 *   EITHER WAY
 *   cancelDispatch  the origin withdraws it.
 *   Neither cancelling nor rejecting touches stock: the committed quantity
 *   frees itself, because those statuses are simply not counted as committing.
 *   And nobody may accept or reject a consignment they raised themselves.
 */

/** Dispatches visible to the caller — their own site both ways, or everything. */
export async function getDispatches() {
  const user = await requireAnyPermission(DISPATCH_PERMISSIONS);

  const scope = resolveStockScope(user);
  const where: Record<string, unknown> = {};

  if (scope !== "all") {
    // An operator sees consignments leaving their site and arriving at it.
    // With no site on record they see none — never every site.
    const site = user.locationId ?? NO_SITE;
    where.OR = [{ originLocationId: site }, { toLocationId: site }];
  }

  const canSeeClientDetail = user.permissions.includes(PERMISSIONS.CLIENTS_VIEW);
  // What the consignment is worth is its own grant, exactly as on a stock
  // entry: quantities are readable by everyone who can see the consignment.
  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);

  const dispatches = await prisma.dispatch.findMany({
    where,
    include: {
      originLocation: { select: { id: true, name: true } },
      toLocation: { select: { id: true, name: true } },
      client: {
        select: { id: true, name: true, city: true, gstNumber: true, address: true },
      },
      createdBy: { select: { name: true } },
      acceptedBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: {
        include: {
          stockEntry: {
            select: { id: true, entryNumber: true, itemCode: true, itemName: true, unitPrice: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return dispatches.map((d) => ({
    id: d.id,
    dispatchNumber: d.dispatchNumber,
    destination: d.destination,
    status: d.status,
    notes: d.notes,
    rejectionReason: d.rejectionReason,
    originLocationId: d.originLocationId,
    originLocationName: d.originLocation.name,
    toLocationId: d.toLocationId,
    toLocationName: d.toLocation?.name ?? null,
    createdByName: d.createdBy.name,
    acceptedByName: d.acceptedBy?.name ?? null,
    receivedByName: d.receivedBy?.name ?? null,
    createdAt: d.createdAt,
    receivedAt: d.receivedAt,
    // GST number and address are their own grant (clients.view); the name and
    // city stay visible so the list is readable without it.
    client: d.client
      ? {
          id: d.client.id,
          name: d.client.name,
          city: d.client.city,
          gstNumber: canSeeClientDetail ? d.client.gstNumber : null,
          address: canSeeClientDetail ? d.client.address : null,
        }
      : null,
    canSeeClientDetail,
    // What it is worth: each line at the price the goods were booked in at,
    // and the consignment as the sum. Taken from the source entry rather than
    // stored, so it cannot drift from what the entry says — the same price
    // markDispatchReceived() gives the entry it creates at the far end.
    items: d.items.map((i) => ({
      id: i.id,
      batchNumber: i.batchNumber,
      quantity: i.quantity,
      isAsset: i.isAsset,
      entryId: i.stockEntry.id,
      entryNumber: i.stockEntry.entryNumber,
      itemCode: i.stockEntry.itemCode,
      itemName: i.stockEntry.itemName,
      unitPrice: canSeeValue ? i.stockEntry.unitPrice : null,
      value: canSeeValue ? i.quantity * i.stockEntry.unitPrice : null,
    })),
    totalValue: canSeeValue
      ? d.items.reduce((sum, i) => sum + i.quantity * i.stockEntry.unitPrice, 0)
      : null,
  }));
}

/**
 * Counts for the dashboard, so a dispatch operator lands on something useful
 * rather than an empty page. Scoped exactly like the dispatch list.
 */
export async function getDispatchDashboardCounts() {
  const user = await requireAnyPermission(DISPATCH_PERMISSIONS);

  const scope = resolveStockScope(user);
  const site = user.locationId ?? NO_SITE;
  const mine = scope !== "all" ? { OR: [{ originLocationId: site }, { toLocationId: site }] } : {};

  const [awaitingAcceptance, inTransit, deliveredThisMonth] = await Promise.all([
    prisma.dispatch.count({ where: { ...mine, status: "PENDING" } }),
    prisma.dispatch.count({ where: { ...mine, status: "IN_TRANSIT" } }),
    prisma.dispatch.count({
      where: {
        ...mine,
        status: "RECEIVED",
        receivedAt: { gte: new Date(new Date().setDate(1)) },
      },
    }),
  ]);

  return { awaitingAcceptance, inTransit, deliveredThisMonth };
}

/** Approved central stock at the caller's site that can still be sent out. */
export async function getDispatchableStock(originLocationId?: string) {
  const user = await requirePermission(PERMISSIONS.DISPATCH_CREATE);

  const scope = resolveStockScope(user);
  const where: Record<string, unknown> = { status: "APPROVED", departmentId: null };
  // Everyone else dispatches only from their own site — with none, nothing
  const originId = scope === "all" ? originLocationId : user.locationId ?? NO_SITE;
  if (originId) {
    where.locationId = originId;
  }

  const entries = await prisma.stockEntry.findMany({
    where,
    select: {
      id: true,
      entryNumber: true,
      itemCode: true,
      itemName: true,
      quantity: true,
      locationId: true,
      location: { select: { name: true } },
      ...availabilityInclude,
    },
    orderBy: { createdAt: "desc" },
  });

  return entries
    .map((e) => ({
      id: e.id,
      entryNumber: e.entryNumber,
      itemCode: e.itemCode,
      itemName: e.itemName,
      locationId: e.locationId,
      locationName: e.location?.name ?? null,
      available: availableQuantity(e),
    }))
    .filter((e) => e.available > 0);
}

export async function createDispatch(data: unknown) {
  const user = await requirePermission(PERMISSIONS.DISPATCH_CREATE);

  const parsed = createDispatchSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { originLocationId, destination, toLocationId, clientId, notes, items } =
    parsed.data;

  // Location narrows, it never blocks: a user with cross-location scope has no
  // location of their own and picks the origin instead.
  const seesAllLocations = resolveStockScope(user) === "all";
  const originId = seesAllLocations ? originLocationId || user.locationId : user.locationId;

  if (!originId) {
    return {
      error: seesAllLocations
        ? "Please choose which location this is dispatched from"
        : "You are not attached to a location. A dispatch operator must belong to a department at the site they dispatch from.",
    };
  }

  if (destination === "LOCATION" && toLocationId === originId) {
    return { error: "The destination must be a different location" };
  }

  // One line per stock entry — two lines drawing on the same entry would each
  // be checked against the same free quantity
  const entryIds = items.map((i) => i.stockEntryId);
  if (new Set(entryIds).size !== entryIds.length) {
    return { error: "The same stock is on two lines — put it on one line with the total" };
  }

  const dispatchNumber = await nextReference("DSP");

  // A client dispatch has nobody to accept it, so it leaves as in transit.
  const status = destination === "CLIENT" ? "IN_TRANSIT" : "PENDING";

  // Checked and taken in one transaction, with the entries locked, so two
  // dispatches raised at the same moment cannot both take the last units
  const outcome = await prisma.$transaction(async (tx) => {
    await lockEntries(tx, entryIds);

    for (const item of items) {
      const entry = await tx.stockEntry.findUnique({
        where: { id: item.stockEntryId },
        select: {
          itemName: true,
          quantity: true,
          status: true,
          departmentId: true,
          locationId: true,
          ...availabilityInclude,
        },
      });
      if (!entry) return { error: "One of the selected items no longer exists" };
      if (entry.status !== "APPROVED" || entry.departmentId !== null) {
        return { error: `${entry.itemName} is not available in central stock` };
      }
      if (entry.locationId !== originId) {
        return { error: `${entry.itemName} is not held at your location` };
      }
      const available = availableQuantity(entry);
      if (item.quantity > available) {
        return { error: `Only ${available} of ${entry.itemName} is available — you asked for ${item.quantity}` };
      }
    }

    // A line carries the batch of the stock it draws from — never a new number.
    // Two consignments of one batch therefore always agree.
    const sourceBatches = new Map(
      (
        await tx.stockEntry.findMany({
          where: { id: { in: entryIds } },
          select: { id: true, batchNumber: true },
        })
      ).map((e) => [e.id, e.batchNumber])
    );

    const created = await tx.dispatch.create({
      data: {
        dispatchNumber,
        originLocationId: originId,
        destination,
        toLocationId: destination === "LOCATION" ? toLocationId : null,
        clientId: destination === "CLIENT" ? clientId : null,
        status,
        notes: notes?.trim() || null,
        createdById: user.id,
        items: {
          create: items.map((item) => ({
            stockEntryId: item.stockEntryId,
            quantity: item.quantity,
            isAsset: item.isAsset ?? false,
            batchNumber: sourceBatches.get(item.stockEntryId) ?? null,
          })),
        },
      },
      include: {
        toLocation: { select: { name: true } },
        client: { select: { name: true, city: true } },
      },
    });
    return { dispatch: created };
  });
  if ("error" in outcome) return { error: outcome.error };
  const { dispatch } = outcome;

  const target =
    dispatch.destination === "CLIENT"
      ? `${dispatch.client?.name} (${dispatch.client?.city})`
      : dispatch.toLocation?.name;

  await logActivity(
    "DISPATCHED",
    "Dispatch",
    dispatch.id,
    `Raised dispatch ${dispatch.dispatchNumber} to ${target} — ${items.length} line${items.length === 1 ? "" : "s"}`
  );

  revalidatePath("/dispatch");
  revalidatePath("/stock");
  return { success: true, dispatch };
}

export async function acceptDispatch(id: string) {
  const user = await requirePermission(PERMISSIONS.DISPATCH_ACCEPT);

  const dispatch = await prisma.dispatch.findUnique({ where: { id } });
  if (!dispatch) return { error: "Dispatch not found" };
  if (dispatch.status !== "PENDING") {
    return { error: "Only a pending dispatch can be accepted" };
  }
  if (dispatch.destination !== "LOCATION") {
    return { error: "Only a location-to-location dispatch needs accepting" };
  }
  // Only the receiving site accepts — unless the viewer sees every location
  if (
    resolveStockScope(user) !== "all" &&
    dispatch.toLocationId !== user.locationId
  ) {
    return { error: "Only the destination location can accept this dispatch" };
  }
  if (dispatch.createdById === user.id) {
    return { error: SELF_APPROVAL_REFUSAL };
  }

  const updated = await prisma.dispatch.update({
    where: { id },
    data: { status: "IN_TRANSIT", acceptedById: user.id, acceptedAt: new Date() },
  });

  await logActivity(
    "ACCEPTED",
    "Dispatch",
    id,
    `Accepted dispatch ${updated.dispatchNumber} — now in transit`
  );

  revalidatePath("/dispatch");
  return { success: true };
}

export async function rejectDispatch(id: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.DISPATCH_ACCEPT);

  const parsed = rejectDispatchSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const dispatch = await prisma.dispatch.findUnique({ where: { id } });
  if (!dispatch) return { error: "Dispatch not found" };
  // In transit counts too: goods that arrive damaged or wrong have to be
  // refusable, otherwise the only way to record reality is to receive them
  // and then try to unpick it.
  if (dispatch.status !== "PENDING" && dispatch.status !== "IN_TRANSIT") {
    return { error: "Only a dispatch that has not yet been received can be rejected" };
  }
  if (
    resolveStockScope(user) !== "all" &&
    dispatch.toLocationId !== user.locationId
  ) {
    return { error: "Only the destination location can reject this dispatch" };
  }
  // Withdrawing your own consignment is "Cancel", which is a different act with
  // its own permission and does not pretend the destination refused it.
  if (dispatch.createdById === user.id) {
    return { error: SELF_APPROVAL_REFUSAL };
  }

  const updated = await prisma.dispatch.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason: parsed.data.rejectionReason.trim(),
      acceptedById: user.id,
    },
  });

  await logActivity(
    "REJECTED",
    "Dispatch",
    id,
    `Rejected dispatch ${updated.dispatchNumber}: ${updated.rejectionReason}`
  );

  await reopenSiteRequestFor(id, `refused as ${updated.dispatchNumber}`);

  // Rejecting releases the quantity back into the origin's central stock
  revalidatePath("/dispatch");
  revalidatePath("/stock");
  revalidatePath("/builds");
  return { success: true };
}

/**
 * A consignment raised against a site request never arrived, so the ask is
 * still live — it goes back to waiting rather than being closed. The holding
 * site can answer it again without the other site having to ask twice.
 *
 * Does nothing for the ordinary case, where no request is attached.
 */
async function reopenSiteRequestFor(dispatchId: string, what: string) {
  const request = await prisma.siteRequest.findUnique({
    where: { dispatchId },
    select: { id: true, requestNumber: true },
  });
  if (!request) return;

  await prisma.siteRequest.update({
    where: { id: request.id },
    data: {
      status: "PENDING",
      dispatchId: null,
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
    },
  });

  await logActivity(
    "UPDATED",
    "SiteRequest",
    request.id,
    `${request.requestNumber} is waiting again — the consignment sent for it was ${what}`
  );
}

/**
 * The origin withdrawing a consignment it should not have sent.
 *
 * Distinct from rejecting: rejecting is the destination refusing goods, this is
 * the sender recalling them. It is the only exit for a client dispatch, which
 * has no destination operator to refuse it, and for anything already in
 * transit. Stock returns to the origin automatically, because availability is
 * derived from status and CANCELLED does not commit anything.
 */
export async function cancelDispatch(id: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.DISPATCH_CREATE);

  const parsed = rejectDispatchSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const dispatch = await prisma.dispatch.findUnique({ where: { id } });
  if (!dispatch) return { error: "Dispatch not found" };
  if (dispatch.status !== "PENDING" && dispatch.status !== "IN_TRANSIT") {
    return {
      error:
        dispatch.status === "RECEIVED"
          ? "This has already been received — the stock is booked in at the destination"
          : `This dispatch is already ${dispatch.status.toLowerCase()}`,
    };
  }
  if (
    resolveStockScope(user) !== "all" &&
    dispatch.originLocationId !== user.locationId
  ) {
    return { error: "Only the site that sent this can withdraw it" };
  }

  const updated = await prisma.dispatch.update({
    where: { id },
    data: {
      status: "CANCELLED",
      rejectionReason: parsed.data.rejectionReason.trim(),
    },
  });

  await logActivity(
    "CANCELLED",
    "Dispatch",
    id,
    `Withdrew dispatch ${updated.dispatchNumber}: ${updated.rejectionReason}`
  );

  await reopenSiteRequestFor(id, `withdrawn as ${updated.dispatchNumber}`);

  revalidatePath("/dispatch");
  revalidatePath("/stock");
  revalidatePath("/builds");
  return { success: true };
}

/**
 * Confirms arrival. For a location-to-location consignment this is also where
 * the stock becomes real at the destination: each line is booked in as an
 * approved central stock entry there, so every existing stock query — reports,
 * transfers, assets — sees it without special-casing dispatches.
 */
export async function markDispatchReceived(id: string) {
  const user = await requirePermission(PERMISSIONS.DISPATCH_RECEIVE);

  const dispatch = await prisma.dispatch.findUnique({
    where: { id },
    include: {
      items: { include: { stockEntry: true } },
      toLocation: { select: { name: true } },
      client: { select: { name: true } },
    },
  });
  if (!dispatch) return { error: "Dispatch not found" };
  if (dispatch.status !== "IN_TRANSIT") {
    return { error: "Only a dispatch in transit can be marked received" };
  }

  const isForMySite =
    dispatch.destination === "CLIENT"
      ? dispatch.originLocationId === user.locationId
      : dispatch.toLocationId === user.locationId;
  if (resolveStockScope(user) !== "all" && !isForMySite) {
    return { error: "Only the receiving location can mark this dispatch received" };
  }

  const received = await prisma.$transaction(async (tx) => {
    // Claim it first, conditionally: a second press at the same moment finds
    // it no longer in transit and changes nothing, so the goods are never
    // booked in twice at the destination.
    const claimed = await tx.dispatch.updateMany({
      where: { id, status: "IN_TRANSIT" },
      data: { status: "RECEIVED", receivedById: user.id, receivedAt: new Date() },
    });
    if (claimed.count !== 1) return false;

    if (dispatch.destination === "LOCATION" && dispatch.toLocationId) {
      for (const item of dispatch.items) {
        const source = item.stockEntry;

        // The goods were approved at the origin and accepting the consignment
        // is already a second person's deliberate act, so the receiving entry
        // books in APPROVED rather than asking the destination to approve the
        // same goods twice.
        await tx.stockEntry.create({
          data: {
            entryNumber: await nextReference("SE", tx),
            productId: source.productId,
            itemCode: source.itemCode,
            itemName: source.itemName,
            vendorId: source.vendorId,
            supplierName: source.supplierName,
            quantity: item.quantity,
            unitPrice: source.unitPrice,
            totalPrice: item.quantity * source.unitPrice,
            invoiceNumber: source.invoiceNumber,
            locationId: dispatch.toLocationId,
            isAsset: item.isAsset,
            // Carried from the consignment line, not left blank: a batch is
            // only worth stamping if it survives the journey, and a recall
            // starts from the number on the goods at whichever site holds them.
            batchNumber: item.batchNumber,
            // What this stock actually is, and where it came from. Without
            // these two it reads as a fresh purchase from the origin's vendor
            // at a site that never bought anything.
            source: "TRANSFERRED",
            sourceDispatchItemId: item.id,
            status: "APPROVED",
            createdById: user.id,
            approvedById: user.id,
          },
        });
      }
    }

    return true;
  });
  if (!received) return { error: "This dispatch has just been marked received by someone else" };

  const target =
    dispatch.destination === "CLIENT"
      ? dispatch.client?.name
      : dispatch.toLocation?.name;

  await logActivity(
    "RECEIVED",
    "Dispatch",
    id,
    `Confirmed delivery of ${dispatch.dispatchNumber} to ${target}`
  );

  revalidatePath("/dispatch");
  revalidatePath("/stock");
  return { success: true };
}

/**
 * Batch lookup — the point of batch numbers. Given one, return who received
 * that item and how to reach them, so a recall or a service visit can start
 * from the number stamped on the goods.
 */
export async function lookupBatch(batchNumber: string) {
  const user = await requireAnyPermission(DISPATCH_PERMISSIONS);

  const trimmed = batchNumber.trim().toUpperCase();
  if (!trimmed) return { error: "Enter a batch number" };

  // Consignments of the caller's own site, as on the dispatch list
  const site = user.locationId ?? NO_SITE;
  const matches = await prisma.dispatchItem.findMany({
    where: {
      batchNumber: { equals: trimmed, mode: "insensitive" },
      ...(resolveStockScope(user) === "all"
        ? {}
        : { dispatch: { OR: [{ originLocationId: site }, { toLocationId: site }] } }),
    },
    include: {
      stockEntry: {
        select: { entryNumber: true, itemCode: true, itemName: true, supplierName: true },
      },
      dispatch: {
        include: {
          originLocation: { select: { name: true } },
          toLocation: { select: { name: true } },
          client: {
            select: { name: true, city: true, gstNumber: true, address: true },
          },
        },
      },
    },
    orderBy: { dispatch: { createdAt: "desc" } },
  });

  if (matches.length === 0) {
    return { error: `Nothing has shipped carrying batch ${trimmed}` };
  }

  const canSeeClientDetail = user.permissions.includes(PERMISSIONS.CLIENTS_VIEW);
  // What the consignment is worth is its own grant, exactly as on a stock
  // entry: quantities are readable by everyone who can see the consignment.
  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);

  // One batch legitimately goes to several customers, so a recall needs the
  // whole list, not the first row.
  return {
    success: true as const,
    batchNumber: trimmed,
    shipments: matches.map((item) => {
      const d = item.dispatch;
      return {
      batchNumber: item.batchNumber,
      quantity: item.quantity,
      isAsset: item.isAsset,
      itemName: item.stockEntry.itemName,
      itemCode: item.stockEntry.itemCode,
      vendorName: item.stockEntry.supplierName,
      entryNumber: item.stockEntry.entryNumber,
      dispatchNumber: d.dispatchNumber,
      status: d.status,
      dispatchedAt: d.createdAt,
      receivedAt: d.receivedAt,
      originLocationName: d.originLocation.name,
      toLocationName: d.toLocation?.name ?? null,
      client: d.client
        ? {
            name: d.client.name,
            city: d.client.city,
            gstNumber: canSeeClientDetail ? d.client.gstNumber : null,
            address: canSeeClientDetail ? d.client.address : null,
          }
        : null,
      };
    }),
  };
}

/**
 * One consignment as a PDF receipt — what travels with the goods and what a
 * client signs.
 *
 * Reading the consignment is enough to take the receipt: it carries nothing the
 * screen does not already show the same person. Value follows stock.value.view
 * exactly as it does on screen, and is left out of the document entirely
 * without it, so the layout never has to decide anything.
 */
export async function exportDispatchReceipt(id: string) {
  const user = await requireAnyPermission(DISPATCH_PERMISSIONS);
  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);
  const canSeeClientDetail = user.permissions.includes(PERMISSIONS.CLIENTS_VIEW);

  const dispatch = await prisma.dispatch.findUnique({
    where: { id },
    include: {
      originLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      client: { select: { name: true, city: true, gstNumber: true, address: true } },
      createdBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: {
        include: {
          stockEntry: {
            select: { entryNumber: true, itemCode: true, itemName: true, unitPrice: true },
          },
        },
      },
    },
  });
  if (!dispatch) return { error: "That consignment does not exist" };

  // Seen exactly as the list decides: a site's own consignments, or every one
  // for somebody who sees every site. Not visible is reported as not existing.
  const scope = resolveStockScope(user);
  if (scope !== "all") {
    const site = user.locationId ?? NO_SITE;
    if (dispatch.originLocationId !== site && dispatch.toLocationId !== site) {
      return { error: "That consignment does not exist" };
    }
  }

  const lines = dispatch.items.map((i) => ({
    entryNumber: i.stockEntry.entryNumber,
    itemCode: i.stockEntry.itemCode,
    itemName: i.stockEntry.itemName,
    batchNumber: i.batchNumber,
    quantity: i.quantity,
    isAsset: i.isAsset,
    unitPrice: canSeeValue ? i.stockEntry.unitPrice : null,
    value: canSeeValue ? i.quantity * i.stockEntry.unitPrice : null,
  }));

  const bytes = await renderDispatchReceiptPdf({
    dispatchNumber: dispatch.dispatchNumber,
    status: DISPATCH_STATUS_LABEL[dispatch.status] ?? dispatch.status,
    raisedOn: dispatch.createdAt,
    raisedBy: dispatch.createdBy.name,
    from: dispatch.originLocation.name,
    to: dispatch.destination === "CLIENT" ? (dispatch.client?.name ?? "Client") : (dispatch.toLocation?.name ?? "-"),
    toKind: dispatch.destination === "CLIENT" ? "Client" : "Site",
    clientCity: dispatch.client?.city ?? null,
    clientGst: canSeeClientDetail ? (dispatch.client?.gstNumber ?? null) : null,
    clientAddress: canSeeClientDetail ? (dispatch.client?.address ?? null) : null,
    receivedOn: dispatch.receivedAt,
    receivedBy: dispatch.receivedBy?.name ?? null,
    notes: dispatch.notes,
    lines,
    totalValue: canSeeValue ? lines.reduce((sum, l) => sum + (l.value ?? 0), 0) : null,
  });

  await logActivity(
    "EXPORTED",
    "Dispatch",
    dispatch.id,
    `Downloaded the receipt for ${dispatch.dispatchNumber}`
  );

  return { pdf: Buffer.from(bytes).toString("base64"), fileName: `${dispatch.dispatchNumber}.pdf` };
}

/**
 * Dispatch report as CSV. Its own permission, because downloading a movement
 * history is a different act from reading the screen.
 *
 * Money follows the screen exactly: the unit price and line value columns are
 * there for whoever holds stock.value.view and absent for everyone else, so an
 * export can never be the hole in that rule.
 */
export async function exportDispatchReport() {
  const user = await requirePermission(PERMISSIONS.DISPATCH_EXPORT);
  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);

  const scope = resolveStockScope(user);
  const site = user.locationId ?? NO_SITE;
  const where: Record<string, unknown> =
    scope !== "all" ? { OR: [{ originLocationId: site }, { toLocationId: site }] } : {};

  const dispatches = await prisma.dispatch.findMany({
    where,
    include: {
      originLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      client: { select: { name: true, city: true } },
      createdBy: { select: { name: true } },
      acceptedBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: {
        include: {
          stockEntry: { select: { entryNumber: true, itemCode: true, itemName: true, unitPrice: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const headers = [
    "Dispatch Number",
    "Raised On",
    "Status",
    "From",
    "To",
    "Destination Type",
    "Client City",
    "Entry Number",
    "Item Code",
    "Item",
    "Quantity",
    ...(canSeeValue ? ["Unit Price", "Line Value"] : []),
    "Asset",
    "Batch Number",
    "Raised By",
    "Accepted By",
    "Received By",
    "Received On",
    "Notes",
  ];

  // One row per line, so a batch number can be searched in a spreadsheet
  const rows = dispatches.flatMap((d) =>
    d.items.map((i) => [
      d.dispatchNumber,
      new Date(d.createdAt).toLocaleDateString("en-IN"),
      d.status,
      d.originLocation.name,
      d.destination === "CLIENT" ? (d.client?.name ?? "") : (d.toLocation?.name ?? ""),
      d.destination === "CLIENT" ? "Client" : "Location",
      d.destination === "CLIENT" ? (d.client?.city ?? "") : "",
      i.stockEntry.entryNumber,
      i.stockEntry.itemCode ?? "",
      i.stockEntry.itemName,
      i.quantity.toString(),
      ...(canSeeValue
        ? [i.stockEntry.unitPrice.toFixed(2), (i.quantity * i.stockEntry.unitPrice).toFixed(2)]
        : []),
      i.isAsset ? "Yes" : "No",
      i.batchNumber ?? "",
      d.createdBy.name,
      d.acceptedBy?.name ?? "",
      d.receivedBy?.name ?? "",
      d.receivedAt ? new Date(d.receivedAt).toLocaleDateString("en-IN") : "",
      d.notes ?? "",
    ])
  );

  const csv = toCsv(headers, rows);

  await logActivity(
    "EXPORTED",
    "Dispatch",
    undefined,
    `Exported the dispatch report (${rows.length} lines)`
  );

  return { success: true as const, csv, rowCount: rows.length };
}
