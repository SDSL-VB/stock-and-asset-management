import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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

/**
 * Signed in, and nothing more. Only the change-password page should use this.
 *
 * `requireAuth` below sends anyone with a forced password change to that page,
 * so the page itself cannot use it without redirecting to itself forever.
 */
export async function requireSignedIn() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAuth() {
  const user = await requireSignedIn();

  // Somebody whose password was chosen for them by an admin goes nowhere until
  // they have replaced it.
  //
  // Note which way round this is: the session is trusted to say NO, and the
  // database is asked to confirm every YES. That asymmetry is the fix for a real
  // bug — people who had already changed their password were still being sent
  // here, again and again.
  //
  // The reason is that the session is a snapshot. The jwt callback in
  // src/auth.ts only re-reads the database every 30 seconds, and middleware
  // (which used to run this same check) reads a cookie written once at sign-in
  // and never rewritten — so a stale "yes" could outlive the truth by 30 seconds
  // there and by the full 24-hour session here. A stale "no" is harmless: it
  // costs an admin's reset a few seconds to take hold. A stale "yes" traps
  // somebody out of the entire application, so it is never acted on without
  // asking the database first.
  //
  // The extra query therefore only happens for the few people actually carrying
  // the flag; everyone else takes the cheap path and never touches it.
  if (user.mustChangePassword) {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { mustChangePassword: true },
    });
    if (row?.mustChangePassword) redirect("/settings/password");
  }

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
