"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, MATERIALS_PAGE_PERMISSIONS } from "@/lib/rbac/permissions";
import {
  materialDepartmentRefusal,
  materialSupplyRefusal,
  materialRequestsVisibleWhere,
} from "@/lib/review-rules";
import { round } from "@/lib/stock-availability";
import { supplyFromCentral } from "@/lib/material-supply";
import { nextReference } from "@/lib/reference-numbers";
import { logActivity } from "@/lib/activity-log";
import { notify, notifyHolders } from "@/lib/notifications/notify";
import { requestNeeds } from "./needs";
import { revalidatePath } from "next/cache";

/**
 * Material requests: a department asking central stock for materials — what a
 * build is short of, or anything else it needs.
 *
 *   raise      materials.request; for the requester's own department, at its site
 *   approve    the department's manager (materials.approve.department)
 *   supply     the Stock Manager (materials.supply) moves central stock into the
 *              department, oldest first — stock only, never anything classified
 *              as an asset. What central stock cannot cover is left PARTLY
 *              SUPPLIED, and can be raised as needs for the Buyer, once.
 *
 * Raise what you may approve, and it is approved: each step the requester
 * could take happens on raising, and a department approver who may also supply
 * supplies on approving — one person holding both approves once. The rules for
 * who may take each step live in src/lib/review-rules.ts.
 */

const requestSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1, "Pick an item"),
        quantity: z.coerce.number().positive("Ask for more than nothing").max(1_000_000, "That is too many"),
      })
    )
    .min(1, "Add at least one item")
    .max(50, "Ask for at most 50 items at once"),
  notes: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
  /** What it is for, when raised from a short build — shown, never trusted */
  forProductId: z.string().optional(),
  forQuantity: z.coerce.number().int().positive().optional(),
});

function revalidateAll() {
  revalidatePath("/materials");
  revalidatePath("/builds");
  revalidatePath("/dashboard");
  revalidatePath("/stock");
  revalidatePath("/assets");
}

export async function createMaterialRequest(data: unknown) {
  const user = await requirePermission(PERMISSIONS.MATERIALS_REQUEST);
  const parsed = requestSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Always for the requester's own department, at its site
  if (!user.departmentId) return { error: "You are not in a department, so there is nowhere to move materials to" };
  const department = await prisma.department.findUnique({
    where: { id: user.departmentId },
    select: { id: true, name: true, locationId: true, isActive: true, isCentralStock: true },
  });
  if (!department || !department.isActive || !department.locationId) {
    return { error: "Your department was not found, or has no site" };
  }
  if (department.isCentralStock) return { error: "Central stock does not request from itself" };

  // One line per product, quantities added together
  const merged = new Map<string, number>();
  for (const line of parsed.data.lines) {
    merged.set(line.productId, round((merged.get(line.productId) ?? 0) + line.quantity));
  }
  const products = await prisma.product.findMany({
    where: { id: { in: [...merged.keys()] }, isActive: true },
    select: { id: true },
  });
  if (products.length !== merged.size) return { error: "One of the items is no longer in the catalog" };

  const forProduct = parsed.data.forProductId
    ? await prisma.product.findUnique({ where: { id: parsed.data.forProductId }, select: { id: true } })
    : null;

  const request = await prisma.materialRequest.create({
    data: {
      requestNumber: await nextReference("MR"),
      departmentId: department.id,
      locationId: department.locationId,
      notes: parsed.data.notes || null,
      forProductId: forProduct?.id ?? null,
      forQuantity: forProduct ? parsed.data.forQuantity ?? null : null,
      requestedById: user.id,
      lines: { create: [...merged].map(([productId, quantity]) => ({ productId, quantity })) },
    },
  });
  await logActivity("REQUESTED", "MaterialRequest", request.id, `Raised ${request.requestNumber} for ${department.name} — ${merged.size} item${merged.size === 1 ? "" : "s"}`);

  // Raise what you may approve: the department step, then supplying
  const outcome = await advance(request.id, user);
  revalidateAll();
  return { success: true, requestNumber: request.requestNumber, status: outcome };
}

/**
 * Take every step this person may take, from wherever the request stands, and
 * tell whoever acts next. Returns where it ended up.
 */
