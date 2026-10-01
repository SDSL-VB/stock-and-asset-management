"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission, requireAnyPermission, resolveStockScope } from "@/lib/rbac/check";
import { PERMISSIONS, CALLBACKS_PAGE_PERMISSIONS } from "@/lib/rbac/permissions";
import { traceBatch, type TracedCustomer } from "@/lib/batch-trace";
import { approvalRefusal, transferDecisionRefusal } from "@/lib/review-rules";
import { findApprovalFlow, NO_FLOW_CONFIGURED } from "@/lib/approval-flow";
import { nextReference } from "@/lib/reference-numbers";
import { logActivity } from "@/lib/activity-log";
import { notifyHolders } from "@/lib/notifications/notify";
import { entrySubmitted, transferRequested } from "@/lib/notifications/events";
import {
  COMMITTING_DISPATCH_STATUSES,
  availableFromIssue,
  issueDrawdownsInclude,
} from "@/lib/stock-availability";
import { approveTransferRequest } from "./assets";
import { createDispatch } from "./dispatch";
import { NO_SITE } from "@/lib/stock-visibility";
import { revalidatePath } from "next/cache";

/**
 * Call-backs, and parts swapped at a customer's premises.
 *
 *   raise    callbacks.raise (the Production Manager), for any reason, on a
 *            batch — a finished good, or a semi-finished one inside them.
 *            What is still in central stock at the raiser's site is asked
 *            back into their department as ordinary transfer requests, which
 *            the Stock Manager approves (raise-and-approve if the raiser may).
 *            Every customer who has it — directly, through builds, or by a
 *            swap — is traced, and Service is told: at the sites that sent it,
 *            or at every site when asked.
 *   return   callbacks.receive books goods a customer sent back in as a
 *            CALLBACK stock entry; the Stock Manager approves it as usual.
 *   swap     service.swap records a part swapped into a customer's product on
 *            site — sent from service stock (which raises the consignment), or
 *            by central stock on a consignment it sent. The part's batch is
 *            recorded against the customer's product, so the next call-back of
 *            either finds it.
 *
 * After rework, Production changes the batch number if it needs to
 * (stock.batch.edit), or leaves it.
 */

const raiseSchema = z.object({
  batchNumber: z.string().trim().min(1, "Enter the batch").max(60, "That batch number is too long"),
  reason: z.string().trim().min(3, "Say why").max(500, "Keep the reason under 500 characters"),
  notifyAllSites: z.boolean().optional(),
});

function revalidateAll() {
  revalidatePath("/callbacks");
  revalidatePath("/assets");
  revalidatePath("/stock");
  revalidatePath("/dashboard");
}

