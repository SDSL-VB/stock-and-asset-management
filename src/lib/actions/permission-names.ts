"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { logActivity } from "@/lib/activity-log";

/**
 * What each permission is CALLED. The key (`stock.approve`) is what the code
 * checks and never changes here; the name and description are only the words
 * people read on the Roles page, profiles and grant dialogs — all of which read
 * them from this table, so one edit shows everywhere.
 */

export async function getPermissionNames() {
  await requirePermission(PERMISSIONS.PERMISSIONS_RENAME);
  return prisma.permission.findMany({
    select: { id: true, key: true, name: true, description: true, module: true },
    orderBy: [{ module: "asc" }, { key: "asc" }],
  });
}

const renameSchema = z.object({
  name: z.string().trim().min(2, "Give it a name").max(60, "Keep the name under 60 characters"),
  description: z.string().trim().max(300, "Keep the description under 300 characters"),
});

export async function renamePermission(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.PERMISSIONS_RENAME);
  const parsed = renameSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const current = await prisma.permission.findUnique({ where: { id } });
  if (!current) return { error: "That permission was not found" };
  // Two permissions with one name would be impossible to tell apart on a role
  const clash = await prisma.permission.findFirst({
    where: { id: { not: id }, name: { equals: parsed.data.name, mode: "insensitive" } },
    select: { key: true },
  });
  if (clash) return { error: `"${parsed.data.name}" is already the name of ${clash.key}` };

  const description = parsed.data.description || null;
  if (current.name === parsed.data.name && current.description === description) return { success: true };
  await prisma.permission.update({ where: { id }, data: { name: parsed.data.name, description } });
  await logActivity(
    "UPDATED",
    "Permission",
    id,
    current.name === parsed.data.name
      ? `Reworded the description of "${current.name}" (${current.key})`
      : `Renamed permission ${current.key}: "${current.name}" → "${parsed.data.name}"`
  );
  // Names appear on many pages; refresh them all
  revalidatePath("/", "layout");
  return { success: true };
}
