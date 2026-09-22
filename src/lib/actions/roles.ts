"use server";

import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { requirePermission, requireAnyPermission, holdsRole } from "@/lib/rbac/check";
import { PERMISSIONS, ROLES } from "@/lib/rbac/permissions";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";

/**
 * Roles: bags of permissions that people hold.
 *
 * Called by: the Roles pages and the role pickers on a profile.
 *
 * A role is only ever a convenient bundle. Nothing in the application asks
 * "is this person a Department Manager?" to decide what they may do — it asks
 * whether they hold a key. That is what lets a role be edited live, and what
 * lets one person hold several.
 *
 * Rank (`hierarchyLevel`, lower is stronger) is the exception: it decides who
 * may hand a role out, so nobody can promote someone past themselves.
 */

export async function getRoles() {
  await requirePermission(PERMISSIONS.ROLES_VIEW);

  return prisma.role.findMany({
    include: {
      // "users" counts people whose MAIN role this is; "heldAsAdditional"
      // counts people who hold it on top of another. Both are real holders.
      _count: { select: { users: true, heldAsAdditional: true } },
      permissions: {
        include: { permission: true },
      },
    },
    orderBy: { hierarchyLevel: "asc" },
  });
}

export async function getRoleById(id: string) {
  await requirePermission(PERMISSIONS.ROLES_VIEW);

  return prisma.role.findUnique({
    where: { id },
    include: {
      // "users" counts people whose MAIN role this is; "heldAsAdditional"
      // counts people who hold it on top of another. Both are real holders.
      _count: { select: { users: true, heldAsAdditional: true } },
      permissions: {
        include: { permission: true },
      },
    },
  });
}

/**
 * Whether the signed-in person may change a role: the Super Admin any role but
 * their own kind's protection aside; anyone else only a role strictly junior to
 * their own, and never one they hold — otherwise editing roles is a way to
 * promote yourself.
 */
function refusalToEditRole(
  currentUser: { role: string; roles?: string[]; hierarchyLevel: number },
  role: { name: string; hierarchyLevel: number }
): string | null {
  if (holdsRole(currentUser, ROLES.SUPER_ADMIN)) return null;
  if (role.name === ROLES.SUPER_ADMIN) return "Only the Super Admin can change the Super Admin role";
  if (holdsRole(currentUser, role.name)) return "You cannot change a role you hold yourself";
  if (role.hierarchyLevel <= currentUser.hierarchyLevel) return `${role.name} is at or above your rank, so you cannot change it`;
  return null;
}

export async function getAllPermissions() {
  await requireAnyPermission([PERMISSIONS.ROLES_VIEW, PERMISSIONS.ROLES_EDIT, PERMISSIONS.ROLES_CREATE]);
  return prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { key: "asc" }],
  });
}

export async function updateRolePermissions(
  roleId: string,
  permissionIds: string[]
) {
  const currentUser = await requirePermission(PERMISSIONS.ROLES_EDIT);

  const ids = z.array(z.string()).max(500).safeParse(permissionIds);
  if (!ids.success) return { error: "That is not a list of permissions" };
  const wanted = [...new Set(ids.data)];

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { select: { permissionId: true } } },
  });
  if (!role) return { error: "Role not found" };
  const refusal = refusalToEditRole(currentUser, role);
  if (refusal) return { error: refusal };

  // Every id must be a real permission, and anything ADDED must be one the
  // editor holds — the same ceiling as granting to a person
  const permissions = await prisma.permission.findMany({ where: { id: { in: wanted } }, select: { id: true, key: true } });
  if (permissions.length !== wanted.length) return { error: "One of those permissions does not exist" };
  const had = new Set(role.permissions.map((p) => p.permissionId));
  const beyond = permissions.find((p) => !had.has(p.id) && !currentUser.permissions.includes(p.key));
  if (beyond && !holdsRole(currentUser, ROLES.SUPER_ADMIN)) {
    return { error: `You can only add permissions you hold yourself (${beyond.key})` };
  }

  // Replace all permissions, together or not at all
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({ data: wanted.map((permissionId) => ({ roleId, permissionId })) }),
  ]);

  await logActivity(
    "UPDATED",
    "Role",
    roleId,
    `Updated permissions for ${role.name} (${wanted.length} permissions)`
  );

  revalidatePath("/roles");
  revalidatePath(`/roles/${roleId}`);
  return { success: true };
}

