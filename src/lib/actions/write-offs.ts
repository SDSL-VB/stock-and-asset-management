"use server";

/**
 * Wastage: stock that stopped being stock.
 *
 * Called by: the write-off dialog on a stock entry and on the assets list, the
 * review queue, and the wastage card on the Reports page.
 *
 * Before this existed there were two ways to record a damaged bearing and both
 * were lies. Leave it counted, and the report claims goods nobody can find;
 * delete the entry, and the purchase disappears from history along with it.
 * A write-off records the loss instead of hiding it.
 *
 * Every one is signed off by a manager, so the flow has the same shape as every
 * other review in this app:
 *
 *   raise    →  PENDING    frozen: still on the shelf, but unpromiseable
 *   approve  →  APPROVED   gone: subtracted from stock everywhere at once
 *   reject   →  REJECTED   released back
 *   reverse  →  REVERSED   an approval undone, with its own reason
 *
 * The one rule to keep straight is WHERE the loss lands, and it is decided by
 * `stockIssueId`. Null means the goods were in central stock, so the loss comes
 * off the entry. Set means they were already in a department, so it comes off
 * that department's holding only — never off the entry as well, which the issue
 * was already subtracted from when the stock moved. Getting this backwards
 * would deduct every departmental loss twice. See src/lib/stock-availability.ts,
 * where both halves of the arithmetic live.
 */

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { nextReference } from "@/lib/reference-numbers";
import {
  requirePermission,
  requireAnyPermission,
  resolveStockScope,
} from "@/lib/rbac/check";
import { PERMISSIONS, WRITE_OFF_RAISE_PERMISSIONS } from "@/lib/rbac/permissions";
import {
  availabilityInclude,
  availableQuantity,
  availableFromIssue,
  issueWriteOffsInclude,
  round,
} from "@/lib/stock-availability";
import { stockCandidatesWhere, isStockVisible } from "@/lib/stock-visibility";
import { SELF_APPROVAL_REFUSAL } from "@/lib/review-rules";
import {
  createWriteOffSchema,
  rejectWriteOffSchema,
  reverseWriteOffSchema,
} from "@/lib/validations/write-off";
import { logActivity } from "@/lib/activity-log";
import { writeOffDecided, writeOffRaised } from "@/lib/notifications/events";

/** Every page a write-off changes a number on. */
function revalidateAffected(stockEntryId?: string) {
  revalidatePath("/stock");
  if (stockEntryId) revalidatePath(`/stock/${stockEntryId}`);
  revalidatePath("/assets");
  revalidatePath("/reports");
  revalidatePath("/dashboard");
}

/**
 * Raise a write-off against CENTRAL stock.
 *
 * Nothing is deducted yet — a pending write-off freezes its quantity so it
 * cannot be dispatched out from under the manager who is about to decide, but
 * the goods stay counted as held until that decision is made.
 */
