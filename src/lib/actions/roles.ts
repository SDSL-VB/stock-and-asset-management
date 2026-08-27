"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission, holdsRole } from "@/lib/rbac/check";
import { PERMISSIONS, ROLES } from "@/lib/rbac/permissions";
import { logActivity } from "./activity";
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

export async function getAllPermissions() {
  return prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { key: "asc" }],
  });
}

export async function updateRolePermissions(
  roleId: string,
  permissionIds: string[]
) {
  const currentUser = await requirePermission(PERMISSIONS.ROLES_EDIT);

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) return { error: "Role not found" };

  // Prevent non-Super Admin from modifying Super Admin role
  if (role.name === ROLES.SUPER_ADMIN && !holdsRole(currentUser, ROLES.SUPER_ADMIN)) {
    return { error: "Only the Super Admin can modify the Super Admin role" };
  }

  // Replace all permissions
  await prisma.rolePermission.deleteMany({ where: { roleId } });

  if (permissionIds.length > 0) {
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
    });
  }

  await logActivity(
    "UPDATED",
    "Role",
    roleId,
    `Updated permissions for ${role.name} (${permissionIds.length} permissions)`
  );

  revalidatePath("/roles");
  revalidatePath(`/roles/${roleId}`);
  return { success: true };
}

export async function updateRoleHierarchy(roleId: string, hierarchyLevel: number) {
  await requirePermission(PERMISSIONS.ROLES_EDIT);

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) return { error: "Role not found" };

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

export async function createRole(data: { name: string; description?: string; isSystem?: boolean }) {
  // Purely permission-gated (roles.create) — no role-name checks
  await requirePermission(PERMISSIONS.ROLES_CREATE);

  const existing = await prisma.role.findUnique({
    where: { name: data.name },
  });
  if (existing) return { error: "A role with this name already exists" };

  // New roles join at the bottom of the hierarchy: one level below the
  // current lowest-ranked role (never the schema default of 99)
  const lowest = await prisma.role.aggregate({ _max: { hierarchyLevel: true } });
  const nextLevel = Math.max((lowest._max.hierarchyLevel ?? 1) + 1, 2);

  const role = await prisma.role.create({
    data: {
      name: data.name,
      description: data.description,
      isSystem: data.isSystem ?? false,
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
  await requirePermission(PERMISSIONS.ROLES_DELETE);

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
  if (role._count.users > 0)
    return { error: "Cannot delete a role that has users assigned to it" };
  if (role._count.heldAsAdditional > 0)
    return {
      error: `${role._count.heldAsAdditional} ${role._count.heldAsAdditional === 1 ? "person holds" : "people hold"} this as an additional role. Remove it from them first.`,
    };
  if (role._count.approvalSteps > 0)
    return {
      error: "This role is used as an approver in an approval flow. Remove it from the flow first (Stock Config → Approval Flows).",
    };

  await prisma.rolePermission.deleteMany({ where: { roleId: id } });
  await prisma.role.delete({ where: { id } });

  await logActivity("DELETED", "Role", id, `Deleted role "${role.name}"`);

  revalidatePath("/roles");
  return { success: true };
}
