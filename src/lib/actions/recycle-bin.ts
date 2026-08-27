"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveRecycleBinScope } from "@/lib/rbac/permissions";
import {
  applyRelinks,
  reviveDates,
  COMMON_DATES,
  ENTITY_LABELS,
  RECYCLE_BIN_DAYS,
  type Relink,
  type RecycleEntity,
} from "@/lib/recycle-bin";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

/**
 * Restoring is per-entity because only the entity knows its own shape: which
 * columns are dates, and what has to exist before the row can come back.
 * A generic restorer would have to guess, and guessing wrong here means a
 * half-restored record.
 */
const RESTORERS: Record<
  RecycleEntity,
  {
    dates: string[];
    /** Anything that must still exist for the row to be valid again */
    check?: (tx: Prisma.TransactionClient, row: Record<string, unknown>) => Promise<string | null>;
    revalidate: string[];
  }
> = {
  User: {
    dates: [...COMMON_DATES, "passwordSetAt"],
    check: async (tx, row) => {
      const clash = await tx.user.findUnique({ where: { email: String(row.email) } });
      if (clash) return `Someone else is now using the email ${row.email}.`;
      const role = await tx.role.findUnique({ where: { id: String(row.roleId) } });
      if (!role) return "The role this person had no longer exists.";
      return null;
    },
    revalidate: ["/users"],
  },
  Product: {
    dates: COMMON_DATES,
    check: async (tx, row) => {
      const clash = await tx.product.findUnique({ where: { code: String(row.code) } });
      if (clash) return `The code ${row.code} has been taken by another product.`;
      const category = await tx.productCategory.findUnique({
        where: { id: String(row.categoryId) },
      });
      if (!category) return "The category this product belonged to no longer exists.";
      return null;
    },
    revalidate: ["/stock/products", "/bom"],
  },
  ProductCategory: {
    dates: COMMON_DATES,
    check: async (tx, row) => {
      const byName = await tx.productCategory.findFirst({ where: { name: String(row.name) } });
      if (byName) return `A category called ${row.name} already exists.`;
      if (row.codePrefix) {
        const byPrefix = await tx.productCategory.findFirst({
          where: { codePrefix: String(row.codePrefix) },
        });
        if (byPrefix) return `The code prefix ${row.codePrefix} has been taken.`;
      }
      return null;
    },
    revalidate: ["/stock/products"],
  },
  Vendor: {
    dates: COMMON_DATES,
    check: async (tx, row) => {
      const clash = await tx.vendor.findFirst({ where: { name: String(row.name) } });
      return clash ? `A vendor called ${row.name} already exists.` : null;
    },
    revalidate: ["/vendors"],
  },
  Client: {
    dates: COMMON_DATES,
    check: async (tx, row) => {
      const clash = await tx.client.findFirst({ where: { name: String(row.name) } });
      return clash ? `A client called ${row.name} already exists.` : null;
    },
    revalidate: ["/clients", "/dispatch"],
  },
  BillOfMaterials: {
    dates: [...COMMON_DATES, "submittedAt", "approvedAt"],
    check: async (tx, row) => {
      const product = await tx.product.findUnique({ where: { id: String(row.productId) } });
      if (!product) return "The product this belonged to no longer exists.";
      const clash = await tx.billOfMaterials.findFirst({
        where: { productId: String(row.productId), version: Number(row.version) },
      });
      if (clash) return `Version ${row.version} already exists again for that product.`;
      return null;
    },
    revalidate: ["/bom"],
  },
};