export async function createWriteOff(stockEntryId: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.STOCK_WRITEOFF_CREATE);

  const parsed = createWriteOffSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const scope = resolveStockScope(user);
  const entry = await prisma.stockEntry.findUnique({
    where: { id: stockEntryId },
    include: {
      ...availabilityInclude,
      // availabilityInclude selects only issue quantities; the visibility check
      // below also needs to know WHICH department each issue went to.
      issues: { select: { quantity: true, departmentId: true } },
      product: { select: { unit: true } },
    },
  });
  if (!entry) return { error: "That stock entry does not exist" };

  // Same visibility ladder the stock list uses — you cannot write off what you
  // are not allowed to see.
  if (!isStockVisible(entry, user, scope)) {
    return { error: "That stock entry does not exist" };
  }
  if (entry.status !== "APPROVED") {
    return { error: "Only approved stock can be written off" };
  }

  const free = availableQuantity(entry);
  if (parsed.data.quantity > free) {
    return {
      error:
        free <= 0
          ? "None of this entry is still in central stock — it has all been moved, dispatched, built with or already written off"
          : `Only ${free} ${entry.product?.unit ?? "pcs"} left that can be written off`,
    };
  }

  const writeOff = await prisma.stockWriteOff.create({
    data: {
      writeOffNumber: await nextReference("WO"),
      stockEntryId,
      // Central stock: no issue, no department. This is what tells
      // stock-availability.ts to subtract it from the entry.
      stockIssueId: null,
      departmentId: null,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
      notes: parsed.data.notes,
      raisedById: user.id,
    },
  });

  await logActivity(
    "CREATED",
    "StockWriteOff",
    writeOff.id,
    `Raised ${writeOff.writeOffNumber}: ${parsed.data.quantity} × ${entry.itemName} as ${parsed.data.reason.toLowerCase()} from central stock — ${parsed.data.notes}`
  );

  revalidateAffected(stockEntryId);
  await writeOffRaised({
    writeOffNumber: writeOff.writeOffNumber,
    itemName: entry.itemName,
    raisedById: user.id,
    locationId: entry.locationId,
    departmentId: null,
  });
  return { success: true as const, writeOffNumber: writeOff.writeOffNumber };
}

/**
 * Raise a write-off against a DEPARTMENT'S holding — its stock or its assets.
 *
 * A department's holding is its StockIssue, so this is charged against that
 * issue rather than against the entry it came from.
 */
export async function createDepartmentWriteOff(stockIssueId: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.STOCK_WRITEOFF_DEPARTMENT);

  const parsed = createWriteOffSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const issue = await prisma.stockIssue.findUnique({
    where: { id: stockIssueId },
    include: {
      ...issueWriteOffsInclude,
      department: { select: { id: true, name: true, locationId: true } },
      stockEntry: { select: { id: true, itemName: true, product: { select: { unit: true } } } },
    },
  });
  if (!issue) return { error: "That department holding does not exist" };

  // Scope: you may only report losses in a department you can see. `all`
  // reaches everywhere, `location` its own site, anything narrower its own
  // department.
  const scope = resolveStockScope(user);
  if (scope === "department" && issue.departmentId !== user.departmentId) {
    return { error: "You can only write off stock held by your own department" };
  }
  if (scope === "location" && issue.department.locationId !== user.locationId) {
    return { error: "You can only write off stock held at your own site" };
  }
  if (scope === "own" && issue.issuedById !== user.id) {
    return { error: "You can only write off stock you moved yourself" };
  }

  const free = availableFromIssue(issue);
  if (parsed.data.quantity > free) {
    // The product's own unit, already plural where it needs to be ("pcs",
    // "Mtrs"); adding an "s" to it is what produced "pcss". Entries older than
    // the catalog have no product, and "pcs" is the schema's own default.
    const unit = issue.stockEntry.product?.unit ?? "pcs";
    return {
      error:
        free <= 0
          ? "None of this holding is left to write off"
          : `${issue.department.name} only holds ${free} ${unit} of this`,
    };
  }

  const writeOff = await prisma.stockWriteOff.create({
    data: {
      writeOffNumber: await nextReference("WO"),
      stockEntryId: issue.stockEntryId,
      // Set: the loss belongs to the department, NOT to the entry.
      stockIssueId,
      departmentId: issue.departmentId,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason,
      notes: parsed.data.notes,
      raisedById: user.id,
    },
  });

  await logActivity(
    "CREATED",
    "StockWriteOff",
    writeOff.id,
    `Raised ${writeOff.writeOffNumber}: ${parsed.data.quantity} × ${issue.stockEntry.itemName} as ${parsed.data.reason.toLowerCase()} in ${issue.department.name} — ${parsed.data.notes}`
  );

  revalidateAffected(issue.stockEntryId);
  await writeOffRaised({
    writeOffNumber: writeOff.writeOffNumber,
    itemName: issue.stockEntry.itemName,
    raisedById: user.id,
    locationId: issue.department.locationId,
    departmentId: issue.departmentId,
  });
  return { success: true as const, writeOffNumber: writeOff.writeOffNumber };
}