export async function raiseCallBack(data: unknown) {
  const user = await requirePermission(PERMISSIONS.CALLBACKS_RAISE);
  const parsed = raiseSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Called-back goods go to the raiser's own department, at its site
  if (!user.departmentId) return { error: "You are not in a department to call goods back into" };
  const department = await prisma.department.findUnique({
    where: { id: user.departmentId },
    select: { id: true, name: true, locationId: true, isActive: true, isCentralStock: true },
  });
  if (!department?.isActive || !department.locationId || department.isCentralStock) {
    return { error: "Your department cannot take called-back goods" };
  }

  const batch = parsed.data.batchNumber;
  const first = await prisma.stockEntry.findFirst({
    where: { batchNumber: { equals: batch, mode: "insensitive" } },
    select: { productId: true, batchNumber: true },
    orderBy: { createdAt: "asc" },
  });
  if (!first) return { error: `No stock has ever carried batch ${batch}` };

  const callBack = await prisma.callBack.create({
    data: {
      callBackNumber: await nextReference("CB"),
      batchNumber: first.batchNumber ?? batch,
      productId: first.productId,
      reason: parsed.data.reason,
      notifyAllSites: parsed.data.notifyAllSites ?? false,
      locationId: department.locationId,
      departmentId: department.id,
      raisedById: user.id,
    },
  });
  await logActivity("CREATED", "CallBack", callBack.id, `Called back batch ${callBack.batchNumber} (${callBack.callBackNumber}) — ${callBack.reason}`);

  const trace = await traceBatch(callBack.batchNumber);

  // Still in central stock at this site: ask it back into the department.
  // Other sites keep theirs — moving between sites needs its own permission.
  let asked = 0;
  for (const holding of trace.central.filter((h) => h.locationId === department.locationId)) {
    const quantity = Math.floor(holding.available);
    if (quantity < 1) continue;
    const request = await prisma.stockTransferRequest.create({
      data: {
        requestNumber: await nextReference("TR"),
        stockEntryId: holding.entryId,
        departmentId: department.id,
        quantity,
        isAsset: false,
        notes: `Call-back ${callBack.callBackNumber}: ${callBack.reason}`.slice(0, 500),
        callBackId: callBack.id,
        requestedById: user.id,
        // Production called it back itself, so only the Stock Manager's step remains
        departmentApprovedById: user.id,
        departmentApprovedAt: new Date(),
      },
    });
    asked++;
    // Raise what you may approve — through the approve action itself
    if (transferDecisionRefusal(user, { departmentId: department.id, siteId: department.locationId }) === null) {
      const approved = await approveTransferRequest(request.id);
      if ("success" in approved && approved.success) continue;
    }
    await transferRequested({ requestNumber: request.requestNumber, itemName: holding.itemName, requestedById: user.id, locationId: department.locationId });
  }

  // Customers who have it: Service follows up
  if (trace.customers.length > 0) {
    const message = {
      kind: "ACTION" as const,
      title: `Call-back ${callBack.callBackNumber}: batch ${callBack.batchNumber}`,
      body: `${new Set(trace.customers.map((c) => c.clientId)).size} customer(s) to follow up — ${callBack.reason}`.slice(0, 300),
      href: "/callbacks",
    };
    if (callBack.notifyAllSites) {
      await notifyHolders(PERMISSIONS.CALLBACKS_VIEW, { exclude: [user.id] }, message);
    } else {
      const sites = new Set(trace.customers.map((c) => c.originLocationId).filter((s): s is string => !!s));
      for (const site of sites) await notifyHolders(PERMISSIONS.CALLBACKS_VIEW, { locationId: site, exclude: [user.id] }, message);
    }
  }

  revalidateAll();
  return {
    success: true,
    callBackNumber: callBack.callBackNumber,
    customers: new Set(trace.customers.map((c) => c.clientId)).size,
    askedBack: asked,
  };
}

/**
 * Call-backs this person may see, each traced live. Someone who sees every site
 * sees all; anyone else sees those raised at their site, those sent to every
 * site, and those reaching a customer their site dispatched to. Addresses and
 * GST numbers only for those who may see clients.
 */
