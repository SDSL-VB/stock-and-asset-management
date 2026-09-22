/**
 * What a person can actually do, worked out from the database: every
 * permission from every role they hold plus their unexpired individual grants,
 * their strongest rank, and their site.
 *
 * Used by sign-in (src/auth.ts builds the session from it) and by anything that
 * has to find people rather than check the one signed in — notifications ask
 * "who can approve this, at this site?" (src/lib/recipients.ts). One rule, so
 * the two can never disagree about who holds a permission.
 */

/** Everything needed to work out what one person may do. */
export const AUTH_INCLUDE = {
  role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
  // Roles held on top of the primary one — see the UserRole model
  additionalRoles: {
    include: {
      role: {
        select: {
          name: true,
          hierarchyLevel: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  },
  department: { select: { locationId: true, isCentralStock: true } },
  extraPermissions: {
    select: { expiresAt: true, permission: { select: { key: true } } },
  },
} as const;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  departmentId: string | null;
  role: { name: string; hierarchyLevel: number; permissions: { permission: { key: string } }[] };
  additionalRoles: {
    role: { name: string; hierarchyLevel: number; permissions: { permission: { key: string } }[] };
  }[];
  department: { locationId: string | null; isCentralStock: boolean } | null;
  extraPermissions: { expiresAt: Date | null; permission: { key: string } }[];
  mustChangePassword: boolean;
  passwordSetAt: Date | null;
  isActive: boolean;
  isSystem: boolean;
};

/**
 * What a person can do: every permission from every role they hold, plus
 * anything granted to them individually.
 *
 * Grants are add-only, so this is a union and never a subtraction — which is
 * what makes "why can't she do this?" always answerable from her roles. An
 * expired grant simply drops out here, so expiry needs nothing on a schedule.
 */
export function unionPermissions(user: AuthUser): string[] {
  const keys = new Set<string>();

  for (const rp of user.role.permissions) keys.add(rp.permission.key);
  for (const held of user.additionalRoles) {
    for (const rp of held.role.permissions) keys.add(rp.permission.key);
  }

  const now = Date.now();
  for (const grant of user.extraPermissions) {
    if (grant.expiresAt && grant.expiresAt.getTime() <= now) continue;
    keys.add(grant.permission.key);
  }

  return [...keys];
}

/** Every role name held, primary first — for the badge and the directory. */
export function roleNames(user: AuthUser): string[] {
  return [user.role.name, ...user.additionalRoles.map((h) => h.role.name)];
}

/**
 * The strongest rank held. Lower is stronger, so holding a second role can
 * promote someone but never demote them.
 */
export function strongestHierarchy(user: AuthUser): number {
  return user.additionalRoles.reduce(
    (best, held) => Math.min(best, held.role.hierarchyLevel),
    user.role.hierarchyLevel
  );
}