/**
 * The manager's sign-off. THIS is what removes the stock — until it runs, the
 * goods are still counted as held.
 */
export async function approveWriteOff(id: string) {
  const user = await requirePermission(PERMISSIONS.STOCK_WRITEOFF_APPROVE);

  const writeOff = await prisma.stockWriteOff.findUnique({
    where: { id },
    include: {
      stockEntry: { include: availabilityInclude },
      stockIssue: { include: issueWriteOffsInclude },
      department: { select: { name: true, locationId: true } },
    },
  });
  if (!writeOff) return { error: "That write-off does not exist" };
  if (writeOff.status !== "PENDING") {
    return { error: "This write-off has already been decided" };
  }
  if (writeOff.raisedById === user.id) {
    return { error: SELF_APPROVAL_REFUSAL };
  }

  const scope = resolveStockScope(user);
  if (scope !== "all" && writeOff.departmentId && writeOff.departmentId !== user.departmentId) {
    return { error: "You can only approve write-offs in your own department" };
  }
  if (scope !== "all" && !writeOff.departmentId && writeOff.stockEntry.locationId !== user.locationId) {
    return { error: "You can only approve write-offs of stock at your own site" };
  }

  // This write-off is itself one of the pending ones already subtracted from
  // the figures below, so add it back before asking whether there is room for
  // it. Same correction approveTransferRequest makes, for the same reason.
  const free = writeOff.stockIssueId
    ? availableFromIssue(writeOff.stockIssue!) + writeOff.quantity
    : availableQuantity(writeOff.stockEntry) + writeOff.quantity;

  if (writeOff.quantity > free) {
    return {
      error: `Only ${free} left — the rest has been moved, dispatched or committed since this was raised`,
    };
  }

  await prisma.stockWriteOff.update({
    where: { id },
    data: { status: "APPROVED", reviewedById: user.id, reviewedAt: new Date() },
  });

  await logActivity(
    "APPROVED",
    "StockWriteOff",
    id,
    `Approved ${writeOff.writeOffNumber}: ${writeOff.quantity} × ${writeOff.stockEntry.itemName} written off as ${writeOff.reason.toLowerCase()}${writeOff.department ? ` in ${writeOff.department.name}` : " from central stock"}`
  );

  revalidateAffected(writeOff.stockEntryId);
  await writeOffDecided({ writeOffNumber: writeOff.writeOffNumber, itemName: writeOff.stockEntry.itemName, raisedById: writeOff.raisedById }, true);
  return { success: true as const };
}

/** Decline a write-off, with a reason whoever raised it can read. */
export async function rejectWriteOff(id: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.STOCK_WRITEOFF_APPROVE);

  const parsed = rejectWriteOffSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const writeOff = await prisma.stockWriteOff.findUnique({
    where: { id },
    include: { stockEntry: { select: { id: true, itemName: true, locationId: true } } },
  });
  if (!writeOff) return { error: "That write-off does not exist" };
  if (writeOff.status !== "PENDING") {
    return { error: "This write-off has already been decided" };
  }
  if (writeOff.raisedById === user.id) {
    return { error: SELF_APPROVAL_REFUSAL };
  }

  const scope = resolveStockScope(user);
  if (scope !== "all" && writeOff.departmentId && writeOff.departmentId !== user.departmentId) {
    return { error: "You can only decide write-offs in your own department" };
  }
  // A loss from central stock is decided at the site it happened, as approving is
  if (scope !== "all" && !writeOff.departmentId && writeOff.stockEntry.locationId !== user.locationId) {
    return { error: "That write-off is at another site" };
  }

  await prisma.stockWriteOff.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectionReason: parsed.data.rejectionReason,
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
  });

  await logActivity(
    "REJECTED",
    "StockWriteOff",
    id,
    `Declined ${writeOff.writeOffNumber} (${writeOff.quantity} × ${writeOff.stockEntry.itemName}) — ${parsed.data.rejectionReason}`
  );

  revalidateAffected(writeOff.stockEntryId);
  await writeOffDecided(
    { writeOffNumber: writeOff.writeOffNumber, itemName: writeOff.stockEntry.itemName, raisedById: writeOff.raisedById },
    false,
    parsed.data.rejectionReason
  );
  return { success: true as const };
}