export async function getCallBacks() {
  const user = await requireAnyPermission(CALLBACKS_PAGE_PERMISSIONS);
  const all = resolveStockScope(user) === "all";
  const site = user.locationId ?? NO_SITE;
  const showClientDetail = user.permissions.includes(PERMISSIONS.CLIENTS_VIEW);

  const callBacks = await prisma.callBack.findMany({
    include: {
      product: { select: { code: true, name: true } },
      department: { select: { name: true } },
      raisedBy: { select: { name: true } },
      returns: { select: { id: true, entryNumber: true, quantity: true, status: true, supplierName: true } },
      // Held in a department for rework
      issues: {
        select: {
          id: true,
          quantity: true,
          ...issueDrawdownsInclude,
          department: { select: { name: true, locationId: true } },
          stockEntry: { select: { id: true, entryNumber: true, itemName: true, batchNumber: true } },
        },
      },
      swaps: { select: { id: true, customerBatch: true, replacementBatch: true, quantity: true, client: { select: { name: true } }, partProduct: { select: { name: true } } } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  const out = [];
  for (const cb of callBacks) {
    const trace = await traceBatch(cb.batchNumber);
    const reachesSite = trace.customers.some((c) => c.originLocationId === site);
    if (!all && cb.locationId !== site && !cb.notifyAllSites && !reachesSite) continue;
    out.push({
      id: cb.id,
      callBackNumber: cb.callBackNumber,
      batchNumber: cb.batchNumber,
      productName: cb.product?.name ?? null,
      productCode: cb.product?.code ?? null,
      reason: cb.reason,
      status: cb.status,
      notifyAllSites: cb.notifyAllSites,
      createdAt: cb.createdAt,
      departmentName: cb.department.name,
      raisedByName: cb.raisedBy.name,
      tracedBatches: trace.batches,
      central: trace.central.map((h) => ({ entryNumber: h.entryNumber, itemName: h.itemName, batchNumber: h.batchNumber, locationName: h.locationName, available: h.available })),
      customers: trace.customers.map((c: TracedCustomer) => ({
        clientId: c.clientId,
        clientName: c.clientName,
        city: c.city,
        address: showClientDetail ? c.address : null,
        gstNumber: showClientDetail ? c.gstNumber : null,
        batchNumber: c.batchNumber,
        itemName: c.itemName,
        quantity: c.quantity,
        via: c.via,
      })),
      returns: cb.returns.map((r) => ({
        ...r,
        // A new batch after rework — only on what came back
        canRelabel: r.status === "APPROVED" && user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT),
      })),
      inRework: cb.issues
        .map((i) => ({
          issueId: i.id,
          entryId: i.stockEntry.id,
          entryNumber: i.stockEntry.entryNumber,
          itemName: i.stockEntry.itemName,
          batchNumber: i.stockEntry.batchNumber,
          departmentName: i.department.name,
          free: availableFromIssue(i),
          canReturn:
            user.permissions.includes(PERMISSIONS.MATERIALS_SUPPLY) &&
            (all || i.department.locationId === user.locationId),
          canRelabel: user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT),
        }))
        .filter((i) => i.free > 0),
      swaps: cb.swaps.map((s) => ({ id: s.id, clientName: s.client.name, partName: s.partProduct.name, quantity: s.quantity, customerBatch: s.customerBatch, replacementBatch: s.replacementBatch })),
      canClose: cb.status === "OPEN" && user.permissions.includes(PERMISSIONS.CALLBACKS_RAISE) && (all || cb.locationId === user.locationId),
      canBookReturn: cb.status === "OPEN" && user.permissions.includes(PERMISSIONS.CALLBACKS_RECEIVE) && !!cb.productId && !!user.locationId,
      canSwap: cb.status === "OPEN" && user.permissions.includes(PERMISSIONS.SERVICE_SWAP),
    });
  }
  return out;
}

export async function closeCallBack(id: string) {
  const user = await requirePermission(PERMISSIONS.CALLBACKS_RAISE);
  const cb = await prisma.callBack.findUnique({ where: { id } });
  if (!cb) return { error: "That call-back was not found" };
  if (resolveStockScope(user) !== "all" && cb.locationId !== user.locationId) return { error: "That call-back is at another site" };
  const done = await prisma.callBack.updateMany({ where: { id, status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date() } });
  if (done.count !== 1) return { error: "That call-back is already closed" };
  await logActivity("UPDATED", "CallBack", id, `Closed ${cb.callBackNumber}`);
  revalidateAll();
  return { success: true };
}

const returnSchema = z.object({
  quantity: z.coerce.number().int("Count whole units").positive("Book in at least one").max(100_000),
  clientId: z.string().optional(),
});

/**
 * Book in what a customer sent back: a CALLBACK stock entry at the booker's
 * site, waiting for the Stock Manager like any other — approved on raising if
 * the booker may approve it.
 */
export async function bookCallBackReturn(callBackId: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.CALLBACKS_RECEIVE);
  const parsed = returnSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!user.locationId) return { error: "You are not at a site to book goods in at" };

  const cb = await prisma.callBack.findUnique({ where: { id: callBackId }, include: { product: true } });
  if (!cb || cb.status !== "OPEN" || !cb.product) return { error: "That call-back is not open" };

  const client = parsed.data.clientId
    ? await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true, name: true } })
    : null;
  if (parsed.data.clientId && !client) return { error: "That customer was not found" };

  // Valued as the batch was when it first came in
  const original = await prisma.stockEntry.findFirst({
    where: { batchNumber: { equals: cb.batchNumber, mode: "insensitive" }, productId: cb.productId },
    select: { unitPrice: true },
    orderBy: { createdAt: "asc" },
  });
  const unitPrice = original?.unitPrice ?? 0;

  const flow = await findApprovalFlow(null);
  if (!flow) return { error: NO_FLOW_CONFIGURED };
  const approvesOwn = approvalRefusal({ departmentId: null, locationId: user.locationId, forService: false, source: "CALLBACK" }, user) === null;

  const entry = await prisma.stockEntry.create({
    data: {
      entryNumber: await nextReference("SE"),
      source: "CALLBACK",
      callBackId: cb.id,
      productId: cb.product.id,
      itemCode: cb.product.code,
      itemName: cb.product.name,
      supplierName: client ? `Returned by ${client.name}` : "Customer return",
      quantity: parsed.data.quantity,
      unitPrice,
      totalPrice: unitPrice * parsed.data.quantity,
      locationId: user.locationId,
      batchNumber: cb.batchNumber,
      status: approvesOwn ? "APPROVED" : "SUBMITTED",
      approvedById: approvesOwn ? user.id : null,
      createdById: user.id,
      approvals: {
        create: flow.steps.map((step) => ({
          stepOrder: step.stepOrder,
          stepLabel: step.stepLabel,
          approverRoleId: step.approverRoleId,
          ...(approvesOwn
            ? { status: "APPROVED" as const, approverUserId: user.id, comments: "Approved on raising" }
            : { status: "PENDING" as const }),
        })),
      },
    },
  });
  await logActivity("CREATED", "StockEntry", entry.id, `Booked in ${entry.quantity} × ${entry.itemName} returned on ${cb.callBackNumber}${approvesOwn ? " (approved)" : ""}`);
  if (!approvesOwn) await entrySubmitted({ ...entry, deliveryId: null });

  revalidateAll();
  return { success: true, entryNumber: entry.entryNumber, approved: approvesOwn };
}

