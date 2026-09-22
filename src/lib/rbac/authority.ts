import { prisma } from "@/lib/prisma";
import { holdsRole } from "@/lib/rbac/check";
import { ROLES } from "@/lib/rbac/permissions";

/**
 * Who may act on whom — one rule for every action that touches another
 * person's account: their details, role, password, status, deletion,
 * department, and extra permissions.
 *
 * A plain module rather than a "use server" one, so these checks are not
 * themselves endpoints anyone could call.
 */
/**
 * Whether the signed-in person may act on someone else's account — change
 * their details or role, see or set their password, disable or delete them.
 *
 *   - never on their own account from here (My Profile is for that), since
 *     changing your own role, site or status is how you would promote yourself
 *   - the Super Admin on anyone
 *   - anyone else only on someone strictly junior to them, judged by the
 *     strongest role the other person holds, primary OR additional — so a
 *     second role cannot be used to hide seniority, and peers cannot take over
 *     each other's accounts
 */
export async function refusalOver(
  currentUser: { id: string; role: string; roles?: string[]; hierarchyLevel: number },
  targetId: string
): Promise<string | null> {
  if (targetId === currentUser.id) return "You cannot do that to your own account here";
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: {
      role: { select: { name: true, hierarchyLevel: true } },
      additionalRoles: { select: { role: { select: { name: true, hierarchyLevel: true } } } },
    },
  });
  if (!target) return "User not found";
  if (holdsRole(currentUser, ROLES.SUPER_ADMIN)) return null;
  const held = [target.role, ...target.additionalRoles.map((r) => r.role)];
  if (held.some((r) => r.name === ROLES.SUPER_ADMIN)) return "Only the Super Admin can do that to the Super Admin";
  const strongest = Math.min(...held.map((r) => r.hierarchyLevel));
  if (strongest <= currentUser.hierarchyLevel) return "They are at or above your rank, so you cannot do that";
  return null;
}

/** Whether the signed-in person may give a role out: at or below their own rank. */
export async function refusalToAssign(
  currentUser: { role: string; roles?: string[]; hierarchyLevel: number },
  roleId: string
): Promise<string | null> {
  const role = await prisma.role.findUnique({ where: { id: roleId }, select: { name: true, hierarchyLevel: true } });
  if (!role) return "That role no longer exists";
  if (holdsRole(currentUser, ROLES.SUPER_ADMIN)) return null;
  if (role.name === ROLES.SUPER_ADMIN) return "Only the Super Admin can give out the Super Admin role";
  if (role.hierarchyLevel < currentUser.hierarchyLevel) return `${role.name} outranks you, so you cannot give it out`;
  return null;
}