/** What is currently recoverable, newest first. Expired entries are cleared on read. */
export async function getRecycleBin() {
  const user = await requireAnyPermission([
    PERMISSIONS.RECYCLEBIN_VIEW,
    PERMISSIONS.RECYCLEBIN_RESTORE,
  ]);

  // Ageing out happens here rather than on a schedule — the same trick the
  // permission grants use, and one less thing that can silently stop running.
  await prisma.deletedRecord.deleteMany({ where: { expiresAt: { lte: new Date() } } });

  // Your own bin unless you hold the wide key. This is what makes the bin safe
  // to give to everybody: undoing your own mistake never means reading what
  // anyone else threw away.
  const scope = resolveRecycleBinScope(user);

  const records = await prisma.deletedRecord.findMany({
    where: scope === "all" ? {} : { deletedById: user.id },
    include: { deletedBy: { select: { name: true } } },
    orderBy: { deletedAt: "desc" },
    take: 300,
  });

  return records.map((r) => ({
    id: r.id,
    entity: r.entity,
    entityLabel: ENTITY_LABELS[r.entity as RecycleEntity] ?? r.entity,
    label: r.label,
    deletedByName: r.deletedBy.name,
    deletedAt: r.deletedAt,
    expiresAt: r.expiresAt,
    /** Rows that will be re-pointed back if this is restored */
    relinkCount: ((r.relinks as unknown as Relink[]) ?? []).reduce(
      (sum, l) => sum + l.ids.length,
      0
    ),
  }));
}

/**
 * Puts a deleted record back under its original id, then re-points whatever was
 * unlinked on the way out.
 *
 * If something else has taken a unique value in the meantime it refuses with a
 * plain explanation rather than restoring half of it.
 */
export async function restoreRecord(recordId: string) {
  const user = await requirePermission(PERMISSIONS.RECYCLEBIN_RESTORE);

  const record = await prisma.deletedRecord.findUnique({ where: { id: recordId } });
  if (!record) return { error: "That is no longer in the recycle bin" };

  // Same rule as reading the bin: your own deletions unless you hold the wide
  // key. Without this, own-scope hid other people's rows from the list while
  // still letting them be restored by id.
  if (resolveRecycleBinScope(user) !== "all" && record.deletedById !== user.id) {
    return { error: "That was deleted by someone else, so it is not in your bin" };
  }

  if (record.expiresAt <= new Date()) {
    return { error: `That was deleted more than ${RECYCLE_BIN_DAYS} days ago and has aged out` };
  }

  const restorer = RESTORERS[record.entity as RecycleEntity];
  if (!restorer) return { error: `Nothing here knows how to restore a ${record.entity}` };

  const snapshot = record.snapshot as Record<string, unknown>;
  const relinks = (record.relinks as unknown as Relink[]) ?? [];

  try {
    await prisma.$transaction(async (tx) => {
      if (restorer.check) {
        const problem = await restorer.check(tx, snapshot);
        if (problem) throw new Error(`SOFT:${problem} Restoring would clash, so nothing was changed.`);
      }

      const data = reviveDates(snapshot, restorer.dates);

      const delegate = (tx as unknown as Record<string, {
        create: (args: unknown) => Promise<unknown>;
      }>)[lowerFirst(record.entity)];
      if (!delegate) throw new Error(`SOFT:Cannot restore a ${record.entity}`);

      await delegate.create({ data });
      await applyRelinks(tx, relinks, record.entityId);
      await tx.deletedRecord.delete({ where: { id: recordId } });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Restore failed";
    if (message.startsWith("SOFT:")) return { error: message.slice(5) };
    throw e;
  }

  await logActivity(
    "CREATED",
    record.entity,
    record.entityId,
    `Restored ${ENTITY_LABELS[record.entity as RecycleEntity] ?? record.entity} "${record.label}" from the recycle bin`
  );

  for (const path of restorer.revalidate) revalidatePath(path);
  revalidatePath("/recycle-bin");
  return { success: true, label: record.label, restoredBy: user.name };
}

/** Empties one entry for good, before its 30 days are up. */
export async function purgeRecord(recordId: string) {
  const user = await requirePermission(PERMISSIONS.RECYCLEBIN_PURGE);

  const record = await prisma.deletedRecord.findUnique({ where: { id: recordId } });
  if (!record) return { error: "That is no longer in the recycle bin" };

  if (resolveRecycleBinScope(user) !== "all" && record.deletedById !== user.id) {
    return { error: "That was deleted by someone else, so it is not in your bin" };
  }

  await prisma.deletedRecord.delete({ where: { id: recordId } });

  await logActivity(
    "DELETED",
    record.entity,
    record.entityId,
    `Permanently removed "${record.label}" from the recycle bin — it can no longer be restored`
  );

  revalidatePath("/recycle-bin");
  return { success: true };
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