/**
 * Undo an approved write-off, putting the quantity back.
 *
 * Approval stops careless write-offs but not mistaken ones — a stock count
 * finds the "lost" bearings behind a shelf, or the same damage gets reported by
 * two people. The record stays visible as REVERSED rather than being deleted,
 * so the correction is made in the open.
 *
 * No capacity check: this only ever gives stock back.
 */
export async function reverseWriteOff(id: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.STOCK_WRITEOFF_REVERSE);

  const parsed = reverseWriteOffSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const writeOff = await prisma.stockWriteOff.findUnique({
    where: { id },
    include: { stockEntry: { select: { id: true, itemName: true, locationId: true } } },
  });
  if (!writeOff) return { error: "That write-off does not exist" };
  if (writeOff.status !== "APPROVED") {
    return { error: "Only an approved write-off can be reversed" };
  }
  // Undoing a loss is a correction by someone else, at the site it happened
  if (writeOff.raisedById === user.id || writeOff.reviewedById === user.id) {
    return { error: "You were part of this write-off, so someone else has to reverse it" };
  }
  if (resolveStockScope(user) !== "all" && writeOff.stockEntry.locationId !== user.locationId) {
    return { error: "That write-off is at another site" };
  }

  await prisma.stockWriteOff.update({
    where: { id },
    data: {
      status: "REVERSED",
      reversalReason: parsed.data.reversalReason,
      reversedById: user.id,
      reversedAt: new Date(),
    },
  });

  await logActivity(
    "UPDATED",
    "StockWriteOff",
    id,
    `Reversed ${writeOff.writeOffNumber} — ${writeOff.quantity} × ${writeOff.stockEntry.itemName} put back. ${parsed.data.reversalReason}`
  );

  revalidateAffected(writeOff.stockEntryId);
  return { success: true as const };
}

export interface WriteOffRow {
  id: string;
  writeOffNumber: string;
  status: string;
  reason: string;
  notes: string;
  quantity: number;
  unit: string;
  itemCode: string | null;
  itemName: string;
  entryId: string;
  entryNumber: string;
  /** Where the loss happened — a department name, or central stock at a site */
  place: string;
  raisedByName: string;
  reviewedByName: string | null;
  rejectionReason: string | null;
  reversalReason: string | null;
  createdAt: Date;
  /** Null when the reader lacks stock.value.view */
  value: number | null;
  /** Whether THIS reader may act on it — the buttons are hidden otherwise */
  canDecide: boolean;
  canReverse: boolean;
}

/**
 * Every write-off this person may see, newest first.
 *
 * Scope narrows the rows exactly as it does everywhere else, and monetary worth
 * stays behind stock.value.view — a storekeeper can be trusted to report damage
 * without being shown what the damage cost.
 */