export async function updateRoleHierarchy(roleId: string, hierarchyLevel: number) {
  const currentUser = await requirePermission(PERMISSIONS.ROLES_EDIT);
  if (!Number.isInteger(hierarchyLevel)) return { error: "A rank is a whole number" };

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) return { error: "Role not found" };
  const refusal = refusalToEditRole(currentUser, role);
  if (refusal) return { error: refusal };
  // Nobody lifts a role to their own rank or above
  if (!holdsRole(currentUser, ROLES.SUPER_ADMIN) && hierarchyLevel <= currentUser.hierarchyLevel) {
    return { error: "You can only place a role below your own rank" };
  }

  // Super Admin (0) and Admin (1) are fixed at the top of the hierarchy
  if (role.name === ROLES.SUPER_ADMIN || role.name === ROLES.ADMIN) {
    return { error: "The hierarchy of Super Admin and Admin cannot be changed" };
  }
  if (hierarchyLevel < 2) {
    return { error: "Levels 0 and 1 are reserved for Super Admin and Admin" };
  }

  await prisma.role.update({
    where: { id: roleId },
    data: { hierarchyLevel },
  });

  await logActivity(
    "UPDATED",
    "Role",
    roleId,
    `Updated hierarchy level for "${role.name}" to ${hierarchyLevel}`
  );

  revalidatePath("/roles");
  return { success: true };
}

export async function createRole(data: { name: string; description?: string }) {
  await requirePermission(PERMISSIONS.ROLES_CREATE);
  const parsed = z
    .object({ name: z.string().trim().min(2, "Give the role a name").max(60), description: z.string().trim().max(300).optional() })
    .safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, description } = parsed.data;

  const existing = await prisma.role.findUnique({
    where: { name },
  });
  if (existing) return { error: "A role with this name already exists" };

  // New roles join at the bottom of the hierarchy: one level below the
  // current lowest-ranked role (never the schema default of 99)
  const lowest = await prisma.role.aggregate({ _max: { hierarchyLevel: true } });
  const nextLevel = Math.max((lowest._max.hierarchyLevel ?? 1) + 1, 2);

  const role = await prisma.role.create({
    data: {
      name,
      description,
      // Protected (undeletable) roles are made by the setup script, never here
      isSystem: false,
      hierarchyLevel: nextLevel,
    },
  });

  await logActivity(
    "CREATED",
    "Role",
    role.id,
    `Created ${role.isSystem ? "system " : ""}role "${role.name}"`
  );

  revalidatePath("/roles");
  return { success: true, role };
}

export async function deleteRole(id: string) {
  const currentUser = await requirePermission(PERMISSIONS.ROLES_DELETE);

  const role = await prisma.role.findUnique({
    where: { id },
    include: {
      // Both ways of holding a role count: as someone's main role, and as one
      // they hold on top of it. Missing the second would delete a role out from
      // under the people relying on it.
      _count: { select: { users: true, heldAsAdditional: true, approvalSteps: true } },
    },
  });

  if (!role) return { error: "Role not found" };
  if (role.isSystem) return { error: "System roles cannot be deleted" };
  const refusal = refusalToEditRole(currentUser, role);
  if (refusal) return { error: refusal };
  if (role._count.users > 0)
    return { error: "Cannot delete a role that has users assigned to it" };
  if (role._count.heldAsAdditional > 0)
    return {
      error: `${role._count.heldAsAdditional} ${role._count.heldAsAdditional === 1 ? "person holds" : "people hold"} this as an additional role. Remove it from them first.`,
    };
  if (role._count.approvalSteps > 0)
    return {
      error: "This role is named as an approver in the stock approval flow, so it cannot be deleted.",
    };

  await prisma.rolePermission.deleteMany({ where: { roleId: id } });
  await prisma.role.delete({ where: { id } });

  await logActivity("DELETED", "Role", id, `Deleted role "${role.name}"`);

  revalidatePath("/roles");
  return { success: true };
}
