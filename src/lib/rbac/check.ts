import { auth } from "@/auth";
import { redirect } from "next/navigation";
import type { PermissionKey } from "./permissions";

/**
 * The guards every server action starts with.
 *
 * Called by: every action, and every page that gates itself.
 *
 * `requirePermission` and `requireAnyPermission` REDIRECT rather than return —
 * which has a consequence worth remembering: a page can bounce to /unauthorized
 * because of one action it calls, even when its own gate passed. Gate an action
 * on what IT does, not on a neighbouring feature. `npm run audit:access` finds
 * those.
 */

export async function getCurrentUser() {
  const session = await auth();
  return session?.user ?? null;
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(permission: PermissionKey) {
  const user = await requireAuth();
  if (!user.permissions.includes(permission)) {
    redirect("/unauthorized");
  }
  return user;
}

export async function requireAnyPermission(permissions: PermissionKey[]) {
  const user = await requireAuth();
  const hasAny = permissions.some((p) => user.permissions.includes(p));
  if (!hasAny) redirect("/unauthorized");
  return user;
}

export function hasPermission(
  userPermissions: string[],
  permission: PermissionKey
): boolean {
  return userPermissions.includes(permission);
}

/**
 * Whether someone holds a named role, primary or additional.
 *
 * This is NOT how you decide what someone may do — that is always a permission.
 * It exists only for the handful of guards that protect a specific system
 * account (nobody but a Super Admin may edit the Super Admin), where the
 * identity of the role really is the point.
 */
export function holdsRole(
  user: { role: string; roles?: string[] },
  role: string
): boolean {
  return (user.roles ?? [user.role]).includes(role);
}

// Pure scope resolver lives in permissions.ts (client-safe); re-exported here
// so server code can keep importing it alongside the auth helpers.
export { resolveStockScope, type StockScope } from "./permissions";
