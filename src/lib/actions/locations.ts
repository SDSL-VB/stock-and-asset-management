"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/rbac/check";

/**
 * Active sites, for pickers. Locations are a managed list rather than a
 * hardcoded enum, so a third site needs no deployment.
 */
export async function getLocationsForSelect() {
  await requireAuth();

  return prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
}

/** The site a user belongs to, inherited from their department. */
export async function getMyLocationId(): Promise<string | null> {
  const user = await requireAuth();
  if (!user.departmentId) return null;

  const department = await prisma.department.findUnique({
    where: { id: user.departmentId },
    select: { locationId: true },
  });
  return department?.locationId ?? null;
}