async function advance(
  requestId: string,
  user: Parameters<typeof materialDepartmentRefusal>[0] & Parameters<typeof materialSupplyRefusal>[0] & { id: string }
): Promise<string> {
  let request = await prisma.materialRequest.findUniqueOrThrow({ where: { id: requestId } });

  if (request.status === "PENDING_DEPARTMENT" && materialDepartmentRefusal(user, request) === null) {
    const claimed = await prisma.materialRequest.updateMany({
      where: { id: requestId, status: "PENDING_DEPARTMENT" },
      data: { status: "PENDING_STOCK", departmentApprovedById: user.id, departmentApprovedAt: new Date() },
    });
    if (claimed.count === 1) {
      await logActivity("APPROVED", "MaterialRequest", requestId, `Department approved ${request.requestNumber}`);
    }
    request = await prisma.materialRequest.findUniqueOrThrow({ where: { id: requestId } });
  }

  if (request.status === "PENDING_STOCK" && materialSupplyRefusal(user, request) === null) {
    const status = await supplyFromCentral(requestId, user.id);
    if (status) {
      await logActivity("ISSUED", "MaterialRequest", requestId, `${status === "SUPPLIED" ? "Supplied" : "Partly supplied"} ${request.requestNumber}`);
    }
    request = await prisma.materialRequest.findUniqueOrThrow({ where: { id: requestId } });
  }

  // Whoever acts next hears about it
  if (request.status === "PENDING_DEPARTMENT") {
    await notifyHolders(
      PERMISSIONS.MATERIALS_APPROVE_DEPARTMENT,
      { departmentId: request.departmentId, exclude: [user.id] },
      { kind: "ACTION", title: `${request.requestNumber} — materials to approve`, body: "Your department is asking central stock", href: "/materials" }
    );
  } else if (request.status === "PENDING_STOCK") {
    await notifyHolders(
      PERMISSIONS.MATERIALS_SUPPLY,
      { locationId: request.locationId, exclude: [user.id] },
      { kind: "ACTION", title: `${request.requestNumber} — materials to supply`, body: "Approved by the department", href: "/materials" }
    );
  } else if (request.requestedById !== user.id) {
    await notify([request.requestedById], {
      kind: "DECIDED",
      title: `${request.requestNumber} was ${request.status === "SUPPLIED" ? "supplied" : "partly supplied"}`,
      body: "The materials are in your department's stock",
      href: "/materials",
    });
  }
  return request.status;
}


/** The department's manager approves — and supplies too, if they may. */
export async function approveMaterialRequest(id: string) {
  const user = await requirePermission(PERMISSIONS.MATERIALS_APPROVE_DEPARTMENT);
  const request = await prisma.materialRequest.findUnique({ where: { id } });
  if (!request) return { error: "That request was not found" };
  const refusal = materialDepartmentRefusal(user, request);
  if (refusal) return { error: refusal };
  if (request.status !== "PENDING_DEPARTMENT") return { error: "That request is not waiting for its department" };

  const status = await advance(id, user);
  revalidateAll();
  return { success: true, status };
}

/** The Stock Manager supplies what central stock has. */
export async function supplyMaterialRequest(id: string) {
  const user = await requirePermission(PERMISSIONS.MATERIALS_SUPPLY);
  const request = await prisma.materialRequest.findUnique({ where: { id } });
  if (!request) return { error: "That request was not found" };
  const refusal = materialSupplyRefusal(user, request);
  if (refusal) return { error: refusal };
  if (request.status !== "PENDING_STOCK") return { error: "That request is not waiting to be supplied" };

  const status = await advance(id, user);
  revalidateAll();
  return { success: true, status };
}

/** Turn down a request — at whichever step it is waiting, by whoever decides that step. */
export async function rejectMaterialRequest(id: string, reason: string) {
  const user = await requireAnyPermission([PERMISSIONS.MATERIALS_APPROVE_DEPARTMENT, PERMISSIONS.MATERIALS_SUPPLY]);
  if (typeof reason !== "string" || !reason.trim()) return { error: "Say why" };
  const request = await prisma.materialRequest.findUnique({ where: { id } });
  if (!request) return { error: "That request was not found" };
  const refusal =
    request.status === "PENDING_DEPARTMENT"
      ? materialDepartmentRefusal(user, request)
      : request.status === "PENDING_STOCK"
        ? materialSupplyRefusal(user, request)
        : "That request has already been decided";
  if (refusal) return { error: refusal };

  const done = await prisma.materialRequest.updateMany({
    where: { id, status: request.status },
    data: { status: "REJECTED", rejectedById: user.id, rejectionReason: reason.trim().slice(0, 500) },
  });
  if (done.count !== 1) return { error: "Someone has just decided that request" };
  await logActivity("REJECTED", "MaterialRequest", id, `Turned down ${request.requestNumber} — ${reason.trim().slice(0, 300)}`);
  await notify([request.requestedById], { kind: "DECIDED", title: `${request.requestNumber} was turned down`, body: reason.trim().slice(0, 300), href: "/materials" });
  revalidateAll();
  return { success: true };
}

/** The requester withdraws it while nobody has supplied anything. */
export async function cancelMaterialRequest(id: string) {
  const user = await requirePermission(PERMISSIONS.MATERIALS_REQUEST);
  const request = await prisma.materialRequest.findUnique({ where: { id } });
  if (!request || request.requestedById !== user.id) return { error: "That request was not found" };
  const done = await prisma.materialRequest.updateMany({
    where: { id, status: { in: ["PENDING_DEPARTMENT", "PENDING_STOCK"] } },
    data: { status: "CANCELLED" },
  });
  if (done.count !== 1) return { error: "That request has already been decided" };
  await logActivity("CANCELLED", "MaterialRequest", id, `Withdrew ${request.requestNumber}`);
  revalidateAll();
  return { success: true };
}

