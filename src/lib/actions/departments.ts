"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { departmentSchema } from "@/lib/validations/department";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

/**
 * Departments — the unit that owns stock, people, and a site.
 *
 * Called by: the Departments pages, and every picker that asks "which
 * department?".
 *
 * The one thing to know: a department carries the LOCATION, and a person's site
 * is inherited from their department rather than stored on them. That is why
 * Super Admin and Admin, who belong to no department, are never narrowed by
 * site — and why moving someone between departments moves their site with them.
 */

export async function getDepartments() {
  await requirePermission(PERMISSIONS.DEPARTMENTS_VIEW);

  return prisma.department.findMany({
    include: {
      _count: { select: { users: true } },
      location: { select: { id: true, name: true, code: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getDepartmentById(id: string) {
  await requirePermission(PERMISSIONS.DEPARTMENTS_VIEW);

  return prisma.department.findUnique({
    where: { id },
    include: {
      _count: { select: { users: true } },
      location: { select: { id: true, name: true, code: true } },
      users: {
        include: {
          role: { select: { name: true } },
        },
        orderBy: { name: "asc" },
      },
    },
  });
}

export async function createDepartment(data: unknown) {
  await requirePermission(PERMISSIONS.DEPARTMENTS_CREATE);

  const parsed = departmentSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const existing = await prisma.department.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) return { error: "A department with this name already exists" };

  const dept = await prisma.department.create({
    data: { ...parsed.data, locationId: parsed.data.locationId || null },
  });

  await logActivity(
    "CREATED",
    "Department",
    dept.id,
    `Created department "${dept.name}"`
  );

  revalidatePath("/departments");
  return { success: true, department: dept };
}

export async function updateDepartment(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.DEPARTMENTS_EDIT);

  const parsed = departmentSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const existing = await prisma.department.findFirst({
    where: { name: parsed.data.name, id: { not: id } },
  });
  if (existing) return { error: "A department with this name already exists" };

  const dept = await prisma.department.update({
    where: { id },
    data: { ...parsed.data, locationId: parsed.data.locationId || null },
  });

  await logActivity(
    "UPDATED",
    "Department",
    dept.id,
    `Updated department "${dept.name}"`
  );

  revalidatePath("/departments");
  revalidatePath(`/departments/${id}`);
  return { success: true, department: dept };
}

// Active users not currently in the given department — candidates for adding
export async function getAssignableUsers(departmentId: string) {
  await requirePermission(PERMISSIONS.USERS_EDIT);

  return prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ departmentId: null }, { departmentId: { not: departmentId } }],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: { select: { name: true } },
      department: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function addUserToDepartment(userId: string, departmentId: string) {
  await requirePermission(PERMISSIONS.USERS_EDIT);

  const [user, department] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true } }),
    prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, name: true, isActive: true } }),
  ]);
  if (!user) return { error: "User not found" };
  if (!department) return { error: "Department not found" };
  if (!department.isActive) return { error: "Cannot add members to an inactive department" };

  await prisma.user.update({ where: { id: userId }, data: { departmentId } });

  await logActivity(
    "UPDATED",
    "User",
    userId,
    `Added ${user.name} to department "${department.name}"`
  );

  revalidatePath(`/departments/${departmentId}`);
  revalidatePath("/departments");
  revalidatePath("/users");
  return { success: true };
}

export async function removeUserFromDepartment(userId: string) {
  await requirePermission(PERMISSIONS.USERS_EDIT);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, departmentId: true, department: { select: { name: true } } },
  });
  if (!user) return { error: "User not found" };
  if (!user.departmentId) return { error: "User is not in a department" };

  await prisma.user.update({ where: { id: userId }, data: { departmentId: null } });

  await logActivity(
    "UPDATED",
    "User",
    userId,
    `Removed ${user.name} from department "${user.department?.name}"`
  );

  revalidatePath(`/departments/${user.departmentId}`);
  revalidatePath("/departments");
  revalidatePath("/users");
  return { success: true };
}

// Permanently delete a department. Blocked while anything still references it —
// deactivate (toggle) instead to hide it from new activity but keep history.
export async function deleteDepartment(id: string) {
  await requirePermission(PERMISSIONS.DEPARTMENTS_DELETE);

  const dept = await prisma.department.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          users: true,
          stockEntries: true,
          stockIssues: true,
          transferRequests: true,
        },
      },
    },
  });
  if (!dept) return { error: "Department not found" };

  const { users, stockEntries, stockIssues, transferRequests } = dept._count;
  const blockers: string[] = [];
  if (users > 0) blockers.push(`${users} member${users === 1 ? "" : "s"}`);
  if (stockEntries > 0) blockers.push(`${stockEntries} stock entr${stockEntries === 1 ? "y" : "ies"}`);
  if (stockIssues > 0) blockers.push(`${stockIssues} stock movement${stockIssues === 1 ? "" : "s"}`);
  if (transferRequests > 0)
    blockers.push(`${transferRequests} transfer request${transferRequests === 1 ? "" : "s"}`);

  if (blockers.length > 0) {
    return {
      error: `Cannot delete "${dept.name}" — it still has ${blockers.join(", ")}. Reassign or remove them first, or deactivate the department instead.`,
    };
  }

  // Remove a department-specific approval flow if one exists, then the department
  await prisma.$transaction([
    prisma.approvalFlowConfig.deleteMany({ where: { departmentId: id } }),
    prisma.department.delete({ where: { id } }),
  ]);

  await logActivity("DELETED", "Department", id, `Deleted department "${dept.name}"`);

  revalidatePath("/departments");
  return { success: true };
}

export async function toggleDepartmentStatus(id: string) {
  await requirePermission(PERMISSIONS.DEPARTMENTS_DELETE);

  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) return { error: "Department not found" };

  const updated = await prisma.department.update({
    where: { id },
    data: { isActive: !dept.isActive },
  });

  await logActivity(
    updated.isActive ? "ACTIVATED" : "DEACTIVATED",
    "Department",
    id,
    `${updated.isActive ? "Activated" : "Deactivated"} department "${updated.name}"`
  );

  revalidatePath("/departments");
  return { success: true };
}
