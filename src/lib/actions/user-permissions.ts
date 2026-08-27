"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { grantPermissionSchema } from "@/lib/validations/bom";
import { missingDependencies, reasonFor } from "@/lib/rbac/permission-dependencies";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

/**
 * A permission held by one person on top of their role.
 *
 * Real people do more than their job title says, and the alternative — granting
 * a capability to every holder of a role, or inventing a role per person — is
 * worse. Four rules keep it safe:
 *
 *   grants only     it can add a capability, never remove one, so "why can't
 *                   she do this?" is always answered by looking at her role
 *   never yourself  the control does not appear on your own profile
 *   never upward    you can only hand out what you hold
 *   always reasoned a reason is required and kept next to the grant forever
 *
 * Expiry is offered and enforced only when a date was actually chosen. It is
 * evaluated when permissions are read, so nothing has to run on a schedule.
 */

/** Everything a person holds, split into what their role gives and what was added. */
export async function getUserPermissionDetail(userId: string) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_PERMISSIONS_GRANT);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      isSystem: true,
      role: {
        select: {
          name: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
      extraPermissions: {
        include: {
          permission: true,
          grantedBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!user) return null;

  const fromRole = new Set(user.role.permissions.map((rp) => rp.permission.key));

  // You can only hand out what you hold yourself — the ceiling on escalation
  const grantable = await prisma.permission.findMany({
    where: {
      key: { in: currentUser.permissions },
      NOT: { key: { in: [...fromRole] } },
    },
    orderBy: [{ module: "asc" }, { name: "asc" }],
  });

  const now = new Date();

  return {
    user: { id: user.id, name: user.name, roleName: user.role.name },
    // Granting to yourself is refused server-side; the UI simply does not offer it
    isSelf: user.id === currentUser.id,
    isSystem: user.isSystem,
    rolePermissionCount: fromRole.size,
    grants: user.extraPermissions.map((g) => ({
      id: g.id,
      key: g.permission.key,
      name: g.permission.name,
      module: g.permission.module,
      description: g.permission.description,
      reason: g.reason,
      expiresAt: g.expiresAt,
      expired: !!g.expiresAt && g.expiresAt <= now,
      grantedByName: g.grantedBy.name,
      createdAt: g.createdAt,
    })),
    // Already-granted keys are excluded so the picker cannot duplicate one
    grantable: grantable
      .filter((p) => !user.extraPermissions.some((g) => g.permissionId === p.id))
      .map((p) => ({
        key: p.key,
        name: p.name,
        module: p.module,
        description: p.description,
      })),
  };
}

export async function grantPermission(userId: string, data: unknown) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_PERMISSIONS_GRANT);

  const parsed = grantPermissionSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  if (userId === currentUser.id) {
    return { error: "You cannot grant a permission to yourself" };
  }

  const { permissionKey, reason, expiresAt } = parsed.data;

  // The ceiling: nobody hands out more than they hold
  if (!currentUser.permissions.includes(permissionKey)) {
    return { error: "You can only grant permissions you hold yourself" };
  }

  const [user, permission] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        isSystem: true,
        role: {
          select: { name: true, permissions: { select: { permission: { select: { key: true } } } } },
        },
      },
    }),
    prisma.permission.findUnique({ where: { key: permissionKey } }),
  ]);

  if (!user) return { error: "That person does not exist" };
  if (user.isSystem) return { error: "That is a system account and cannot be changed" };
  if (!permission) return { error: "That permission does not exist" };

  if (user.role.permissions.some((rp) => rp.permission.key === permissionKey)) {
    return { error: `${user.role.name} already carries that permission` };
  }

  // Everything this person can already do — their role plus grants that have
  // not expired — so a dependency they already hold is not asked about again.
  const now = new Date();
  const existingGrants = await prisma.userPermission.findMany({
    where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { permission: { select: { key: true } } },
  });
  const held = new Set([
    ...user.role.permissions.map((rp) => rp.permission.key),
    ...existingGrants.map((g) => g.permission.key),
  ]);

  // A permission that cannot work alone is worth saying so before it is saved,
  // not after someone reports the button never appeared.
  const missing = missingDependencies(permissionKey, held);
  if (missing.length > 0 && !parsed.data.alsoGrant) {
    const names = await prisma.permission.findMany({
      where: { key: { in: missing } },
      select: { key: true, name: true },
    });
    return {
      needsLinked: true,
      permissionName: permission.name,
      reason: reasonFor(permissionKey) ?? "It depends on another permission.",
      missing: names,
    };
  }

  let expiry: Date | null = null;
  if (expiresAt) {
    const parsedDate = new Date(expiresAt);
    if (Number.isNaN(parsedDate.getTime())) return { error: "That expiry date is not a real date" };
    // End of the chosen day, so "ends 30 Sep" means it works all of 30 Sep
    parsedDate.setHours(23, 59, 59, 999);
    if (parsedDate <= new Date()) return { error: "The expiry date is already in the past" };
    expiry = parsedDate;
  }

  // The dependencies go in alongside it, sharing the expiry — a permission that
  // outlives the thing it exists to support would be the same silent dead end
  // in reverse.
  const linked =
    missing.length > 0
      ? await prisma.permission.findMany({ where: { key: { in: missing } } })
      : [];

  await prisma.$transaction([
    prisma.userPermission.create({
      data: {
        userId,
        permissionId: permission.id,
        reason: reason.trim(),
        expiresAt: expiry,
        grantedById: currentUser.id,
      },
    }),
    ...linked.map((dep) =>
      prisma.userPermission.create({
        data: {
          userId,
          permissionId: dep.id,
          reason: `Needed by "${permission.name}" — ${reason.trim()}`,
          expiresAt: expiry,
          grantedById: currentUser.id,
        },
      })
    ),
  ]);

  await logActivity(
    "UPDATED",
    "User",
    userId,
    `Granted ${user.name} the extra permission "${permission.name}" (${permission.key})${linked.length > 0 ? ` plus ${linked.length} it depends on` : ""}${expiry ? `, expiring ${expiry.toLocaleDateString("en-IN")}` : ""} — ${reason.trim()}`
  );

  revalidatePath(`/users/${userId}`);
  revalidatePath("/roles");
  return { success: true };
}

export async function revokePermission(grantId: string) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_PERMISSIONS_GRANT);

  const grant = await prisma.userPermission.findUnique({
    where: { id: grantId },
    include: {
      permission: { select: { key: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!grant) return { error: "That grant no longer exists" };
  if (grant.userId === currentUser.id) {
    return { error: "You cannot change your own permissions" };
  }

  await prisma.userPermission.delete({ where: { id: grantId } });

  await logActivity(
    "UPDATED",
    "User",
    grant.userId,
    `Removed the extra permission "${grant.permission.name}" (${grant.permission.key}) from ${grant.user.name}`
  );

  revalidatePath(`/users/${grant.userId}`);
  revalidatePath("/roles");
  return { success: true };
}