const swapSchema = z.object({
  callBackId: z.string().optional(),
  clientId: z.string().min(1, "Pick the customer"),
  customerBatch: z.string().trim().min(1, "Which of their products — its batch").max(60),
  notes: z.string().trim().max(300).optional(),
  // From service stock: the entry it comes from, and how many
  stockEntryId: z.string().optional(),
  quantity: z.coerce.number().int().positive().max(10_000).optional(),
  // Or sent by central stock: the consignment that carried it
  dispatchNumber: z.string().trim().max(40).optional(),
});

/**
 * Record a part swapped at the customer's premises. From service stock this
 * raises the consignment that carries it (through the dispatch action, with all
 * its checks); otherwise it names the consignment central stock sent it on.
 */
export async function recordServiceSwap(data: unknown) {
  const user = await requirePermission(PERMISSIONS.SERVICE_SWAP);
  const parsed = swapSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const input = parsed.data;

  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, isActive: true } });
  if (!client?.isActive) return { error: "That customer was not found" };
  if (input.callBackId) {
    const cb = await prisma.callBack.findUnique({ where: { id: input.callBackId }, select: { status: true } });
    if (cb?.status !== "OPEN") return { error: "That call-back is not open" };
  }

  let dispatchId: string;
  let partProductId: string | null;
  let replacementBatch: string | null;
  let quantity: number;

  if (input.stockEntryId) {
    // From service stock — only service stock, and only through dispatch
    const entry = await prisma.stockEntry.findUnique({ where: { id: input.stockEntryId }, select: { forService: true, productId: true } });
    if (!entry?.forService || !entry.productId) return { error: "Pick a part from service stock" };
    if (!input.quantity) return { error: "How many went in?" };
    const sent = await createDispatch({
      destination: "CLIENT",
      clientId: client.id,
      items: [{ stockEntryId: input.stockEntryId, quantity: input.quantity }],
      notes: `Part swapped at the customer, into ${input.customerBatch}`,
    });
    if ("error" in sent) return { error: sent.error };
    const item = await prisma.dispatchItem.findFirst({ where: { dispatchId: sent.dispatch.id }, select: { batchNumber: true } });
    dispatchId = sent.dispatch.id;
    partProductId = entry.productId;
    replacementBatch = item?.batchNumber ?? null;
    quantity = input.quantity;
  } else if (input.dispatchNumber) {
    // Sent by central stock: it must be a consignment to this customer that
    // this person's site sent (or any, for someone who sees every site)
    const dispatch = await prisma.dispatch.findUnique({
      where: { dispatchNumber: input.dispatchNumber },
      include: { items: { include: { stockEntry: { select: { productId: true } } } } },
    });
    if (
      !dispatch ||
      dispatch.destination !== "CLIENT" ||
      dispatch.clientId !== client.id ||
      !(COMMITTING_DISPATCH_STATUSES as readonly string[]).includes(dispatch.status) ||
      (resolveStockScope(user) !== "all" && dispatch.originLocationId !== user.locationId)
    ) {
      return { error: "No consignment with that number went to this customer from your site" };
    }
    const item = dispatch.items[0];
    if (!item?.stockEntry.productId) return { error: "That consignment carries nothing to record" };
    dispatchId = dispatch.id;
    partProductId = item.stockEntry.productId;
    replacementBatch = item.batchNumber;
    quantity = item.quantity;
  } else {
    return { error: "Say where the part came from: service stock, or the consignment central stock sent" };
  }

  const swap = await prisma.serviceSwap.create({
    data: {
      callBackId: input.callBackId || null,
      clientId: client.id,
      customerBatch: input.customerBatch,
      partProductId,
      quantity,
      replacementBatch,
      dispatchId,
      notes: input.notes || null,
      swappedById: user.id,
    },
  });
  await logActivity("CREATED", "ServiceSwap", swap.id, `Recorded a part swapped into ${input.customerBatch}${replacementBatch ? ` — batch ${replacementBatch}` : ""}`);
  revalidateAll();
  return { success: true };
}

