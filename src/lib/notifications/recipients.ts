import { prisma } from "@/lib/prisma";
import { AUTH_INCLUDE, unionPermissions } from "@/lib/rbac/effective-user";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Who should hear about something: the active people holding a permission,
 * narrowed to the place it happened.
 *
 *   site        goods at a site concern people at that site — or anyone who
 *               sees every site (stock.scope.all)
 *   department  a department's business concerns its own people — or anyone
 *               who sees every site
 *
 * Permissions are worked out exactly as sign-in does (effective-user.ts), so
 * nobody is told about something they could not then open.
 */
export async function holdersOf(
  permission: string,
  where: { locationId?: string | null; departmentId?: string | null; exclude?: string[] } = {}
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    include: AUTH_INCLUDE,
  });
  return users
    .filter((u) => {
      if (where.exclude?.includes(u.id)) return false;
      const keys = unionPermissions(u);
      if (!keys.includes(permission)) return false;
      if (keys.includes(PERMISSIONS.STOCK_SCOPE_ALL)) return true;
      if (where.departmentId) return u.departmentId === where.departmentId;
      if (where.locationId) return u.department?.locationId === where.locationId;
      return true;
    })
    .map((u) => u.id);
}
