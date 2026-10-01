"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAuth, requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, LOCATIONS_PAGE_PERMISSIONS } from "@/lib/rbac/permissions";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";

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

const locationSchema = z.object({
  name: z.string().trim().min(2, "Give the site a name").max(60, "Keep the name under 60 characters"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,10}$/, "A code is 2–10 letters, digits or hyphens — BLR, HYD-2"),
});

/** Every site, active or not, with what is attached to it — for the Locations page. */
export async function getLocations() {
  await requireAnyPermission(LOCATIONS_PAGE_PERMISSIONS);
  const locations = await prisma.location.findMany({
    include: { _count: { select: { departments: { where: { isActive: true } } } } },
    orderBy: { name: "asc" },
  });
  return locations.map((l) => ({
    id: l.id,
    name: l.name,
    code: l.code,
    isActive: l.isActive,
    activeDepartments: l._count.departments,
  }));
}

export async function createLocation(data: unknown) {
  await requirePermission(PERMISSIONS.LOCATIONS_CREATE);
  const parsed = locationSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const clash = await prisma.location.findFirst({
    where: { OR: [{ name: { equals: parsed.data.name, mode: "insensitive" } }, { code: parsed.data.code }] },
  });
  if (clash) return { error: "A site with that name or code already exists" };

  const location = await prisma.location.create({ data: parsed.data });
  await logActivity("CREATED", "Location", location.id, `Added site ${location.name} (${location.code})`);
  revalidatePath("/locations");
  revalidatePath("/departments");
  return { success: true };
}

const updateSchema = locationSchema.extend({ isActive: z.boolean() });

/**
 * Rename a site, change its code, or take it out of use. A site with active
 * departments stays in use: retiring it would hide their people and stock from
 * every picker while they still work there.
 */
export async function updateLocation(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.LOCATIONS_EDIT);
  const parsed = updateSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const current = await prisma.location.findUnique({
    where: { id },
    include: { _count: { select: { departments: { where: { isActive: true } } } } },
  });
  if (!current) return { error: "That site was not found" };
  if (!parsed.data.isActive && current.isActive && current._count.departments > 0) {
    return { error: "Departments are still active at this site — move or close them first" };
  }
  const clash = await prisma.location.findFirst({
    where: {
      id: { not: id },
      OR: [{ name: { equals: parsed.data.name, mode: "insensitive" } }, { code: parsed.data.code }],
    },
  });
  if (clash) return { error: "Another site already has that name or code" };

  await prisma.location.update({ where: { id }, data: parsed.data });
  const changes = [
    current.name !== parsed.data.name ? `name ${current.name} → ${parsed.data.name}` : null,
    current.code !== parsed.data.code ? `code ${current.code} → ${parsed.data.code}` : null,
    current.isActive !== parsed.data.isActive ? (parsed.data.isActive ? "back in use" : "taken out of use") : null,
  ].filter(Boolean);
  if (changes.length > 0) {
    await logActivity("UPDATED", "Location", id, `Site ${parsed.data.name}: ${changes.join("; ")}`);
  }
  revalidatePath("/locations");
  revalidatePath("/departments");
  return { success: true };
}
