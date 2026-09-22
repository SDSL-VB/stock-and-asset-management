"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { nextReference } from "@/lib/reference-numbers";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import { toCsv } from "@/lib/csv";
import { renderNeedListPdf, type NeedListDocument } from "@/lib/need-list-pdf";
import { logActivity } from "@/lib/activity-log";
import { NEED_STATUS_LABEL } from "@/lib/vocabulary";
import { needsRaised } from "@/lib/notifications/events";
import { getProcurementFlow } from "./procurement";

/**
 * FLOW: needs — everything that reaches Procurement from the "What do you
 * need?" dialog, and the lists that group them.
 *
 *   1. requestNeeds     the dialog's one action. A single item typed by hand
 *                       becomes one need, as it always did. Several items — or
 *                       anything the dialog was opened with from a build that is
 *                       short, or from the low-stock alert — become one need
 *                       LIST: one number, one reason ("Short for 5 ×
 *                       BLDC_Controller at Bengaluru"), each need carrying its
 *                       own vendor, and the date it is needed by.
 *   2. getNeedList      one list, when somebody clicks its number on a need
 *   3. exportNeedListCsv / exportNeedListPdf
 *                       that list as a file, for whoever approves needs or
 *                       raises orders
 *
 * The needs are ordinary PurchaseIntents; verifying and ordering them is
 * unchanged. A list only adds grouping, a reason, and a document. The dialog
 * is pre-filled from the build or the alert, but the person reviews it — the
 * quantities, vendors and date are theirs to change before it is sent.
 */

type NeedLine = {
  productId: string;
  quantity: number;
  /** Why this much — shown on the need, e.g. "needed 25, 0.5 on hand" */
  note: string;
  vendorId?: string | null;
};

/**
 * The one way a list is created — used by the build shortage here and by the
 * low-stock alert. Everything in one transaction, so a list never exists with
 * half its needs.
 */
async function createNeedList(input: {
  source: "BUILD_SHORTAGE" | "LOW_STOCK";
  productId?: string;
  quantity?: number;
  locationId: string | null;
  notes: string;
  neededBy: Date | null;
  lines: NeedLine[];
  user: { id: string; departmentId?: string | null };
}) {
  return prisma.$transaction(async (tx) => {
    const list = await tx.needList.create({
      data: {
        listNumber: await nextReference("NR", tx),
        source: input.source,
        productId: input.productId ?? null,
        quantity: input.quantity ?? null,
        locationId: input.locationId,
        notes: input.notes,
        createdById: input.user.id,
      },
    });

    for (const line of input.lines) {
      await tx.purchaseIntent.create({
        data: {
          intentNumber: await nextReference("PI", tx),
          productId: line.productId,
          quantity: Math.max(1, Math.ceil(line.quantity)),
          vendorId: line.vendorId ?? null,
          // Who needs it is who asked, exactly as for a need typed by hand
          departmentId: input.user.departmentId ?? null,
          locationId: input.locationId,
          neededBy: input.neededBy,
          notes: line.note ? `${input.notes} — ${line.note}` : input.notes,
          requestedById: input.user.id,
          needListId: list.id,
        },
      });
    }
    return list;
  });
}

const requestSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1, "Pick an item"),
        quantity: z.coerce.number().int("Ask for whole units").positive("Ask for at least one"),
        vendorId: z.string().optional(),
        note: z.string().max(200).optional(),
      })
    )
    .min(1, "Add at least one item"),
  locationId: z.string().optional(),
  neededBy: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), "That is not a real date"),
  notes: z.string().max(500, "Keep the note under 500 characters").optional(),
  // Where the dialog was opened from, if not by hand
  source: z
    .object({
      kind: z.enum(["BUILD_SHORTAGE", "LOW_STOCK"]),
      productId: z.string().optional(),
      quantity: z.number().int().positive().optional(),
    })
    .optional(),
});

/**
 * Everything the "What do you need?" dialog sends.
 *
 * One line typed by hand is one need. Several lines, or a request that came
 * from a short build or a low-stock alert, are raised together as a list. The
 * list's reason is written HERE from the source rather than taken from the
 * browser, so "Short for 5 × BLDC_Controller" always names the real build.
 */