/**
 * What central stock could not supply becomes needs for the Buyer — once per
 * request. Raised through the ordinary needs action, so its rules (and
 * raise-and-approve) apply exactly as anywhere else.
 */
export async function raiseShortfallNeeds(id: string) {
  const user = await requirePermission(PERMISSIONS.MATERIALS_SUPPLY);
  if (!user.permissions.includes(PERMISSIONS.PROCUREMENT_INTENT_CREATE)) {
    return { error: "You do not have permission to raise needs" };
  }
  const request = await prisma.materialRequest.findUnique({ where: { id }, include: { lines: true } });
  if (!request) return { error: "That request was not found" };
  const refusal = materialSupplyRefusal(user, request);
  if (refusal) return { error: refusal };
  if (request.status !== "PARTLY_SUPPLIED") return { error: "Nothing is missing from that request" };

  // Claimed first, so the same shortfall is never raised twice
  const claimed = await prisma.materialRequest.updateMany({
    where: { id, shortfallRaisedAt: null },
    data: { shortfallRaisedAt: new Date() },
  });
  if (claimed.count !== 1) return { error: "The shortfall has already been raised" };

  const lines = request.lines
    .map((l) => ({ productId: l.productId, quantity: Math.ceil(l.quantity - l.supplied) }))
    .filter((l) => l.quantity > 0);
  const raised = await requestNeeds({ lines, locationId: request.locationId, notes: `Short on ${request.requestNumber}` });
  if ("error" in raised && raised.error) {
    // Released, so it can be tried again
    await prisma.materialRequest.update({ where: { id }, data: { shortfallRaisedAt: null } });
    return { error: raised.error };
  }
  revalidateAll();
  revalidatePath("/procurement");
  return { success: true };
}

/** Requests this person may see, with what they may do to each. */
export async function getMaterialRequests() {
  const user = await requireAnyPermission(MATERIALS_PAGE_PERMISSIONS);
  const requests = await prisma.materialRequest.findMany({
    where: materialRequestsVisibleWhere(user),
    include: {
      lines: { include: { product: { select: { code: true, name: true, unit: true } } } },
      department: { select: { name: true } },
      location: { select: { name: true } },
      forProduct: { select: { name: true } },
      requestedBy: { select: { name: true } },
      departmentApprover: { select: { name: true } },
      supplier: { select: { name: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  const raisesNeeds = user.permissions.includes(PERMISSIONS.PROCUREMENT_INTENT_CREATE);

  // The actions' own rules, so no button is offered that they refuse
  return requests.map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    status: r.status,
    notes: r.notes,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt,
    departmentName: r.department.name,
    locationName: r.location.name,
    forProductName: r.forProduct?.name ?? null,
    forQuantity: r.forQuantity,
    requestedByName: r.requestedBy.name,
    departmentApproverName: r.departmentApprover?.name ?? null,
    supplierName: r.supplier?.name ?? null,
    lines: r.lines.map((l) => ({ id: l.id, code: l.product.code, name: l.product.name, unit: l.product.unit, quantity: l.quantity, supplied: l.supplied })),
    canApprove: r.status === "PENDING_DEPARTMENT" && materialDepartmentRefusal(user, r) === null,
    canSupply: r.status === "PENDING_STOCK" && materialSupplyRefusal(user, r) === null,
    canCancel: r.requestedById === user.id && (r.status === "PENDING_DEPARTMENT" || r.status === "PENDING_STOCK"),
    canRaiseShortfall:
      r.status === "PARTLY_SUPPLIED" && !r.shortfallRaisedAt && raisesNeeds && materialSupplyRefusal(user, r) === null,
    shortfallRaised: !!r.shortfallRaisedAt,
  }));
}

/** Requests waiting on this person, for the dashboard's review queue. */
export async function getReviewableMaterialRequests() {
  const user = await requireAnyPermission([PERMISSIONS.MATERIALS_APPROVE_DEPARTMENT, PERMISSIONS.MATERIALS_SUPPLY]);
  const pending = await prisma.materialRequest.findMany({
    where: { status: { in: ["PENDING_DEPARTMENT", "PENDING_STOCK"] }, ...materialRequestsVisibleWhere(user) },
    include: { department: { select: { name: true } }, lines: { select: { id: true } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  return pending
    .filter((r) =>
      r.status === "PENDING_DEPARTMENT"
        ? materialDepartmentRefusal(user, r) === null
        : materialSupplyRefusal(user, r) === null
    )
    .slice(0, 10)
    .map((r) => ({
      kind: "MATERIALS" as const,
      id: r.id,
      title: `${r.lines.length} item${r.lines.length === 1 ? "" : "s"} for ${r.department.name}`,
      subtitle: `${r.requestNumber} · ${r.status === "PENDING_DEPARTMENT" ? "to approve" : "to supply"}`,
      href: "/materials",
    }));
}