async function getWriteOffs(): Promise<WriteOffRow[]> {
  const user = await requireAnyPermission([
    PERMISSIONS.STOCK_WRITEOFF_VIEW,
    PERMISSIONS.STOCK_WRITEOFF_APPROVE,
  ]);

  const scope = resolveStockScope(user);

  // Two kinds of row need two different narrowings: a departmental write-off is
  // scoped by ITS department, a central one by the entry's own visibility.
  const where =
    scope === "all"
      ? {}
      : {
          OR: [
            // Nobody without a department has departmental write-offs to see.
            // Leaving the clause out is how "match nothing" is said here: a
            // placeholder value would have to be one no row could ever hold,
            // and the one used before was a NUL character, which PostgreSQL
            // rejects outright — the whole page crashed for such a person.
            ...(user.departmentId ? [{ departmentId: user.departmentId }] : []),
            { stockEntry: stockCandidatesWhere(user, scope) },
            { raisedById: user.id },
          ],
        };

  const rows = await prisma.stockWriteOff.findMany({
    where,
    include: {
      stockEntry: {
        select: {
          id: true,
          entryNumber: true,
          itemCode: true,
          itemName: true,
          unitPrice: true,
          createdById: true,
          departmentId: true,
          locationId: true,
          location: { select: { name: true } },
          // Both fields: isStockVisible() below reads the quantities as well as
          // the departments.
          status: true,
          quantity: true,
          issues: { select: { departmentId: true, quantity: true } },
        },
      },
      department: { select: { name: true } },
      raisedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);
  const canApprove = user.permissions.includes(PERMISSIONS.STOCK_WRITEOFF_APPROVE);
  const canReverse = user.permissions.includes(PERMISSIONS.STOCK_WRITEOFF_REVERSE);

  return rows
    // The query above narrows as far as SQL can; this finishes the job for
    // central-stock rows, the same two-step every stock list uses.
    .filter((w) => w.departmentId !== null || w.raisedById === user.id || isStockVisible(w.stockEntry, user, scope))
    .map((w) => ({
      id: w.id,
      writeOffNumber: w.writeOffNumber,
      status: w.status,
      reason: w.reason,
      notes: w.notes,
      quantity: w.quantity,
      unit: "",
      itemCode: w.stockEntry.itemCode,
      itemName: w.stockEntry.itemName,
      entryId: w.stockEntry.id,
      entryNumber: w.stockEntry.entryNumber,
      place: w.department?.name ?? `Central Stock (${w.stockEntry.location?.name ?? "Unassigned"})`,
      raisedByName: w.raisedBy.name,
      reviewedByName: w.reviewedBy?.name ?? null,
      rejectionReason: w.rejectionReason,
      reversalReason: w.reversalReason,
      createdAt: w.createdAt,
      value: canSeeValue ? round(w.quantity * w.stockEntry.unitPrice) : null,
      // Never render a button the action would refuse. Deciding your own
      // write-off is refused by approveWriteOff, so it must not be offered.
      canDecide: canApprove && w.status === "PENDING" && w.raisedById !== user.id,
      canReverse: canReverse && w.status === "APPROVED",
    }));
}

/**
 * What this person could report as lost, for the Wastage page's own "Report
 * wastage" button.
 *
 * Reporting used to start from a stock entry or from a department's assets,
 * which meant finding the goods first and the Wastage page could only ever
 * show what others had raised. This lists both kinds of holding in one go:
 *
 *   entry  central stock, charged against the stock entry
 *   issue  a department's holding, charged against that issue only
 *
 * The two are separate grants, so each kind is offered only to whoever may
 * actually raise it — `stock.writeoff.create` for central stock,
 * `stock.writeoff.department` for a department's holding. Nothing is listed
 * that the create action would then refuse, which is the rule the review queue
 * already follows: never render work somebody cannot do.
 *
 * Only what is genuinely free is offered — anything already dispatched, built
 * with, moved or written off is gone, and `availableQuantity` / 
 * `availableFromIssue` are the same functions the two create actions check
 * against, so nothing offered here is refused on submit. Visibility is the
 * stock list's own rule, so this can show nothing the person could not
 * already open.
 */
export type WriteOffCandidate = {
  /** Which action raises it — central stock, or a department's holding */
  target: { kind: "entry"; stockEntryId: string } | { kind: "issue"; stockIssueId: string; departmentName: string };
  key: string;
  entryNumber: string;
  itemCode: string | null;
  itemName: string;
  unit: string;
  batchNumber: string | null;
  place: string;
  available: number;
  isAsset: boolean;
};

export async function getWriteOffCandidates(): Promise<WriteOffCandidate[]> {
  const user = await requireAnyPermission(WRITE_OFF_RAISE_PERMISSIONS);
  const scope = resolveStockScope(user);
  const mayRaiseCentral = user.permissions.includes(PERMISSIONS.STOCK_WRITEOFF_CREATE);
  const mayRaiseDepartment = user.permissions.includes(PERMISSIONS.STOCK_WRITEOFF_DEPARTMENT);

  const entries = await prisma.stockEntry.findMany({
    where: { status: "APPROVED", ...stockCandidatesWhere(user, scope) },
    include: {
      ...availabilityInclude,
      issues: {
        select: {
          id: true,
          quantity: true,
          departmentId: true,
          issuedById: true,
          department: { select: { name: true, locationId: true } },
          ...issueWriteOffsInclude,
        },
      },
      product: { select: { unit: true } },
      location: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const candidates: WriteOffCandidate[] = [];
  for (const entry of entries) {
    if (!isStockVisible(entry, user, scope)) continue;
    const unit = entry.product?.unit ?? "pcs";
    const site = entry.location?.name ?? "Unassigned";

    const central = round(availableQuantity(entry));
    if (mayRaiseCentral && central > 0) {
      candidates.push({
        target: { kind: "entry", stockEntryId: entry.id },
        key: `entry:${entry.id}`,
        entryNumber: entry.entryNumber,
        itemCode: entry.itemCode,
        itemName: entry.itemName,
        unit,
        batchNumber: entry.batchNumber,
        place: `Central Stock (${site})`,
        available: central,
        isAsset: entry.isAsset,
      });
    }

    if (!mayRaiseDepartment) continue;
    for (const issue of entry.issues) {
      // The same three refusals createDepartmentWriteOff makes, so nothing is
      // offered here that it would then turn down.
      if (scope === "department" && issue.departmentId !== user.departmentId) continue;
      if (scope === "location" && issue.department.locationId !== user.locationId) continue;
      if (scope === "own" && issue.issuedById !== user.id) continue;

      const held = round(availableFromIssue(issue));
      if (held <= 0) continue;
      candidates.push({
        target: { kind: "issue", stockIssueId: issue.id, departmentName: issue.department.name },
        key: `issue:${issue.id}`,
        entryNumber: entry.entryNumber,
        itemCode: entry.itemCode,
        itemName: entry.itemName,
        unit,
        batchNumber: entry.batchNumber,
        place: issue.department.name,
        available: held,
        isAsset: entry.isAsset,
      });
    }
  }
  return candidates;
}

/**
 * The wastage report: what has actually been lost, and to what.
 *
 * Only APPROVED write-offs count as loss. Pending ones have not been agreed,
 * and rejected or reversed ones were never real, so folding any of them into
 * these totals would overstate the damage.
 */
export async function getWastageSummary() {
  const user = await requirePermission(PERMISSIONS.STOCK_WRITEOFF_VIEW);
  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);

  const rows = await getWriteOffs();
  const approved = rows.filter((r) => r.status === "APPROVED");

  function tally(keyOf: (row: WriteOffRow) => string) {
    const map = new Map<string, { key: string; quantity: number; value: number; count: number }>();
    for (const row of approved) {
      const key = keyOf(row);
      const bucket = map.get(key) ?? { key, quantity: 0, value: 0, count: 0 };
      bucket.quantity = round(bucket.quantity + row.quantity);
      bucket.value = round(bucket.value + (row.value ?? 0));
      bucket.count += 1;
      map.set(key, bucket);
    }
    return [...map.values()].sort((a, b) =>
      canSeeValue ? b.value - a.value : b.quantity - a.quantity
    );
  }

  return {
    rows,
    pendingCount: rows.filter((r) => r.status === "PENDING").length,
    approvedCount: approved.length,
    totalQuantity: round(approved.reduce((sum, r) => sum + r.quantity, 0)),
    totalValue: canSeeValue
      ? round(approved.reduce((sum, r) => sum + (r.value ?? 0), 0))
      : null,
    byReason: tally((r) => r.reason),
    byItem: tally((r) => r.itemName),
    byPlace: tally((r) => r.place),
  };
}