export async function requestNeeds(data: unknown) {
  const user = await requirePermission(PERMISSIONS.PROCUREMENT_INTENT_CREATE);
  const parsed = requestSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { lines, notes, source } = parsed.data;
  const locationId = parsed.data.locationId || user.locationId || null;
  const neededBy = parsed.data.neededBy ? new Date(parsed.data.neededBy) : null;

  // Every item and vendor must exist and still be in use
  const [products, vendors] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: lines.map((l) => l.productId) }, isActive: true }, select: { id: true, name: true } }),
    prisma.vendor.findMany({
      where: { id: { in: lines.flatMap((l) => (l.vendorId ? [l.vendorId] : [])) }, isActive: true },
      select: { id: true },
    }),
  ]);
  const known = new Map(products.map((p) => [p.id, p.name]));
  const missing = lines.find((l) => !known.has(l.productId));
  if (missing) return { error: "One of the items is no longer in the catalog" };
  if (lines.some((l) => l.vendorId && !vendors.some((v) => v.id === l.vendorId))) {
    return { error: "One of the vendors is no longer in use" };
  }

  // One item, typed by hand: a single need, exactly as before lists existed
  if (lines.length === 1 && !source) {
    const [line] = lines;
    const intent = await prisma.purchaseIntent.create({
      data: {
        intentNumber: await nextReference("PI"),
        productId: line.productId,
        quantity: line.quantity,
        vendorId: line.vendorId || null,
        departmentId: user.departmentId ?? null,
        locationId,
        neededBy,
        notes: notes?.trim() || null,
        requestedById: user.id,
      },
    });
    await logActivity("CREATED", "PurchaseIntent", intent.id, `Raised ${intent.intentNumber} — needs ${line.quantity} × ${known.get(line.productId)}`);
    revalidatePath("/procurement");
    await needsRaised({
      count: 1,
      label: intent.intentNumber,
      locationId,
      requestedById: user.id,
      requiresApproval: (await getProcurementFlow()).requiresApproval,
    });
    return { success: true, count: 1, listNumber: null };
  }

  // Several, or from a build / the alert: one list, with a reason worked out here
  const site = locationId ? await prisma.location.findUnique({ where: { id: locationId }, select: { name: true } }) : null;
  const built = source?.productId ? await prisma.product.findUnique({ where: { id: source.productId }, select: { name: true } }) : null;
  const reason =
    source?.kind === "BUILD_SHORTAGE" && built
      ? `Short for ${source.quantity ?? 1} × ${built.name}${site ? ` at ${site.name}` : ""}`
      : source?.kind === "LOW_STOCK"
        ? `Low stock${site ? ` at ${site.name}` : ""}`
        : `${lines.length} items`;
  const fullNotes = notes?.trim() ? `${reason}. ${notes.trim()}` : reason;

  const list = await createNeedList({
    source: source?.kind ?? "BUILD_SHORTAGE",
    productId: source?.productId,
    quantity: source?.quantity,
    locationId,
    notes: fullNotes,
    neededBy,
    user,
    lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, vendorId: l.vendorId || null, note: l.note ?? "" })),
  });

  await logActivity(
    "CREATED",
    "NeedList",
    list.id,
    `Raised ${list.listNumber} — ${lines.length} need${lines.length === 1 ? "" : "s"}: ${reason.toLowerCase()}`
  );
  revalidatePath("/procurement");
  revalidatePath("/builds");
  revalidatePath("/dashboard");
  await needsRaised({
    count: lines.length,
    label: list.listNumber,
    locationId,
    requestedById: user.id,
    requiresApproval: (await getProcurementFlow()).requiresApproval,
  });
  return { success: true, count: lines.length, listNumber: list.listNumber };
}

/**
 * Whose lists someone may see. Anyone who approves needs or raises orders sees
 * every list — they are the buyers, and a list is exactly what they act on —
 * as does anyone who sees every site. Everyone else sees what they raised and
 * what their own department needs, the same rule as for single needs.
 */