const askSchema = z.object({
  clientId: z.string().min(1),
  partProductId: z.string().min(1, "Pick the part"),
  quantity: z.coerce.number().int().positive().max(10_000),
  callBackId: z.string().optional(),
});

/**
 * Service stock does not have the part: ask central stock at this site to send
 * it to the customer. Whoever supplies at the site (the Stock Manager) is told;
 * the swap is recorded once their consignment has gone.
 */
export async function askCentralForPart(data: unknown) {
  const user = await requirePermission(PERMISSIONS.SERVICE_SWAP);
  const parsed = askSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!user.locationId) return { error: "You are not at a site" };
  const [client, part] = await Promise.all([
    prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { name: true, isActive: true } }),
    prisma.product.findUnique({ where: { id: parsed.data.partProductId }, select: { name: true, isActive: true } }),
  ]);
  if (!client?.isActive || !part?.isActive) return { error: "That customer or part was not found" };

  await notifyHolders(
    PERMISSIONS.MATERIALS_SUPPLY,
    { locationId: user.locationId, exclude: [user.id] },
    {
      kind: "ACTION",
      title: `Service needs ${parsed.data.quantity} × ${part.name} sent to ${client.name}`,
      body: "Not in service stock — please dispatch it to the customer for a swap",
      href: "/dispatch",
    }
  );
  await logActivity("REQUESTED", "ServiceSwap", parsed.data.clientId, `Asked central stock to send ${parsed.data.quantity} × ${part.name} to ${client.name} for a swap`);
  return { success: true };
}

/**
 * Reworked goods go back to central stock: the department hands back what it
 * still holds of a call-back's holding, and the units count as central stock
 * of their entry again. Moving to or from central stock is the Stock Manager's
 * (materials.supply), at its own site. If rework changed the batch, the entry
 * is relabelled separately (setEntryBatch).
 */
export async function returnReworked(issueId: string, quantity: number) {
  const user = await requirePermission(PERMISSIONS.MATERIALS_SUPPLY);
  const wanted = Math.floor(Number(quantity));
  if (!Number.isFinite(wanted) || wanted < 1) return { error: "How many are going back?" };

  const done = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM stock_issues WHERE id = ${issueId} FOR UPDATE`;
    const issue = await tx.stockIssue.findUnique({
      where: { id: issueId },
      include: { ...issueDrawdownsInclude, department: { select: { locationId: true } }, callBack: { select: { callBackNumber: true } } },
    });
    if (!issue || !issue.callBackId) return { error: "Only goods called back for rework go back this way" };
    if (resolveStockScope(user) !== "all" && issue.department.locationId !== user.locationId) {
      return { error: "That department is at another site" };
    }
    const free = availableFromIssue(issue);
    if (wanted > free) return { error: `Only ${free} of it is still free in the department` };
    // Taking it off the holding gives it back to the entry's central stock
    await tx.stockIssue.update({ where: { id: issueId }, data: { quantity: issue.quantity - wanted } });
    return { callBackNumber: issue.callBack?.callBackNumber ?? "" };
  });
  if ("error" in done) return { error: done.error };

  await logActivity("UPDATED", "StockIssue", issueId, `Returned ${wanted} reworked unit${wanted === 1 ? "" : "s"} to central stock (${done.callBackNumber})`);
  revalidateAll();
  return { success: true };
}

/**
 * Change the batch an entry carries — after rework, when it needs a new one.
 * Typing a batch is its own grant (stock.batch.edit), as everywhere else, and
 * it is allowed only on goods that came back on a call-back: relabelling any
 * other stock would let a batch quietly slip out of a future recall. The old
 * batch stays in the activity log.
 */
export async function setEntryBatch(entryId: string, batchNumber: string) {
  const user = await requirePermission(PERMISSIONS.STOCK_BATCH_EDIT);
  const batch = typeof batchNumber === "string" ? batchNumber.trim() : "";
  if (!batch || batch.length > 60) return { error: "Enter a batch number of up to 60 characters" };
  const entry = await prisma.stockEntry.findUnique({
    where: { id: entryId },
    select: { entryNumber: true, batchNumber: true, locationId: true, status: true, callBackId: true, issues: { where: { callBackId: { not: null } }, select: { id: true } } },
  });
  if (!entry || entry.status !== "APPROVED") return { error: "That stock entry was not found" };
  if (!entry.callBackId && entry.issues.length === 0) {
    return { error: "Only goods that came back on a call-back can be given a new batch" };
  }
  if (resolveStockScope(user) !== "all" && entry.locationId !== user.locationId) return { error: "That stock is at another site" };
  await prisma.stockEntry.update({ where: { id: entryId }, data: { batchNumber: batch } });
  await logActivity("UPDATED", "StockEntry", entryId, `Batch of ${entry.entryNumber} changed from ${entry.batchNumber ?? "none"} to ${batch}`);
  revalidateAll();
  return { success: true };
}