function listScope(user: { id: string; departmentId?: string | null; role: string; permissions: string[] }) {
  const seesAll =
    resolveStockScope(user) === "all" ||
    user.permissions.includes(PERMISSIONS.PROCUREMENT_INTENT_APPROVE) ||
    user.permissions.includes(PERMISSIONS.PROCUREMENT_PO_CREATE);
  if (seesAll) return {};
  return {
    OR: [
      { createdById: user.id },
      ...(user.departmentId ? [{ needs: { some: { departmentId: user.departmentId } } }] : []),
    ],
  };
}

const listInclude = {
  product: { select: { code: true, name: true } },
  location: { select: { name: true } },
  createdBy: { select: { name: true } },
  needs: {
    orderBy: { intentNumber: "asc" as const },
    select: {
      id: true,
      intentNumber: true,
      quantity: true,
      status: true,
      notes: true,
      vendor: { select: { name: true } },
      product: { select: { code: true, name: true, description: true, unit: true } },
    },
  },
};

/**
 * One list, for the dialog that opens when somebody clicks its number on a need.
 * Whoever can see needs can see the list; downloading it is checked separately.
 */
export async function getNeedList(listId: string) {
  const user = await requireAnyPermission([
    PERMISSIONS.PROCUREMENT_INTENT_VIEW,
    PERMISSIONS.PROCUREMENT_INTENT_CREATE,
  ]);
  return prisma.needList.findFirst({ where: { id: listId, ...listScope(user) }, include: listInclude });
}

/**
 * One list, ready to become a file — with the permission check both formats
 * share. Downloading is for whoever acts on the list: the approver of needs, or
 * whoever raises the order.
 */
async function loadDocument(listId: string): Promise<NeedListDocument | { error: string }> {
  const user = await requireAnyPermission([
    PERMISSIONS.PROCUREMENT_INTENT_APPROVE,
    PERMISSIONS.PROCUREMENT_PO_CREATE,
  ]);

  const list = await prisma.needList.findFirst({
    where: { id: listId, ...listScope(user) },
    include: listInclude,
  });
  if (!list) return { error: "That list does not exist, or is not yours to download" };

  return {
    listNumber: list.listNumber,
    reason: list.notes ?? (list.source === "LOW_STOCK" ? "Low stock" : "Build shortage"),
    site: list.location?.name ?? null,
    raisedBy: list.createdBy.name,
    raisedOn: list.createdAt,
    lines: list.needs.map((n) => ({
      needNumber: n.intentNumber,
      code: n.product.code,
      name: n.product.name,
      description: n.product.description,
      quantity: n.quantity,
      unit: n.product.unit,
      vendor: n.vendor?.name ?? null,
      // The Procurement page's own words, so the file matches the screen
      status: NEED_STATUS_LABEL[n.status] ?? n.status,
    })),
  };
}

export async function exportNeedListCsv(listId: string) {
  const doc = await loadDocument(listId);
  if ("error" in doc) return doc;

  const csv = toCsv(
    ["List", "Reason", "Site", "Raised by", "Raised on", "Need", "Code", "Item", "Description", "Quantity", "Unit", "Vendor", "Status"],
    doc.lines.map((l) => [
      doc.listNumber,
      doc.reason,
      doc.site ?? "",
      doc.raisedBy,
      doc.raisedOn.toISOString().slice(0, 10),
      l.needNumber,
      l.code,
      l.name,
      l.description ?? "",
      String(l.quantity),
      l.unit,
      l.vendor ?? "",
      l.status,
    ])
  );
  return { csv, rowCount: doc.lines.length };
}

/**
 * The PDF, base64-encoded: a server action can only return plain data, so the
 * bytes travel as text and the button turns them back into a file.
 */
export async function exportNeedListPdf(listId: string) {
  const doc = await loadDocument(listId);
  if ("error" in doc) return doc;

  const bytes = await renderNeedListPdf(doc);
  return { pdf: Buffer.from(bytes).toString("base64"), fileName: `${doc.listNumber}.pdf` };
}
